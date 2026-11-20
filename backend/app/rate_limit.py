"""Database-backed API request limits shared across backend workers."""

from hashlib import sha256
from typing import Final

from psycopg import Connection

from app.errors import ApiError

USER_REQUEST_LIMITS: Final[tuple[tuple[int, int], ...]] = (
    (1, 10),
    (60, 120),
    (3_600, 1_500),
)
GOOGLE_SIGN_IN_LIMITS: Final[tuple[tuple[int, int], ...]] = (
    (1, 3),
    (60, 10),
    (3_600, 40),
)


def enforce_rate_limit(
    connection: Connection,
    *,
    scope: str,
    identity: str,
    limits: tuple[tuple[int, int], ...],
) -> None:
    rate_key = sha256(f"{scope}:{identity}".encode()).hexdigest()
    connection.execute(
        """
        DELETE FROM api_rate_limit_counters
        WHERE window_started_at < now() - interval '1 day'
        """
    )
    for window_seconds, maximum in limits:
        row = connection.execute(
            """
            INSERT INTO api_rate_limit_counters (
                rate_key, window_seconds, window_started_at, request_count
            ) VALUES (%s, %s, now(), 1)
            ON CONFLICT (rate_key, window_seconds) DO UPDATE SET
                request_count = CASE
                    WHEN api_rate_limit_counters.window_started_at
                        + api_rate_limit_counters.window_seconds * interval '1 second'
                        <= now() THEN 1
                    ELSE api_rate_limit_counters.request_count + 1
                END,
                window_started_at = CASE
                    WHEN api_rate_limit_counters.window_started_at
                        + api_rate_limit_counters.window_seconds * interval '1 second'
                        <= now() THEN now()
                    ELSE api_rate_limit_counters.window_started_at
                END
            RETURNING request_count,
                ceil(extract(epoch FROM (
                    window_started_at + window_seconds * interval '1 second' - now()
                )))::integer AS seconds_remaining
            """,
            (rate_key, window_seconds),
        ).fetchone()
        if row["request_count"] > maximum:
            seconds_remaining = max(1, row["seconds_remaining"])
            connection.commit()
            raise ApiError(
                f"Too many requests. Try again in {seconds_remaining} seconds.",
                429,
                code="rate_limited",
            )
    connection.commit()
