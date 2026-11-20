"""Authenticated read APIs for items created from reviewed suggestions."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from psycopg import Connection
from psycopg.types.json import Jsonb

from app.auth import current_user_id
from app.database import get_connection
from app.errors import ApiError
from app.text_signals import meaningful_terms
from app.validation import capture_id, read_json_body, search_query

router = APIRouter(prefix="/api/v1/items")
PAGE_SIZE = 30
RELATED_CANDIDATE_LIMIT = 500
RELATED_SUGGESTION_LIMIT = 10


def _serialize_item(row: dict[str, Any]) -> dict[str, object]:
    return {
        "id": str(row["id"]),
        "captureId": str(row["capture_id"]),
        "type": row["item_type"],
        "title": row["title"],
        "summary": row["summary"],
        "labels": row["labels_json"],
        "candidateTasks": row["candidate_tasks_json"],
        "completedTaskIndexes": row["completed_task_indexes_json"],
        "createdAt": row["created_at"].isoformat().replace("+00:00", "Z"),
        "updatedAt": row["updated_at"].isoformat().replace("+00:00", "Z"),
    }


def _related_search_text(row: dict[str, Any]) -> str:
    task_text: list[str] = []
    for task in row["candidate_tasks_json"]:
        if isinstance(task, dict):
            task_text.extend(
                value
                for key in ("title", "source_text", "due_date")
                if isinstance((value := task.get(key)), str)
            )
    return " ".join(
        (
            row["title"],
            row["summary"],
            *row["labels_json"],
            *task_text,
            row["current_text"],
        )
    )


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
            candidate_tasks_json, completed_task_indexes_json, created_at, updated_at
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
            i.candidate_tasks_json, i.completed_task_indexes_json,
            i.created_at, i.updated_at,
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


@router.put("/{item_id}/tasks/{task_index}/completion")
async def update_task_completion(
    item_id: str,
    task_index: int,
    request: Request,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    try:
        parsed_id = UUID(item_id)
    except ValueError:
        raise ApiError("The requested item is unavailable.", 404) from None
    body = await read_json_body(request)
    if (
        not isinstance(body, dict)
        or set(body) != {"completed"}
        or not isinstance(body["completed"], bool)
    ):
        raise ApiError("Choose whether the step is complete.", 400)
    row = connection.execute(
        """
        SELECT candidate_tasks_json, completed_task_indexes_json
        FROM items WHERE id = %s AND user_id = %s FOR UPDATE
        """,
        (parsed_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError("The requested item is unavailable.", 404)
    if task_index < 0 or task_index >= len(row["candidate_tasks_json"]):
        raise ApiError("The requested step is unavailable.", 404)
    completed = set(row["completed_task_indexes_json"])
    if body["completed"]:
        completed.add(task_index)
    else:
        completed.discard(task_index)
    indexes = sorted(completed)
    connection.execute(
        """
        UPDATE items SET completed_task_indexes_json = %s, updated_at = now()
        WHERE id = %s AND user_id = %s
        """,
        (Jsonb(indexes), parsed_id, user_id),
    )
    return {"completedTaskIndexes": indexes}


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
    delete_capture: bool = Query(default=False),
    delete_linked: bool = Query(default=False),
) -> None:
    """Delete one item, with separately confirmed source and linked records."""
    if not user_id:
        raise ApiError("Authentication required.", 401)
    try:
        parsed_id = UUID(item_id)
    except ValueError:
        raise ApiError("The requested item is unavailable.", 404) from None

    item = connection.execute(
        """
        SELECT i.capture_id FROM items i
        JOIN captures c ON c.id = i.capture_id AND c.user_id = i.user_id
        WHERE i.id = %s AND i.user_id = %s
        FOR UPDATE OF i, c
        """,
        (parsed_id, user_id),
    ).fetchone()
    if item is None:
        raise ApiError("The requested item is unavailable.", 404)

    linked_rows = connection.execute(
        """
        SELECT i.id, i.capture_id
        FROM item_relationships r
        JOIN items i ON i.user_id = r.user_id
            AND i.id = CASE
                WHEN r.item_low = %s THEN r.item_high
                ELSE r.item_low
            END
        WHERE r.user_id = %s AND (r.item_low = %s OR r.item_high = %s)
        FOR UPDATE OF i
        """,
        (parsed_id, user_id, parsed_id, parsed_id),
    ).fetchall()
    linked_item_ids = [row["id"] for row in linked_rows]

    connection.execute(
        "DELETE FROM items WHERE id = %s AND user_id = %s",
        (parsed_id, user_id),
    )

    capture_ids: list[UUID] = []
    if delete_capture:
        capture_ids.append(item["capture_id"])
    if delete_linked:
        if linked_item_ids:
            connection.execute(
                "DELETE FROM items WHERE user_id = %s AND id = ANY(%s)",
                (user_id, linked_item_ids),
            )
        capture_ids.extend(row["capture_id"] for row in linked_rows)
    if capture_ids:
        connection.execute(
            "DELETE FROM captures WHERE user_id = %s AND id = ANY(%s)",
            (user_id, capture_ids),
        )


@router.get("/{item_id}/related")
def read_related_items(
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

    source = connection.execute(
        """
        SELECT i.id, i.title, i.summary, i.labels_json, i.candidate_tasks_json,
            c.current_text
        FROM items i
        JOIN captures c ON c.id = i.capture_id AND c.user_id = i.user_id
        WHERE i.id = %s AND i.user_id = %s
        """,
        (parsed_id, user_id),
    ).fetchone()
    if source is None:
        raise ApiError("The requested item is unavailable.", 404)

    linked_ids = [
        row["related_id"]
        for row in connection.execute(
            """
            SELECT CASE WHEN item_low = %s THEN item_high ELSE item_low END
                AS related_id
            FROM item_relationships
            WHERE user_id = %s AND (item_low = %s OR item_high = %s)
            """,
            (parsed_id, user_id, parsed_id, parsed_id),
        ).fetchall()
    ]
    related_items = []
    if linked_ids:
        rows = connection.execute(
            """
            SELECT id, capture_id, item_type, title, summary, labels_json,
                candidate_tasks_json, completed_task_indexes_json,
                created_at, updated_at
            FROM items
            WHERE user_id = %s AND id = ANY(%s)
            ORDER BY created_at DESC, id DESC
            """,
            (user_id, linked_ids),
        ).fetchall()
        related_items = [_serialize_item(row) for row in rows]

    source_terms = meaningful_terms(_related_search_text(source))
    candidate_rows = connection.execute(
        """
        SELECT i.id, i.capture_id, i.item_type, i.title, i.summary, i.labels_json,
            i.candidate_tasks_json, i.completed_task_indexes_json,
            i.created_at, i.updated_at, c.current_text
        FROM items i
        JOIN captures c ON c.id = i.capture_id AND c.user_id = i.user_id
        WHERE i.user_id = %s AND i.id <> %s
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT %s
        """,
        (user_id, parsed_id, RELATED_CANDIDATE_LIMIT),
    ).fetchall()
    linked_id_set = set(linked_ids)
    scored_suggestions: list[tuple[float, str, dict[str, object]]] = []
    for row in candidate_rows:
        if row["id"] in linked_id_set:
            continue
        candidate_terms = meaningful_terms(_related_search_text(row))
        common_terms = source_terms.intersection(candidate_terms)
        if len(common_terms) < 2:
            continue
        score = len(common_terms) / len(source_terms.union(candidate_terms))
        scored_suggestions.append(
            (
                score,
                row["created_at"].isoformat(),
                {
                    "item": _serialize_item(row),
                    "matchTerms": sorted(
                        common_terms, key=lambda term: (-len(term), term)
                    )[:5],
                    "score": round(score, 3),
                },
            )
        )
    scored_suggestions.sort(key=lambda result: (result[0], result[1]), reverse=True)
    return {
        "relatedItems": related_items,
        "suggestions": [
            result[2] for result in scored_suggestions[:RELATED_SUGGESTION_LIMIT]
        ],
    }


def _related_item_ids(item_id: str, related_item_id: str) -> tuple[UUID, UUID]:
    try:
        return UUID(item_id), UUID(related_item_id)
    except ValueError:
        raise ApiError("The requested item is unavailable.", 404) from None


@router.post("/{item_id}/related/{related_item_id}", status_code=201)
def add_related_item(
    item_id: str,
    related_item_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> dict[str, object]:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    parsed_item_id, parsed_related_id = _related_item_ids(item_id, related_item_id)
    if parsed_item_id == parsed_related_id:
        raise ApiError("An item cannot be linked to itself.", 400)
    owned_ids = connection.execute(
        "SELECT id FROM items WHERE user_id = %s AND id = ANY(%s)",
        (user_id, [parsed_item_id, parsed_related_id]),
    ).fetchall()
    if len(owned_ids) != 2:
        raise ApiError("The requested item is unavailable.", 404)
    item_low, item_high = sorted((parsed_item_id, parsed_related_id))
    connection.execute(
        """
        INSERT INTO item_relationships (user_id, item_low, item_high)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, item_low, item_high) DO NOTHING
        """,
        (user_id, item_low, item_high),
    )
    return {
        "relationship": {
            "itemId": str(parsed_item_id),
            "relatedItemId": str(parsed_related_id),
        }
    }


@router.delete("/{item_id}/related/{related_item_id}", status_code=204)
def remove_related_item(
    item_id: str,
    related_item_id: str,
    connection: Annotated[Connection, Depends(get_connection)],
    user_id: Annotated[str | None, Depends(current_user_id)],
) -> None:
    if not user_id:
        raise ApiError("Authentication required.", 401)
    parsed_item_id, parsed_related_id = _related_item_ids(item_id, related_item_id)
    if parsed_item_id == parsed_related_id:
        raise ApiError("The requested relationship is unavailable.", 404)
    item_low, item_high = sorted((parsed_item_id, parsed_related_id))
    deleted = connection.execute(
        """
        DELETE FROM item_relationships
        WHERE user_id = %s AND item_low = %s AND item_high = %s
        RETURNING item_low
        """,
        (user_id, item_low, item_high),
    ).fetchone()
    if deleted is None:
        raise ApiError("The requested relationship is unavailable.", 404)
