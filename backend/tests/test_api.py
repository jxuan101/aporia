import os
import secrets
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app import auth
from app.agent_jobs import process_next_job
from app.agent_schema import ProcessingProposal
from app.main import app
from app.migrate import migrate_database, validate_test_database_url
from app.model_adapter import (
    ModelOutputError,
    ModelProposalResult,
    ModelTemporarilyUnavailable,
)

TEST_DATABASE_URL = os.getenv("BRAINDUMP_TEST_DATABASE_URL")


def database_connection_factory() -> psycopg.Connection:
    return psycopg.connect(
        TEST_DATABASE_URL,
        row_factory=dict_row,
        connect_timeout=5,
    )


class FixedProposalAdapter:
    def __init__(self) -> None:
        self.seen_captures: list[str] = []

    def propose_capture(self, capture_text: str) -> ModelProposalResult:
        self.seen_captures.append(capture_text)
        proposal = ProcessingProposal.model_validate(
            {
                "schema_version": "1",
                "item_type": "note",
                "title": "Remember the library book",
                "summary": "Keep the library book in mind.",
                "labels": ["reading"],
                "candidate_tasks": [],
                "related_item_ids": [],
                "clarifying_question": None,
                "confidence": 0.82,
                "reasoning_summary": "The capture is a short reference note.",
            }
        )
        return ModelProposalResult(
            proposal=proposal,
            model_identifier="synthetic-model",
            prompt_version="synthetic-prompt-v1",
        )


class TemporaryFailureAdapter:
    def propose_capture(self, _capture_text: str) -> ModelProposalResult:
        raise ModelTemporarilyUnavailable("synthetic provider outage")


class InvalidOutputAdapter:
    def propose_capture(self, _capture_text: str) -> ModelProposalResult:
        raise ModelOutputError("synthetic invalid output")


@pytest.fixture(scope="session")
def database_url() -> str:
    if not TEST_DATABASE_URL:
        pytest.skip(
            "Set BRAINDUMP_TEST_DATABASE_URL to run database integration tests."
        )
    validate_test_database_url(TEST_DATABASE_URL)
    migrate_database(TEST_DATABASE_URL)
    return TEST_DATABASE_URL


@pytest.fixture
def connection(database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url, row_factory=dict_row) as current:
        yield current


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    app.state.connection_factory = lambda: psycopg.connect(
        database_url,
        row_factory=dict_row,
        connect_timeout=5,
    )
    with TestClient(app) as test_client:
        yield test_client
    del app.state.connection_factory


@pytest.fixture
def identities(connection: psycopg.Connection) -> dict[str, str]:
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())
    token_a = secrets.token_urlsafe(32)
    token_b = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    connection.cursor().executemany(
        "INSERT INTO users (id, email, name, email_verified) VALUES (%s, %s, %s, %s)",
        [
            (user_a, f"{user_a}@example.test", "Test User A", now),
            (user_b, f"{user_b}@example.test", "Test User B", now),
        ],
    )
    connection.cursor().executemany(
        "INSERT INTO sessions (session_token, user_id, expires) VALUES (%s, %s, %s)",
        [
            (token_a, user_a, now + timedelta(days=1)),
            (token_b, user_b, now + timedelta(days=1)),
        ],
    )
    connection.commit()
    try:
        yield {
            "user_a": user_a,
            "user_b": user_b,
            "token_a": token_a,
            "token_b": token_b,
        }
    finally:
        connection.execute("DELETE FROM users WHERE id IN (%s, %s)", (user_a, user_b))


def test_capture_ownership_and_original_preservation(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    created = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "  original thought  "},
    )

    assert created.status_code == 201
    capture = created.json()["capture"]
    capture_id = capture["id"]
    assert capture["originalText"] == "  original thought  "

    updated = client.patch(
        f"/api/v1/captures/{capture_id}",
        headers=owner_headers,
        json={"text": "edited thought"},
    )
    assert updated.status_code == 200
    assert updated.json()["capture"]["originalText"] == "  original thought  "
    assert updated.json()["capture"]["currentText"] == "edited thought"

    hidden_list = client.get("/api/v1/captures", headers=other_headers)
    assert hidden_list.status_code == 200
    assert capture_id not in {item["id"] for item in hidden_list.json()["captures"]}
    assert (
        client.patch(
            f"/api/v1/captures/{capture_id}",
            headers=other_headers,
            json={"text": "not allowed"},
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/v1/captures/{capture_id}", headers=other_headers
        ).status_code
        == 404
    )
    other_export = client.get("/api/v1/export", headers=other_headers)
    assert other_export.status_code == 200
    assert capture_id not in {item["id"] for item in other_export.json()["captures"]}

    owner_list = client.get("/api/v1/captures", headers=owner_headers)
    assert owner_list.json()["captures"][0]["id"] == capture_id


