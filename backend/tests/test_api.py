import os
import secrets
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app import agent_jobs, auth
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
    assert job["maxAttempts"] == 3
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


def test_daily_processing_limit_counts_new_jobs_per_user(
    client: TestClient,
    identities: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_jobs, "MAX_DAILY_PROCESSING_REQUESTS_PER_USER", 2)
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    first_capture_id = client.post(
        "/api/v1/captures", headers=owner_headers, json={"text": "First thought"}
    ).json()["capture"]["id"]
    second_capture_id = client.post(
        "/api/v1/captures", headers=owner_headers, json={"text": "Second thought"}
    ).json()["capture"]["id"]
    other_capture_id = client.post(
        "/api/v1/captures", headers=other_headers, json={"text": "Other thought"}
    ).json()["capture"]["id"]

    first = client.post(
        f"/api/v1/captures/{first_capture_id}/process", headers=owner_headers
    )
    repeated = client.post(
        f"/api/v1/captures/{first_capture_id}/process", headers=owner_headers
    )
    assert process_next_job(database_connection_factory, InvalidOutputAdapter())
    retry = client.post(
        f"/api/v1/captures/{first_capture_id}/process", headers=owner_headers
    )
    limited = client.post(
        f"/api/v1/captures/{second_capture_id}/process", headers=owner_headers
    )
    other_user = client.post(
        f"/api/v1/captures/{other_capture_id}/process", headers=other_headers
    )

    assert first.status_code == 202
    assert repeated.status_code == 202
    assert repeated.json()["job"]["id"] == first.json()["job"]["id"]
    assert retry.status_code == 202
    assert limited.status_code == 429
    assert limited.json()["code"] == "daily_processing_limit"
    assert other_user.status_code == 202


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


def test_accepting_edited_proposal_creates_one_user_owned_item(
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
    capture = capture_response.json()["capture"]
    job_response = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=owner_headers,
    )
    job_id = job_response.json()["job"]["id"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    job = client.get(f"/api/v1/agent/jobs/{job_id}", headers=owner_headers).json()[
        "job"
    ]
    suggestion = job["suggestion"]
    approved = dict(suggestion["proposal"])
    approved["title"] = "Return the library book"
    approved["summary"] = "Return the book to the library this week."
    approved["related_item_ids"] = [str(uuid.uuid4())]
    suggestion_id = suggestion["id"]

    hidden = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/accept",
        headers=other_headers,
        json={"proposal": approved},
    )
    assert hidden.status_code == 404

    accepted = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/accept",
        headers=owner_headers,
        json={"proposal": approved},
    )
    assert accepted.status_code == 200
    result = accepted.json()["suggestion"]
    assert result["status"] == "accepted"
    assert result["acceptedProposal"]["title"] == "Return the library book"
    assert result["acceptedProposal"]["related_item_ids"] == []
    assert result["itemId"]
    with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
        assert (
            connection.execute(
                """
                SELECT count(*) AS count FROM item_relationships
                WHERE user_id = %s AND (item_low = %s OR item_high = %s)
                """,
                (identities["user_a"], result["itemId"], result["itemId"]),
            ).fetchone()["count"]
            == 0
        )

    repeated = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/accept",
        headers=owner_headers,
        json={"proposal": approved},
    )
    assert repeated.status_code == 200
    assert repeated.json()["suggestion"]["itemId"] == result["itemId"]

    changed_approved = {**approved, "title": "A different accepted title"}
    conflict = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/accept",
        headers=owner_headers,
        json={"proposal": changed_approved},
    )
    assert conflict.status_code == 409

    with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
        stored = connection.execute(
            """
            SELECT s.status, s.payload_json, s.accepted_payload_json,
                i.title AS item_title, i.capture_id
            FROM agent_suggestions s
            JOIN items i ON i.suggestion_id = s.id
            WHERE s.id = %s AND s.user_id = %s
            """,
            (suggestion_id, identities["user_a"]),
        ).fetchone()
    assert stored["status"] == "accepted"
    assert stored["payload_json"]["title"] == "Remember the library book"
    assert stored["accepted_payload_json"]["title"] == "Return the library book"
    assert stored["item_title"] == "Return the library book"
    assert str(stored["capture_id"]) == capture["id"]


