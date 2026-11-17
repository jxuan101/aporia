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
from app.main import app
from app.migrate import migrate_database, validate_test_database_url

TEST_DATABASE_URL = os.getenv("BRAINDUMP_TEST_DATABASE_URL")


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
