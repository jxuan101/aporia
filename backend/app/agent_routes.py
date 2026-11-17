"""Authenticated API endpoints for explicit capture processing."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from psycopg import Connection

from app.agent_jobs import enqueue_capture_job, get_job_for_user
from app.auth import current_user_id
from app.database import get_connection
from app.errors import ApiError

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
            "modelIdentifier": row["model_identifier"],
            "promptVersion": row["prompt_version"],
            "createdAt": row["suggestion_created_at"]
            .isoformat()
            .replace("+00:00", "Z"),
        }
    return {
        "id": str(row["id"]),
        "captureId": str(row["capture_id"]),
        "status": row["status"],
        "attemptCount": row["attempt_count"],
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

    job = enqueue_capture_job(
        connection,
        user_id=user_id,
        capture_id=_path_uuid(capture_id),
    )
    if job is None:
        raise ApiError("The requested job or capture is unavailable.", 404)
    return {"job": _serialize_job(job)}


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
