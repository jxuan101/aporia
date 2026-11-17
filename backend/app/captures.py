from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from psycopg import Connection

from app.auth import current_user_id
from app.database import get_connection
from app.errors import ApiError
from app.validation import capture_body, capture_id, read_json_body, search_query

router = APIRouter(prefix="/api/v1/captures")
PAGE_SIZE = 30


def serialize_capture(row: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(row["id"]),
        "originalText": row["raw_text"],
        "currentText": row["current_text"],
        "createdAt": row["created_at"].isoformat().replace("+00:00", "Z"),
        "updatedAt": row["updated_at"].isoformat().replace("+00:00", "Z"),
    }


@router.get("")
def list_captures(
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
    q: str | None = Query(default=None),
    before: str | None = Query(default=None),
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)

    query = search_query(q)
    cursor_id: UUID | None = capture_id(before) if before is not None else None
    cursor = None
    if cursor_id:
        cursor = connection.execute(
            """
            SELECT id, created_at FROM captures
            WHERE id = %s AND user_id = %s LIMIT 1
            """,
            (cursor_id, user_id),
        ).fetchone()
        if cursor is None:
            raise ApiError("The page cursor is invalid.", 400)

    clauses = ["user_id = %s"]
    params: list[object] = [user_id]
    if cursor:
        clauses.append("(created_at, id) < (%s, %s)")
        params.extend((cursor["created_at"], cursor["id"]))
    if query:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        clauses.append(
            "(raw_text ILIKE %s ESCAPE E'\\\\' OR current_text ILIKE %s ESCAPE E'\\\\')"
        )
        params.extend((pattern, pattern))

    rows = connection.execute(
        f"""
        SELECT id, raw_text, current_text, created_at, updated_at
        FROM captures
        WHERE {" AND ".join(clauses)}
        ORDER BY created_at DESC, id DESC
        LIMIT %s
        """,
        (*params, PAGE_SIZE + 1),
    ).fetchall()
    has_more = len(rows) > PAGE_SIZE
    visible = rows[:PAGE_SIZE]
    return {
        "captures": [serialize_capture(row) for row in visible],
        "nextCursor": str(visible[-1]["id"]) if has_more else None,
    }


@router.post("", status_code=201)
async def create_capture(
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    text = capture_body(await read_json_body(request))
    row = connection.execute(
        """
        INSERT INTO captures (user_id, raw_text, current_text)
        VALUES (%s, %s, %s)
        RETURNING id, raw_text, current_text, created_at, updated_at
        """,
        (user_id, text, text),
    ).fetchone()
    return {"capture": serialize_capture(row)}


@router.patch("/{capture_id}")
async def update_capture(
    capture_id: str,
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    parsed_id = capture_id_value(capture_id)
    text = capture_body(await read_json_body(request))
    row = connection.execute(
        """
        UPDATE captures SET current_text = %s, updated_at = now()
        WHERE id = %s AND user_id = %s
        RETURNING id, raw_text, current_text, created_at, updated_at
        """,
        (text, parsed_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError("The capture is unavailable.", 404)
    return {"capture": serialize_capture(row)}


@router.delete("/{capture_id}", status_code=204)
def delete_capture(
    capture_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> None:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    parsed_id = capture_id_value(capture_id)
    deleted = connection.execute(
        "DELETE FROM captures WHERE id = %s AND user_id = %s RETURNING id",
        (parsed_id, user_id),
    ).fetchone()
    if deleted is None:
        raise ApiError("The capture is unavailable.", 404)


def capture_id_value(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise ApiError("The capture is unavailable.", 404) from None
