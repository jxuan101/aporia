"""User-scoped daily capture review queue and deferral actions."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from psycopg import Connection

from app.auth import current_user_id
from app.captures import PAGE_SIZE, serialize_capture
from app.database import get_connection
from app.errors import ApiError
from app.validation import capture_id

router = APIRouter(prefix="/api/v1/review")


def _serialize_queue_entry(row: dict[str, Any]) -> dict[str, object]:
    job = None
    if row["job_id"] is not None:
        job = {
            "id": str(row["job_id"]),
            "status": row["job_status"],
            "attemptCount": row["attempt_count"],
            "maxAttempts": row["max_attempts"],
            "errorCode": row["error_code"],
        }
    suggestion = None
    if row["suggestion_id"] is not None:
        suggestion = {
            "id": str(row["suggestion_id"]),
            "proposal": row["payload_json"],
            "relatedItems": row["related_items"] or [],
        }
    return {
        "capture": serialize_capture(row),
        "reviewStatus": row["review_status"],
        "priority": row["priority"],
        "priorityExplanation": row["priority_explanation"],
        "job": job,
        "suggestion": suggestion,
    }


def _capture_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise ApiError("The requested capture is unavailable.", 404) from None


@router.get("/daily")
def read_daily_review_queue(
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
    before: str | None = Query(default=None),
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)

    cursor_id = capture_id(before) if before is not None else None
    cursor = None
    if cursor_id:
        cursor = connection.execute(
            "SELECT id, created_at FROM captures WHERE id = %s AND user_id = %s",
            (cursor_id, user_id),
        ).fetchone()
        if cursor is None:
            raise ApiError("The page cursor is invalid.", 400)

    clauses = ["user_id = %s"]
    params: list[object] = [user_id, user_id]
    if cursor:
        clauses.append("(created_at, id) > (%s, %s)")
        params.extend((cursor["created_at"], cursor["id"]))
    rows = connection.execute(
        f"""
        WITH review_queue AS (
            SELECT c.id, c.user_id, c.raw_text, c.current_text, c.created_at,
                c.updated_at, j.id AS job_id, j.status AS job_status,
                j.attempt_count, j.max_attempts, j.error_code,
                s.id AS suggestion_id, s.payload_json,
                related.related_items,
                CASE
                    WHEN s.status = 'pending' THEN 'suggestion_ready'
                    WHEN j.status = 'failed' THEN 'processing_failed'
                    WHEN j.status IN ('queued', 'running') THEN 'processing'
                    ELSE 'needs_processing'
                END AS review_status,
                CASE
                    WHEN s.status = 'pending' OR j.status = 'failed' THEN 'high'
                    WHEN j.status IN ('queued', 'running') THEN 'low'
                    ELSE 'normal'
                END AS priority,
                CASE
                    WHEN s.status = 'pending'
                        THEN 'An AI proposal is ready for your decision.'
                    WHEN j.status = 'failed'
                        THEN 'Processing did not finish; this capture can be retried.'
                    WHEN j.status IN ('queued', 'running')
                        THEN 'Processing is already in progress.'
                    ELSE 'This capture has not been processed yet.'
                END AS priority_explanation
            FROM captures c
            LEFT JOIN agent_jobs j ON j.capture_id = c.id AND j.user_id = c.user_id
                AND j.capture_revision = c.updated_at
            LEFT JOIN agent_suggestions s ON s.job_id = j.id AND s.user_id = j.user_id
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(jsonb_build_object(
                    'id', i.id,
                    'type', i.item_type,
                    'title', i.title,
                    'summary', i.summary
                )) AS related_items
                FROM jsonb_array_elements_text(
                    COALESCE(s.payload_json->'related_item_ids', '[]'::jsonb)
                ) AS candidate(item_id)
                JOIN items i ON i.id = candidate.item_id::uuid
                    AND i.user_id = c.user_id
            ) related ON TRUE
            LEFT JOIN capture_review_deferrals d
                ON d.capture_id = c.id AND d.user_id = c.user_id
                AND d.capture_revision = c.updated_at
            WHERE c.user_id = %s
                AND (d.deferred_until IS NULL OR d.deferred_until <= now())
                AND (j.id IS NULL OR j.status IN ('queued', 'running', 'failed')
                    OR s.status = 'pending'
                    OR (j.status = 'succeeded' AND s.status = 'accepted'
                        AND NOT EXISTS (
                            SELECT 1 FROM items i
                            WHERE i.user_id = c.user_id AND i.capture_id = c.id
                        )))
        )
        SELECT * FROM review_queue
        WHERE {" AND ".join(clauses)}
        ORDER BY created_at ASC, id ASC
        LIMIT %s
        """,
        (*params, PAGE_SIZE + 1),
    ).fetchall()
    has_more = len(rows) > PAGE_SIZE
    visible = rows[:PAGE_SIZE]
    return {
        "entries": [_serialize_queue_entry(row) for row in visible],
        "nextCursor": str(visible[-1]["id"]) if has_more else None,
    }


@router.post("/captures/{capture_id}/defer")
def defer_capture_review(
    capture_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    parsed_id = _capture_id(capture_id)
    capture = connection.execute(
        "SELECT id, updated_at FROM captures WHERE id = %s AND user_id = %s",
        (parsed_id, user_id),
    ).fetchone()
    if capture is None:
        raise ApiError("The requested capture is unavailable.", 404)

    deferred = connection.execute(
        """
        INSERT INTO capture_review_deferrals (
            user_id, capture_id, capture_revision, deferred_until
        ) VALUES (%s, %s, %s, now() + interval '24 hours')
        ON CONFLICT (user_id, capture_id, capture_revision) DO UPDATE
        SET deferred_until = now() + interval '24 hours', updated_at = now()
        RETURNING deferred_until
        """,
        (user_id, parsed_id, capture["updated_at"]),
    ).fetchone()
    return {
        "captureId": str(parsed_id),
        "deferredUntil": deferred["deferred_until"].isoformat().replace("+00:00", "Z"),
    }
