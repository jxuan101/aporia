"""Authenticated read APIs for items created from reviewed suggestions."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from psycopg import Connection

from app.auth import current_user_id
from app.database import get_connection
from app.errors import ApiError
from app.validation import capture_id, search_query

router = APIRouter(prefix="/api/v1/items")
PAGE_SIZE = 30


def _serialize_item(row: dict[str, Any]) -> dict[str, object]:
    return {
        "id": str(row["id"]),
        "captureId": str(row["capture_id"]),
        "type": row["item_type"],
        "title": row["title"],
        "summary": row["summary"],
        "labels": row["labels_json"],
        "candidateTasks": row["candidate_tasks_json"],
        "createdAt": row["created_at"].isoformat().replace("+00:00", "Z"),
        "updatedAt": row["updated_at"].isoformat().replace("+00:00", "Z"),
    }


@router.get("")
def list_items(
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
            SELECT id, created_at FROM items
            WHERE id = %s AND user_id = %s
            LIMIT 1
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
        clauses.append(
            "to_tsvector('english', title || ' ' || summary || ' ' || "
            "labels_json::text || ' ' || candidate_tasks_json::text) "
            "@@ websearch_to_tsquery('english', %s)"
        )
        params.append(query)

    rows = connection.execute(
        f"""
        SELECT id, capture_id, item_type, title, summary, labels_json,
            candidate_tasks_json, created_at, updated_at
        FROM items
        WHERE {" AND ".join(clauses)}
        ORDER BY created_at DESC, id DESC
        LIMIT %s
        """,
        (*params, PAGE_SIZE + 1),
    ).fetchall()
    has_more = len(rows) > PAGE_SIZE
    visible = rows[:PAGE_SIZE]
    return {
        "items": [_serialize_item(row) for row in visible],
        "nextCursor": str(visible[-1]["id"]) if has_more else None,
    }


@router.get("/{item_id}")
def read_item(
    item_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    try:
        parsed_id = UUID(item_id)
    except ValueError:
        raise ApiError("The requested item is unavailable.", 404) from None

    row = connection.execute(
        """
        SELECT i.id, i.capture_id, i.item_type, i.title, i.summary, i.labels_json,
            i.candidate_tasks_json, i.created_at, i.updated_at,
            c.raw_text, c.current_text
        FROM items i
        JOIN captures c ON c.id = i.capture_id AND c.user_id = i.user_id
        WHERE i.id = %s AND i.user_id = %s
        """,
        (parsed_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError("The requested item is unavailable.", 404)

    item = _serialize_item(row)
    item["capture"] = {
        "originalText": row["raw_text"],
        "currentText": row["current_text"],
    }
    return {"item": item}
