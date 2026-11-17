from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from psycopg import Connection

from app.auth import current_user_id
from app.captures import serialize_capture
from app.database import get_connection
from app.errors import API_HEADERS, ApiError

router = APIRouter(prefix="/api/v1/export")


@router.get("")
def export_captures(
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> JSONResponse:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    rows = connection.execute(
        """
        SELECT id, raw_text, current_text, created_at, updated_at
        FROM captures WHERE user_id = %s ORDER BY created_at DESC, id DESC
        """,
        (user_id,),
    ).fetchall()
    captures = [serialize_capture(row) for row in rows]
    payload: dict[str, Any] = {
        "schema_version": "1",
        "exported_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "captures": [
            {
                "id": capture["id"],
                "original_text": capture["originalText"],
                "current_text": capture["currentText"],
                "created_at": capture["createdAt"],
                "updated_at": capture["updatedAt"],
            }
            for capture in captures
        ],
    }
    return JSONResponse(
        payload,
        headers={
            **API_HEADERS,
            "Content-Disposition": 'attachment; filename="braindump-export.json"',
        },
    )
