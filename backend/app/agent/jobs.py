"""PostgreSQL-backed, revision-scoped capture processing jobs."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from app.agent.model_adapter import (
    ModelAdapter,
    ModelAdapterError,
    ModelOutputError,
    ModelProposalResult,
    ModelTemporarilyUnavailable,
)
from app.core.config import AI_DAILY_PROCESSING_LIMIT
from app.items.related import RelatedItemCandidate, find_related_item_candidates

MAX_ATTEMPTS = 3
MAX_DAILY_PROCESSING_REQUESTS_PER_USER = AI_DAILY_PROCESSING_LIMIT
LEASE_SECONDS = 120
POLL_INTERVAL_SECONDS = 1
logger = logging.getLogger("aporia.agent_jobs")


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
    related_items: list[RelatedItemCandidate]


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
        SELECT j.id, j.capture_id, j.status, j.attempt_count, j.error_code,
            j.created_at, j.updated_at, s.status AS suggestion_status,
            EXISTS (
                SELECT 1 FROM items i
                WHERE i.user_id = j.user_id AND i.capture_id = j.capture_id
            ) AS has_saved_item
        FROM agent_jobs j
        LEFT JOIN agent_suggestions s ON s.job_id = j.id AND s.user_id = j.user_id
        WHERE j.user_id = %s AND j.capture_id = %s AND j.capture_revision = %s
        ORDER BY j.created_at DESC
        LIMIT 1
        """,
        (user_id, capture_id, capture["updated_at"]),
    ).fetchone()
    if job is None or (
        job["status"] == "succeeded"
        and (
            job["suggestion_status"] == "rejected"
            or (job["suggestion_status"] == "accepted" and not job["has_saved_item"])
        )
    ):
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
    row = connection.execute(
        """
        SELECT j.id, j.capture_id, j.status, j.attempt_count, j.max_attempts,
            j.error_code,
            j.created_at, j.updated_at, s.id AS suggestion_id,
            s.status AS suggestion_status, s.schema_version, s.payload_json,
            s.accepted_payload_json, s.model_identifier, s.prompt_version,
            s.created_at AS suggestion_created_at, i.id AS item_id
        FROM agent_jobs j
        LEFT JOIN agent_suggestions s ON s.job_id = j.id AND s.user_id = j.user_id
        LEFT JOIN LATERAL (
            SELECT id FROM items
            WHERE user_id = j.user_id AND capture_id = j.capture_id
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
        ) i ON TRUE
        WHERE j.id = %s AND j.user_id = %s
        """,
        (job_id, user_id),
    ).fetchone()
    if row is None:
        return None

    payload = (
        row["accepted_payload_json"]
        if row["suggestion_status"] == "accepted"
        else row["payload_json"]
    )
    related_ids = payload.get("related_item_ids", []) if payload else []
    parsed_ids: list[UUID] = []
    if isinstance(related_ids, list):
        for related_id in related_ids:
            try:
                parsed_ids.append(UUID(str(related_id)))
            except (ValueError, TypeError):
                continue
    related_rows = (
        connection.execute(
            """
            SELECT id, item_type, title, summary
            FROM items WHERE user_id = %s AND id = ANY(%s)
            """,
            (user_id, parsed_ids),
        ).fetchall()
        if parsed_ids
        else []
    )
    related_by_id = {item["id"]: item for item in related_rows}
    row["related_items"] = [
        {
            "id": str(related_by_id[item_id]["id"]),
            "type": related_by_id[item_id]["item_type"],
            "title": related_by_id[item_id]["title"],
            "summary": related_by_id[item_id]["summary"],
        }
        for item_id in parsed_ids
        if item_id in related_by_id
    ]
    return row


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
    related_items = find_related_item_candidates(
        connection,
        user_id=claimed["user_id"],
        capture_id=claimed["capture_id"],
        capture_text=claimed["current_text"],
    )
    return ClaimedJob(
        id=claimed["id"],
        user_id=claimed["user_id"],
        capture_id=claimed["capture_id"],
        capture_revision=claimed["capture_revision"],
        source_text=claimed["current_text"],
        attempt_count=claimed["attempt_count"],
        related_items=related_items,
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

    logger.info(
        "agent_job_started job_id=%s attempt=%d",
        job.id,
        job.attempt_count,
    )

    try:
        contextual_proposal = getattr(adapter, "propose_capture_with_context", None)
        if callable(contextual_proposal):
            result = contextual_proposal(job.source_text, job.related_items)
        else:
            result = adapter.propose_capture(job.source_text)
    except ModelTemporarilyUnavailable as error:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="provider_unavailable",
                retryable=True,
            )
        logger.warning(
            "agent_job_provider_unavailable job_id=%s attempt=%d will_retry=%s "
            "provider_status_code=%s provider_reason=%s provider_error_type=%s "
            "provider_error_code=%s",
            job.id,
            job.attempt_count,
            job.attempt_count < MAX_ATTEMPTS,
            error.provider_status_code,
            error.provider_reason,
            error.provider_error_type,
            error.provider_error_code,
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
        logger.warning(
            "agent_job_failed job_id=%s attempt=%d error_code=invalid_output",
            job.id,
            job.attempt_count,
        )
        return True
    except ModelAdapterError as error:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="provider_rejected",
                retryable=False,
            )
        logger.warning(
            "agent_job_failed job_id=%s attempt=%d error_code=provider_rejected "
            "provider_status_code=%s provider_reason=%s provider_error_type=%s "
            "provider_error_code=%s",
            job.id,
            job.attempt_count,
            error.provider_status_code,
            error.provider_reason,
            error.provider_error_type,
            error.provider_error_code,
        )
        return True
    except Exception as error:
        with connection_factory() as connection:
            _record_failure(
                connection,
                job,
                error_code="processing_error",
                retryable=False,
            )
        logger.error(
            "agent_job_failed job_id=%s attempt=%d error_code=processing_error "
            "exception_type=%s",
            job.id,
            job.attempt_count,
            type(error).__name__,
        )
        raise

    with connection_factory() as connection:
        _save_suggestion(connection, job, result)
    logger.info("agent_job_succeeded job_id=%s attempt=%d", job.id, job.attempt_count)
    return True
