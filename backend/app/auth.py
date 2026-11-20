import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import google.auth.exceptions
from fastapi import APIRouter, Depends, Request
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from psycopg import Connection

from app.config import GOOGLE_WEB_CLIENT_ID
from app.database import get_connection
from app.errors import ApiError
from app.rate_limit import (
    GOOGLE_SIGN_IN_LIMITS,
    USER_REQUEST_LIMITS,
    enforce_rate_limit,
)
from app.validation import bearer_token, read_json_body

router = APIRouter(prefix="/api/v1/auth")
SESSION_DURATION = timedelta(days=30)
ID_TOKEN_MAX_LENGTH = 12_000


def verify_google_id_token(token: str) -> dict[str, str | None]:
    if not GOOGLE_WEB_CLIENT_ID:
        raise RuntimeError("AUTH_GOOGLE_ID must be configured for mobile sign-in.")

    try:
        payload = id_token.verify_oauth2_token(
            token,
            GoogleRequest(),
            audience=GOOGLE_WEB_CLIENT_ID,
        )
    except ValueError:
        raise ApiError("The Google sign-in token is invalid or expired.", 401) from None
    except google.auth.exceptions.TransportError:
        raise ApiError(
            "Google sign-in verification is temporarily unavailable.", 503
        ) from None

    subject = payload.get("sub")
    email = payload.get("email")
    if (
        not isinstance(subject, str)
        or not subject
        or not isinstance(email, str)
        or "@" not in email
        or payload.get("email_verified") is not True
    ):
        raise ApiError("The Google sign-in token is invalid or expired.", 401)

    name = payload.get("name")
    return {
        "subject": subject,
        "email": email,
        "name": name if isinstance(name, str) else None,
    }


@router.post("/google")
async def exchange_google_token(
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
) -> dict[str, object]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        connection,
        scope="google-sign-in-ip",
        identity=client_ip,
        limits=GOOGLE_SIGN_IN_LIMITS,
    )
    body = await read_json_body(request, max_bytes=16_000)
    if (
        not isinstance(body, dict)
        or set(body) != {"idToken"}
        or not isinstance(body["idToken"], str)
        or not body["idToken"]
        or len(body["idToken"]) > ID_TOKEN_MAX_LENGTH
    ):
        raise ApiError("A valid Google ID token is required.", 400)

    identity = verify_google_id_token(body["idToken"])
    session_token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + SESSION_DURATION

    with connection.transaction():
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            (identity["subject"],),
        )
        existing_account = connection.execute(
            """
            SELECT user_id FROM accounts
            WHERE provider = 'google' AND provider_account_id = %s
            LIMIT 1
            """,
            (identity["subject"],),
        ).fetchone()
        user_id = existing_account["user_id"] if existing_account else None

        if user_id is None:
            existing_email = connection.execute(
                "SELECT id FROM users WHERE email = %s LIMIT 1",
                (identity["email"],),
            ).fetchone()
            if existing_email:
                raise ApiError(
                    "This email is already associated with another sign-in identity. "
                    "Sign in with that identity or contact support.",
                    409,
                )

            inserted_user = connection.execute(
                """
                INSERT INTO users (id, email, name, email_verified)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                RETURNING id
                """,
                (
                    secrets.token_hex(16),
                    identity["email"],
                    identity["name"],
                    datetime.now(UTC),
                ),
            ).fetchone()
            if inserted_user is None:
                raise ApiError(
                    "This email is already associated with another sign-in identity. "
                    "Sign in with that identity or contact support.",
                    409,
                )

            user_id = inserted_user["id"]
            connection.execute(
                """
                INSERT INTO accounts (user_id, type, provider, provider_account_id)
                VALUES (%s, 'oidc', 'google', %s)
                """,
                (user_id, identity["subject"]),
            )

        connection.execute(
            "INSERT INTO sessions (session_token, user_id, expires) "
            "VALUES (%s, %s, %s)",
            (session_token, user_id, expires),
        )

    return {
        "token": session_token,
        "expiresAt": expires.isoformat().replace("+00:00", "Z"),
        "user": {
            "id": user_id,
            "email": identity["email"],
            "name": identity["name"],
        },
    }


@router.delete("/session", status_code=204)
def revoke_session(
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
) -> None:
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        raise ApiError("Authentication required.", 401)
    session = connection.execute(
        "SELECT user_id FROM sessions WHERE session_token = %s AND expires > now()",
        (token,),
    ).fetchone()
    if session:
        enforce_rate_limit(
            connection,
            scope="user-api",
            identity=session["user_id"],
            limits=USER_REQUEST_LIMITS,
        )
    connection.execute("DELETE FROM sessions WHERE session_token = %s", (token,))


def current_user_id(
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
) -> str | None:
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        return None
    row = connection.execute(
        "SELECT user_id FROM sessions WHERE session_token = %s AND expires > now()",
        (token,),
    ).fetchone()
    if row is None:
        return None
    enforce_rate_limit(
        connection,
        scope="user-api",
        identity=row["user_id"],
        limits=USER_REQUEST_LIMITS,
    )
    return row["user_id"]