def test_rejecting_suggestion_preserves_capture_and_creates_no_item(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "A note I may not need later."},
    )
    capture = capture_response.json()["capture"]
    queued = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=headers,
    )
    job_id = queued.json()["job"]["id"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    job = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    suggestion_id = job["suggestion"]["id"]

    rejected = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/reject",
        headers=headers,
    )
    assert rejected.status_code == 200
    assert rejected.json()["suggestion"]["status"] == "rejected"
    assert (
        client.post(
            f"/api/v1/agent/suggestions/{suggestion_id}/reject",
            headers=headers,
        ).json()["suggestion"]["status"]
        == "rejected"
    )

    with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
        count = connection.execute(
            "SELECT count(*) AS count FROM items WHERE suggestion_id = %s",
            (suggestion_id,),
        ).fetchone()["count"]
    listed = client.get("/api/v1/captures", headers=headers).json()["captures"]
    current = next(item for item in listed if item["id"] == capture["id"])
    assert count == 0
    assert current["originalText"] == "A note I may not need later."


def test_accept_rejects_an_edited_proposal_with_fabricated_task_evidence(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "A small note about reading."},
    )
    capture_id = capture_response.json()["capture"]["id"]
    queued = client.post(
        f"/api/v1/captures/{capture_id}/process",
        headers=headers,
    )
    job_id = queued.json()["job"]["id"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    suggestion = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()[
        "job"
    ]["suggestion"]
    edited_proposal = dict(suggestion["proposal"])
    edited_proposal["candidate_tasks"] = [
        {
            "title": "Invented action",
            "due_date": None,
            "source_text": "This sentence is not in the capture.",
            "confidence": 0.9,
        }
    ]

    response = client.post(
        f"/api/v1/agent/suggestions/{suggestion['id']}/accept",
        headers=headers,
        json={"proposal": edited_proposal},
    )

    assert response.status_code == 400
    refreshed = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()[
        "job"
    ]
    assert refreshed["suggestion"]["status"] == "pending"


def test_capture_edit_marks_pending_suggestion_stale_and_prevents_acceptance(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    headers = {"Authorization": f"Bearer {identities['token_a']}"}
    capture_response = client.post(
        "/api/v1/captures",
        headers=headers,
        json={"text": "Capture before processing."},
    )
    capture = capture_response.json()["capture"]
    queued = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=headers,
    )
    job_id = queued.json()["job"]["id"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    job = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    suggestion_id = job["suggestion"]["id"]
    client.patch(
        f"/api/v1/captures/{capture['id']}",
        headers=headers,
        json={"text": "Capture after processing."},
    )

    stale = client.get(f"/api/v1/agent/jobs/{job_id}", headers=headers).json()["job"]
    assert stale["suggestion"]["status"] == "stale"
    attempt = client.post(
        f"/api/v1/agent/suggestions/{suggestion_id}/accept",
        headers=headers,
        json={"proposal": stale["suggestion"]["proposal"]},
    )
    assert attempt.status_code == 409
    with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
        assert (
            connection.execute(
                "SELECT count(*) AS count FROM items WHERE suggestion_id = %s",
                (suggestion_id,),
            ).fetchone()["count"]
            == 0
        )


def test_items_are_listed_and_read_only_with_user_scoping(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    capture = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "Remember the library book."},
    ).json()["capture"]
    job = client.post(
        f"/api/v1/captures/{capture['id']}/process",
        headers=owner_headers,
    ).json()["job"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    suggestion = client.get(
        f"/api/v1/agent/jobs/{job['id']}", headers=owner_headers
    ).json()["job"]["suggestion"]
    accepted = client.post(
        f"/api/v1/agent/suggestions/{suggestion['id']}/accept",
        headers=owner_headers,
        json={"proposal": suggestion["proposal"]},
    )
    item_id = accepted.json()["suggestion"]["itemId"]

    listed = client.get("/api/v1/items", headers=owner_headers)
    assert listed.status_code == 200
    assert listed.json()["nextCursor"] is None
    assert listed.json()["items"][0]["id"] == item_id
    assert listed.json()["items"][0]["captureId"] == capture["id"]
    assert listed.json()["items"][0]["title"] == "Remember the library book"
    item_search = client.get("/api/v1/items?q=book", headers=owner_headers)
    assert [item["id"] for item in item_search.json()["items"]] == [item_id]

    detail = client.get(f"/api/v1/items/{item_id}", headers=owner_headers)
    assert detail.status_code == 200
    assert detail.json()["item"]["summary"] == "Keep the library book in mind."
    assert detail.json()["item"]["capture"] == {
        "originalText": "Remember the library book.",
        "currentText": "Remember the library book.",
    }
    assert (
        client.get(f"/api/v1/items/{item_id}", headers=other_headers).status_code == 404
    )
    assert client.get("/api/v1/items", headers=other_headers).json()["items"] == []


def test_capture_full_text_search_stems_terms_and_stays_user_scoped(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    owner_capture = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "Yesterday I painted a watercolor landscape."},
    ).json()["capture"]
    client.post(
        "/api/v1/captures",
        headers=other_headers,
        json={"text": "Yesterday I painted a watercolor landscape."},
    )

    owner_results = client.get("/api/v1/captures?q=paint", headers=owner_headers)
    other_results = client.get("/api/v1/captures?q=paint", headers=other_headers)

    assert owner_results.status_code == 200
    assert [item["id"] for item in owner_results.json()["captures"]] == [
        owner_capture["id"]
    ]
    assert len(other_results.json()["captures"]) == 1
    assert owner_results.json()["captures"][0]["currentText"].startswith("Yesterday")


def test_capture_creation_warns_about_similar_captures_without_crossing_users(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}
    first = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "Set reminders to renew the passport before summer holidays."},
    ).json()
    similar = client.post(
        "/api/v1/captures",
        headers=owner_headers,
        json={"text": "Set reminders to renew the passport before summer trip."},
    )
    other_user = client.post(
        "/api/v1/captures",
        headers=other_headers,
        json={"text": "Set reminders to renew the passport before summer trip."},
    )

    assert similar.status_code == 201
    assert similar.json()["capture"]["currentText"].endswith("summer trip.")
    assert similar.json()["possibleDuplicates"] == [
        {
            "id": first["capture"]["id"],
            "currentText": (
                "Set reminders to renew the passport before summer holidays."
            ),
            "createdAt": first["capture"]["createdAt"],
        }
    ]
    assert other_user.json()["possibleDuplicates"] == []