def test_expired_session_cannot_read_inbox(
    client: TestClient,
    connection: psycopg.Connection,
) -> None:
    user_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    connection.execute(
        "INSERT INTO users (id, email) VALUES (%s, %s)",
        (user_id, f"{user_id}@example.test"),
    )
    connection.execute(
        "INSERT INTO sessions (session_token, user_id, expires) VALUES (%s, %s, %s)",
        (token, user_id, datetime.now(UTC) - timedelta(seconds=1)),
    )
    connection.commit()
    try:
        response = client.get(
            "/api/v1/captures",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401
    finally:
        connection.execute("DELETE FROM users WHERE id = %s", (user_id,))


def test_google_exchange_creates_a_database_session(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = {
        "subject": f"synthetic-{uuid.uuid4()}",
        "email": f"{uuid.uuid4()}@example.test",
        "name": "Synthetic Google User",
    }
    monkeypatch.setattr(auth, "verify_google_id_token", lambda _: identity)

    try:
        response = client.post(
            "/api/v1/auth/google", json={"idToken": "synthetic-token"}
        )

        assert response.status_code == 200
        body = response.json()
        headers = {"Authorization": f"Bearer {body['token']}"}
        session = client.get("/api/v1/captures", headers=headers)
        assert session.status_code == 200
        assert body["user"]["email"] == identity["email"]

        revoked = client.delete("/api/v1/auth/session", headers=headers)
        assert revoked.status_code == 204
        assert client.get("/api/v1/captures", headers=headers).status_code == 401
    finally:
        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
            connection.execute(
                "DELETE FROM users WHERE email = %s", (identity["email"],)
            )


def test_processing_is_explicit_idempotent_and_user_scoped(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "Remember to return the library book."},
    )
    capture_id = capture_response.json()["capture"]["id"]

    first = client.post(
        f"/api/v1/captures/{capture_id}/process",
        headers=owner_headers,
    )
    second = client.post(
        f"/api/v1/captures/{capture_id}/process",
        headers=owner_headers,
    )

    assert first.status_code == 202
    assert second.status_code == 202
    job_id = first.json()["job"]["id"]
    assert second.json()["job"]["id"] == job_id
    assert first.json()["job"]["status"] == "queued"
    assert (
        client.get(f"/api/v1/agent/jobs/{job_id}", headers=other_headers).status_code
        == 404
    )

    adapter = FixedProposalAdapter()
    assert process_next_job(database_connection_factory, adapter) is True
    assert adapter.seen_captures == ["Remember to return the library book."]

    completed = client.get(f"/api/v1/agent/jobs/{job_id}", headers=owner_headers)
    assert completed.status_code == 200
    job = completed.json()["job"]
    assert job["status"] == "succeeded"
    assert job["suggestion"]["proposal"]["title"] == "Remember the library book"
    assert job["suggestion"]["modelIdentifier"] == "synthetic-model"

    with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
        counts = connection.execute(
            """
            SELECT (SELECT count(*) FROM agent_jobs WHERE id = %s) AS jobs,
                (SELECT count(*) FROM agent_suggestions WHERE job_id = %s)
                    AS suggestions
            """,
            (job_id, job_id),
        ).fetchone()
    assert counts == {"jobs": 1, "suggestions": 1}


def test_transient_failure_retries_job_without_duplicate_suggestions(
    client: TestClient,
    identities: dict[str, str],
    connection: psycopg.Connection,
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "A thought that can be retried."},
    )
    capture_id = capture_response.json()["capture"]["id"]
    queued = client.post(
        f"/api/v1/captures/{capture_id}/process",
        headers=headers,
    )
    job_id = queued.json()["job"]["id"]

    assert process_next_job(database_connection_factory, TemporaryFailureAdapter())
    retry_state = connection.execute(
        "SELECT status, attempt_count, error_code FROM agent_jobs WHERE id = %s",
        (job_id,),
    ).fetchone()
    assert retry_state == {
        "status": "queued",
        "attempt_count": 1,
        "error_code": "provider_unavailable",
    }

    connection.execute(
        """
        UPDATE agent_jobs
        SET available_at = now() - interval '1 second'
        WHERE id = %s
        """,
        (job_id,),
    )
    connection.commit()
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    completed = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers)
    assert completed.json()["job"]["status"] == "succeeded"
    assert completed.json()["job"]["attemptCount"] == 2
    assert (
        connection.execute(
            "SELECT count(*) AS count FROM agent_suggestions WHERE job_id = %s",
            (job_id,),
        ).fetchone()["count"]
        == 1
    )


def test_transient_failures_stop_after_three_total_attempts(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "A thought for retry limit coverage."},
    )
    capture_id = capture_response.json()["capture"]["id"]
    queued = client.post(
        f"/api/v1/captures/{capture_id}/process",
        headers=headers,
    )
    job_id = queued.json()["job"]["id"]
    adapter = TemporaryFailureAdapter()

    for attempt in range(1, 4):
        assert process_next_job(database_connection_factory, adapter)
        if attempt < 3:
            with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
                connection.execute(
                    """
                    UPDATE agent_jobs
                    SET available_at = now() - interval '1 second'
                    WHERE id = %s
                    """,
                    (job_id,),
                )

    failed = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    assert failed["status"] == "failed"
    assert failed["attemptCount"] == 3
    assert failed["errorCode"] == "provider_unavailable"


def test_capture_edit_cancels_queued_job_and_preserves_original(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "Original saved thought."},
    )
    capture = capture_response.json()["capture"]
    job_response = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=headers,
    )
    job_id = job_response.json()["job"]["id"]
    updated = client.patch(
        f"/api/v1/captures/{capture['id']}",
        headers=headers,
        json={"text": "Edited thought."},
    )

    adapter = FixedProposalAdapter()
    assert process_next_job(database_connection_factory, adapter) is False
    job = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    assert job["status"] == "cancelled"
    assert adapter.seen_captures == []
    assert updated.json()["capture"]["originalText"] == "Original saved thought."


def test_invalid_model_output_fails_job_without_changing_capture(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "Keep this original content."},
    )
    capture = capture_response.json()["capture"]
    job_response = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=headers,
    )
    job_id = job_response.json()["job"]["id"]

    assert process_next_job(database_connection_factory, InvalidOutputAdapter())
    job = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    captures = client.get("/api/v1/captures", headers=headers).json()["captures"]
    current = next(item for item in captures if item["id"] == capture["id"])
    assert job["status"] == "failed"
    assert job["errorCode"] == "invalid_output"
    assert current["originalText"] == "Keep this original content."
    assert current["currentText"] == "Keep this original content."
