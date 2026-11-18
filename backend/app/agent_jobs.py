"""PostgreSQL-backed, revision-scoped capture processing jobs."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from app.model_adapter import (
    ModelAdapter,
    ModelAdapterError,
    ModelOutputError,
    ModelProposalResult,
    ModelTemporarilyUnavailable,
)

MAX_ATTEMPTS = 3
MAX_DAILY_PROCESSING_REQUESTS_PER_USER = 20
LEASE_SECONDS = 120
POLL_INTERVAL_SECONDS = 1


class ProcessingUsageLimitError(Exception):
    """The authenticated user has reached the daily processing request limit."""


@dataclass(frozen=True)
class ClaimedJob:
    id: UUID
    user_id: str
    capture_id: UUID
    capture_revision: Any
    source_text: str
    attempt_count: int


def _consume_daily_processing_request(
    connection: psycopg.Connection,
    *,
    user_id: str,
) -> None:
    consumed = connection.execute(
        """
        INSERT INTO agent_usage_daily (user_id, usage_date, processing_requests)
        VALUES (%s, (now() AT TIME ZONE 'UTC')::date, 1)
        ON CONFLICT (user_id, usage_date) DO UPDATE
        SET processing_requests = agent_usage_daily.processing_requests + 1
        WHERE agent_usage_daily.processing_requests < %s
        RETURNING processing_requests
        """,
        (user_id, MAX_DAILY_PROCESSING_REQUESTS_PER_USER),
    ).fetchone()
    if consumed is None:
        raise ProcessingUsageLimitError


def enqueue_capture_job(
    connection: psycopg.Connection,
    *,
    user_id: str,
    capture_id: UUID,
) -> dict[str, Any] | None:
    user = connection.execute(
        "SELECT id FROM users WHERE id = %s FOR UPDATE",
        (user_id,),
    ).fetchone()
    if user is None:
        return None

    capture = connection.execute(
        "SELECT id, updated_at FROM captures WHERE id = %s AND user_id = %s",
        (capture_id, user_id),
    ).fetchone()
    if capture is None:
        return None

    job = connection.execute(
        """
        SELECT id, capture_id, status, attempt_count, error_code, created_at,
            updated_at
        FROM agent_jobs
        WHERE user_id = %s AND capture_id = %s AND capture_revision = %s
        """,
        (user_id, capture_id, capture["updated_at"]),
    ).fetchone()
    if job is None:
        _consume_daily_processing_request(connection, user_id=user_id)
        job = connection.execute(
            """
            INSERT INTO agent_jobs (user_id, capture_id, capture_revision)
            VALUES (%s, %s, %s)
            RETURNING id, capture_id, status, attempt_count, error_code, created_at,
                updated_at
            """,
            (user_id, capture_id, capture["updated_at"]),
        ).fetchone()
    elif job["status"] == "failed":
        _consume_daily_processing_request(connection, user_id=user_id)
        existing_job_id = job["id"]
        job = connection.execute(
            """
            UPDATE agent_jobs
            SET status = 'queued', attempt_count = 0, available_at = now(),
                error_code = NULL, updated_at = now()
            WHERE id = %s AND user_id = %s AND status = 'failed'
            RETURNING id, capture_id, status, attempt_count, error_code, created_at,
                updated_at
            """,
            (existing_job_id, user_id),
        ).fetchone()
        if job is None:
            job = connection.execute(
                """
                SELECT id, capture_id, status, attempt_count, error_code, created_at,
                    updated_at
                FROM agent_jobs WHERE id = %s AND user_id = %s
                """,
                (existing_job_id, user_id),
            ).fetchone()
    return job


def get_job_for_user(
    connection: psycopg.Connection,
    *,
    user_id: str,
    job_id: UUID,
) -> dict[str, Any] | None:
    return connection.execute(
        """
        SELECT j.id, j.capture_id, j.status, j.attempt_count, j.max_attempts,
            j.error_code,
            j.created_at, j.updated_at, s.id AS suggestion_id,
            s.status AS suggestion_status, s.schema_version, s.payload_json,
            s.accepted_payload_json, s.model_identifier, s.prompt_version,
            s.created_at AS suggestion_created_at, i.id AS item_id
        FROM agent_jobs j
        LEFT JOIN agent_suggestions s ON s.job_id = j.id AND s.user_id = j.user_id
        LEFT JOIN items i ON i.suggestion_id = s.id AND i.user_id = s.user_id
        WHERE j.id = %s AND j.user_id = %s
        """,
        (job_id, user_id),
    ).fetchone()


def claim_next_job(connection: psycopg.Connection) -> ClaimedJob | None:
    connection.execute(
        """
        UPDATE agent_jobs
        SET status = CASE
                WHEN attempt_count >= max_attempts THEN 'failed'
                ELSE 'queued'
            END,
            available_at = now(), locked_until = NULL, updated_at = now(),
            error_code = 'lease_expired'
        WHERE status = 'running' AND locked_until < now()
        """
    )
    connection.execute(
        """
        UPDATE agent_jobs j
        SET status = 'cancelled', error_code = 'capture_changed', updated_at = now()
        WHERE j.status = 'queued' AND NOT EXISTS (
            SELECT 1 FROM captures c
            WHERE c.id = j.capture_id AND c.user_id = j.user_id
                AND c.updated_at = j.capture_revision
        )
        """
    )
    claimed = connection.execute(
        """
        WITH candidate AS (
            SELECT j.id, c.current_text
            FROM agent_jobs j
            JOIN captures c ON c.id = j.capture_id AND c.user_id = j.user_id
                AND c.updated_at = j.capture_revision
            WHERE j.status = 'queued' AND j.available_at <= now()
            ORDER BY j.created_at, j.id
            FOR UPDATE OF j SKIP LOCKED
            LIMIT 1
        )
        UPDATE agent_jobs j
        SET status = 'running', attempt_count = j.attempt_count + 1,
            locked_until = now() + (%s * interval '1 second'),
            updated_at = now(), error_code = NULL
        FROM candidate c
        WHERE j.id = c.id
        RETURNING j.id, j.user_id, j.capture_id, j.capture_revision,
            j.attempt_count, c.current_text
        """,
        (LEASE_SECONDS,),
    ).fetchone()
    if claimed is None:
        return None
    return ClaimedJob(
        id=claimed["id"],
        user_id=claimed["user_id"],
        capture_id=claimed["capture_id"],
        capture_revision=claimed["capture_revision"],
        source_text=claimed["current_text"],
        attempt_count=claimed["attempt_count"],
    )


def _save_suggestion(
    connection: psycopg.Connection,
    job: ClaimedJob,
    result: ModelProposalResult,
) -> bool:
    succeeded = connection.execute(
        """
        UPDATE agent_jobs j
        SET status = 'succeeded', locked_until = NULL, error_code = NULL,
            updated_at = now()
        WHERE j.id = %s AND j.status = 'running' AND j.attempt_count = %s
            AND j.capture_revision = %s
            AND EXISTS (
                SELECT 1 FROM captures c
                WHERE c.id = j.capture_id AND c.user_id = j.user_id
                    AND c.updated_at = j.capture_revision
            )
        RETURNING j.id
        """,
        (job.id, job.attempt_count, job.capture_revision),
    ).fetchone()
    if succeeded is None:
        connection.execute(
            """
            UPDATE agent_jobs SET status = 'cancelled', locked_until = NULL,
                error_code = 'capture_changed', updated_at = now()
            WHERE id = %s AND status = 'running' AND attempt_count = %s
            """,
            (job.id, job.attempt_count),
        )
        return False

    connection.execute(
        """
        INSERT INTO agent_suggestions (
            job_id, user_id, capture_id, schema_version, payload_json,
            model_identifier, prompt_version
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (job_id) DO NOTHING
        """,
        (
            job.id,
            job.user_id,
            job.capture_id,
            result.proposal.schema_version,
            Jsonb(result.proposal.model_dump(mode="json")),
            result.model_identifier,
            result.prompt_version,
        ),
    )
    return True


def _record_failure(
    connection: psycopg.Connection,
    job: ClaimedJob,
    *,
    error_code: str,
    retryable: bool,
) -> None:
    retry = retryable and job.attempt_count < MAX_ATTEMPTS
    backoff_seconds = min(15 * (2 ** (job.attempt_count - 1)), 300)
    delay = timedelta(seconds=backoff_seconds if retry else 0)
    connection.execute(
        """
        UPDATE agent_jobs
        SET status = %s, error_code = %s, locked_until = NULL,
            available_at = now() + %s, updated_at = now()
        WHERE id = %s AND status = 'running' AND attempt_count = %s
        """,
        (
            "queued" if retry else "failed",
            error_code,
            delay,
            job.id,
            job.attempt_count,
        ),
    )


def process_next_job(
    connection_factory: Callable[[], psycopg.Connection],
    adapter: ModelAdapter,
) -> bool:
    with connection_factory() as connection:
        job = claim_next_job(connection)
    if job is None:
        return False

    try:
        result = adapter.propose_capture(job.source_text)
    except ModelTemporarilyUnavailable:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="provider_unavailable",
                retryable=True,
            )
        return True
    except ModelOutputError:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="invalid_output",
                retryable=False,
            )
        return True
    except ModelAdapterError:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="provider_rejected",
                retryable=False,
            )
        return True
    except Exception:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="processing_error",
                retryable=False,
            )
        raise

    with connection_factory() as connection:
        _save_suggestion(connection, job, result)
    return True