def test_related_item_suggestions_require_explicit_link_and_can_be_removed(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}

    def create_item(headers: dict[str, str], text: str) -> str:
        capture = client.post(
            "/api/v1/captures", headers=headers, json={"text": text}
        ).json()["capture"]
        job = client.post(
            f"/api/v1/captures/{capture['id']}/process", headers=headers
        ).json()["job"]
        assert process_next_job(database_connection_factory, FixedProposalAdapter())
        suggestion = client.get(
            f"/api/v1/agent/jobs/{job['id']}", headers=headers
        ).json()["job"]["suggestion"]
        accepted = client.post(
            f"/api/v1/agent/suggestions/{suggestion['id']}/accept",
            headers=headers,
            json={"proposal": suggestion["proposal"]},
        )
        return accepted.json()["suggestion"]["itemId"]

    first_id = create_item(owner_headers, "Library book for garden research.")
    second_id = create_item(owner_headers, "Garden library book recommendations.")
    other_id = create_item(other_headers, "Garden library book notes.")

    suggestions = client.get(
        f"/api/v1/items/{first_id}/related", headers=owner_headers
    ).json()
    suggested_ids = {entry["item"]["id"] for entry in suggestions["suggestions"]}
    assert second_id in suggested_ids
    assert other_id not in suggested_ids
    assert suggestions["relatedItems"] == []

    assert (
        client.post(
            f"/api/v1/items/{first_id}/related/{first_id}", headers=owner_headers
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/v1/items/{first_id}/related/{other_id}", headers=owner_headers
        ).status_code
        == 404
    )
    linked = client.post(
        f"/api/v1/items/{first_id}/related/{second_id}", headers=owner_headers
    )
    assert linked.status_code == 201
    assert (
        client.post(
            f"/api/v1/items/{second_id}/related/{first_id}", headers=owner_headers
        ).status_code
        == 201
    )

    linked_items = client.get(
        f"/api/v1/items/{first_id}/related", headers=owner_headers
    ).json()
    assert [item["id"] for item in linked_items["relatedItems"]] == [second_id]
    assert second_id not in {
        entry["item"]["id"] for entry in linked_items["suggestions"]
    }

    removed = client.delete(
        f"/api/v1/items/{first_id}/related/{second_id}", headers=owner_headers
    )
    assert removed.status_code == 204
    unlinked = client.get(
        f"/api/v1/items/{first_id}/related", headers=owner_headers
    ).json()
    assert unlinked["relatedItems"] == []
    assert second_id in {entry["item"]["id"] for entry in unlinked["suggestions"]}


