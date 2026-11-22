"""Authenticated API endpoints for explicit capture processing."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from psycopg import Connection
from pydantic import ValidationError

from app.agent.jobs import (
    MAX_DAILY_PROCESSING_REQUESTS_PER_USER,
    ProcessingUsageLimitError,
    enqueue_capture_job,
    get_job_for_user,
)
from app.agent.model_factory import configured_model_adapter
from app.agent.review import (
    ReviewConflictError,
    accept_suggestion,
    reject_suggestion,
)
from app.auth.routes import current_user_id
from app.core.database import get_connection
from app.core.errors import ApiError
from app.core.validation import read_json_body

router = APIRouter(prefix="/api/v1")


def _path_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise ApiError("The requested job or capture is unavailable.", 404) from None


def _serialize_job(row: dict[str, Any]) -> dict[str, object]:
    suggestion_id = row.get("suggestion_id")
    suggestion = None
    if suggestion_id is not None:
        suggestion = {
            "id": str(suggestion_id),
            "schemaVersion": row["schema_version"],
            "proposal": row["payload_json"],
            "status": row["suggestion_status"],
            "acceptedProposal": row["accepted_payload_json"],
            "itemId": str(row["item_id"]) if row["item_id"] else None,
            "modelIdentifier": row["model_identifier"],
            "promptVersion": row["prompt_version"],
            "relatedItems": row.get("related_items", []),
            "createdAt": row["suggestion_created_at"]
            .isoformat()
            .replace("+00:00", "Z"),
        }
    return {
        "id": str(row["id"]),
        "captureId": str(row["capture_id"]),
        "status": row["status"],
        "attemptCount": row["attempt_count"],
        "maxAttempts": row["max_attempts"],
        "errorCode": row["error_code"],
        "createdAt": row["created_at"].isoformat().replace("+00:00", "Z"),
        "updatedAt": row["updated_at"].isoformat().replace("+00:00", "Z"),
        "suggestion": suggestion,
    }


@router.post("/captures/{capture_id}/process", status_code=202)
def request_capture_processing(
    capture_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)

    try:
        adapter = configured_model_adapter()
    except RuntimeError:
        adapter = None
    if adapter is None:
        raise ApiError(
            "AI processing is not configured on this server.",
            503,
            code="provider_unavailable",
        )

    try:
        job = enqueue_capture_job(
            connection,
            user_id=user_id,
            capture_id=_path_uuid(capture_id),
        )
    except ProcessingUsageLimitError:
        raise ApiError(
            "Daily AI processing limit reached "
            f"({MAX_DAILY_PROCESSING_REQUESTS_PER_USER} per UTC day). "
            "Try again after 00:00 UTC.",
            429,
            code="daily_processing_limit",
        ) from None
    if job is None:
        raise ApiError("The requested job or capture is unavailable.", 404)
    full_job = get_job_for_user(connection, user_id=user_id, job_id=job["id"])
    if full_job is None:
        raise ApiError("The requested job or capture is unavailable.", 404)
    return {"job": _serialize_job(full_job)}


@router.get("/agent/jobs/{job_id}")
def read_processing_job(
    job_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)

    job = get_job_for_user(
        connection,
        user_id=user_id,
        job_id=_path_uuid(job_id),
    )
    if job is None:
        raise ApiError("The requested job or capture is unavailable.", 404)
    return {"job": _serialize_job(job)}


@router.post("/agent/suggestions/{suggestion_id}/accept")
async def accept_processing_suggestion(
    suggestion_id: str,
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    body = await read_json_body(request, max_bytes=70_000)
    if not isinstance(body, dict) or set(body) != {"proposal"}:
        raise ApiError("A valid edited proposal is required.", 400)
    try:
        result = accept_suggestion(
            connection,
            user_id=user_id,
            suggestion_id=_path_uuid(suggestion_id),
            proposal_data=body["proposal"],
        )
    except (ValidationError, ValueError):
        raise ApiError("The edited proposal did not pass validation.", 400) from None
    except ReviewConflictError as error:
        raise ApiError(str(error), 409) from None
    if result is None:
        raise ApiError("The requested suggestion is unavailable.", 404)
    return {"suggestion": result}


@router.post("/agent/suggestions/{suggestion_id}/reject")
def reject_processing_suggestion(
    suggestion_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    try:
        result = reject_suggestion(
            connection,
            user_id=user_id,
            suggestion_id=_path_uuid(suggestion_id),
        )
    except ReviewConflictError as error:
        raise ApiError(str(error), 409) from None
    if result is None:
        raise ApiError("The requested suggestion is unavailable.", 404)
    return {"suggestion": result}