def test_daily_review_queue_prioritizes_states_and_defers_user_scoped_captures(
    client: TestClient,
    identities: dict[str, str],
) -> None:
    owner_headers = {"Authorization": f"Bearer {identities['token_a']}"}
    other_headers = {"Authorization": f"Bearer {identities['token_b']}"}

    def create_capture(text: str) -> str:
        return client.post(
            "/api/v1/captures", headers=owner_headers, json={"text": text}
        ).json()["capture"]["id"]

    ready_id = create_capture("Review this library book note.")
    processing_id = create_capture("Processing this capture about gardening.")
    unprocessed_id = create_capture("An unprocessed capture about travel.")
    accepted_id = create_capture("A capture already reviewed about cooking.")

    assert (
        client.post(
            f"/api/v1/captures/{ready_id}/process", headers=owner_headers
        ).status_code
        == 202
    )
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    accepted_job = client.post(
        f"/api/v1/captures/{accepted_id}/process", headers=owner_headers
    ).json()["job"]
    assert process_next_job(database_connection_factory, FixedProposalAdapter())
    accepted_suggestion = client.get(
        f"/api/v1/agent/jobs/{accepted_job['id']}", headers=owner_headers
    ).json()["job"]["suggestion"]
    assert (
        client.post(
            f"/api/v1/agent/suggestions/{accepted_suggestion['id']}/accept",
            headers=owner_headers,
            json={"proposal": accepted_suggestion["proposal"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/captures/{processing_id}/process", headers=owner_headers
        ).status_code
        == 202
    )

    response = client.get("/api/v1/review/daily", headers=owner_headers)
    assert response.status_code == 200
    entries = {entry["capture"]["id"]: entry for entry in response.json()["entries"]}
    assert set(entries) == {ready_id, processing_id, unprocessed_id}
    assert entries[ready_id]["reviewStatus"] == "suggestion_ready"
    assert entries[ready_id]["priority"] == "high"
    assert entries[ready_id]["suggestion"] is not None
    assert entries[processing_id]["reviewStatus"] == "processing"
    assert entries[processing_id]["priority"] == "low"
    assert entries[unprocessed_id]["reviewStatus"] == "needs_processing"
    assert "not been processed" in entries[unprocessed_id]["priorityExplanation"]

    assert (
        client.post(
            f"/api/v1/review/captures/{unprocessed_id}/defer",
            headers=other_headers,
        ).status_code
        == 404
    )
    deferred = client.post(
        f"/api/v1/review/captures/{unprocessed_id}/defer", headers=owner_headers
    )
    assert deferred.status_code == 200
    assert deferred.json()["captureId"] == unprocessed_id
    refreshed_entries = client.get(
        "/api/v1/review/daily", headers=owner_headers
    ).json()["entries"]
    assert unprocessed_id not in {entry["capture"]["id"] for entry in refreshed_entries}
