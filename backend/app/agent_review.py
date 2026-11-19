"""User-approved review decisions for validated processing proposals."""

from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from app.agent_schema import validate_proposal_data


class ReviewConflictError(Exception):
    """The suggestion is no longer available for the requested decision."""


def _review_row(
    connection: psycopg.Connection,
    *,
    user_id: str,
    suggestion_id: UUID,
) -> dict[str, Any] | None:
    return connection.execute(
        """
        SELECT s.id, s.status, s.accepted_payload_json, s.capture_id,
            j.capture_revision, c.updated_at, c.current_text
        FROM agent_suggestions s
        JOIN agent_jobs j ON j.id = s.job_id AND j.user_id = s.user_id
        JOIN captures c ON c.id = s.capture_id AND c.user_id = s.user_id
        WHERE s.id = %s AND s.user_id = %s
        FOR UPDATE OF s, c
        """,
        (suggestion_id, user_id),
    ).fetchone()


def _review_result(
    connection: psycopg.Connection,
    *,
    suggestion_id: UUID,
    user_id: str,
    status: str,
    accepted_payload: dict[str, object] | None,
    item_id: UUID | None,
) -> dict[str, object]:
    reviewed_at = connection.execute(
        "SELECT reviewed_at FROM agent_suggestions WHERE id = %s AND user_id = %s",
        (suggestion_id, user_id),
    ).fetchone()["reviewed_at"]
    return {
        "id": str(suggestion_id),
        "status": status,
        "acceptedProposal": accepted_payload,
        "itemId": str(item_id) if item_id else None,
        "reviewedAt": reviewed_at.isoformat().replace("+00:00", "Z")
        if reviewed_at
        else None,
    }


def accept_suggestion(
    connection: psycopg.Connection,
    *,
    user_id: str,
    suggestion_id: UUID,
    proposal_data: object,
) -> dict[str, object] | None:
    row = _review_row(
        connection,
        user_id=user_id,
        suggestion_id=suggestion_id,
    )
    if row is None:
        return None

    if row["status"] == "accepted":
        comparison_data = proposal_data
        if isinstance(proposal_data, dict) and "related_item_ids" in proposal_data:
            comparison_data = {**proposal_data, "related_item_ids": []}
        if comparison_data != row["accepted_payload_json"]:
            raise ReviewConflictError("This suggestion was accepted with other edits.")
        item = connection.execute(
            """
            SELECT id FROM items
            WHERE user_id = %s AND capture_id = %s
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
            """,
            (user_id, row["capture_id"]),
        ).fetchone()
        return _review_result(
            connection,
            suggestion_id=suggestion_id,
            user_id=user_id,
            status="accepted",
            accepted_payload=row["accepted_payload_json"],
            item_id=item["id"] if item else None,
        )

    if row["status"] != "pending":
        raise ReviewConflictError("This suggestion is no longer pending review.")

    if row["updated_at"] != row["capture_revision"]:
        connection.execute(
            """
            UPDATE agent_suggestions
            SET status = 'stale', reviewed_at = now()
            WHERE id = %s AND user_id = %s AND status = 'pending'
            """,
            (suggestion_id, user_id),
        )
        return _review_result(
            connection,
            suggestion_id=suggestion_id,
            user_id=user_id,
            status="stale",
            accepted_payload=None,
            item_id=None,
        )

    proposal = validate_proposal_data(
        proposal_data,
        original_capture=row["current_text"],
    )
    # Model IDs are never used to create links; links require their own explicit action.
    if proposal.related_item_ids:
        proposal = proposal.model_copy(update={"related_item_ids": []})

    accepted_payload = proposal.model_dump(mode="json")
    existing_items = connection.execute(
        """
        SELECT id FROM items
        WHERE user_id = %s AND capture_id = %s
        ORDER BY updated_at DESC, created_at DESC
        FOR UPDATE
        """,
        (user_id, row["capture_id"]),
    ).fetchall()
    existing_item = existing_items[0] if existing_items else None
    item_values = (
        suggestion_id,
        proposal.item_type,
        proposal.title,
        proposal.summary,
        Jsonb(proposal.labels),
        Jsonb([task.model_dump(mode="json") for task in proposal.candidate_tasks]),
    )
    if existing_item:
        item = connection.execute(
            """
            UPDATE items
            SET suggestion_id = %s, item_type = %s, title = %s, summary = %s,
                labels_json = %s, candidate_tasks_json = %s, updated_at = now()
            WHERE user_id = %s AND id = %s
            RETURNING id
            """,
            (*item_values, user_id, existing_item["id"]),
        ).fetchone()
        duplicate_ids = [entry["id"] for entry in existing_items[1:]]
        if duplicate_ids:
            same_capture_ids = [entry["id"] for entry in existing_items]
            linked_neighbors = connection.execute(
                """
                SELECT CASE
                    WHEN item_low = ANY(%s) THEN item_high
                    ELSE item_low
                END AS related_id
                FROM item_relationships
                WHERE user_id = %s
                    AND (item_low = ANY(%s) OR item_high = ANY(%s))
                """,
                (same_capture_ids, user_id, same_capture_ids, same_capture_ids),
            ).fetchall()
            for neighbor in linked_neighbors:
                related_id = neighbor["related_id"]
                if related_id in same_capture_ids:
                    continue
                item_low, item_high = sorted((existing_item["id"], related_id))
                connection.execute(
                    """
                    INSERT INTO item_relationships (user_id, item_low, item_high)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, item_low, item_high) DO NOTHING
                    """,
                    (user_id, item_low, item_high),
                )
            connection.execute(
                "DELETE FROM items WHERE user_id = %s AND id = ANY(%s)",
                (user_id, duplicate_ids),
            )
    else:
        item = connection.execute(
            """
            INSERT INTO items (
                user_id, capture_id, suggestion_id, item_type, title, summary,
                labels_json, candidate_tasks_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                user_id,
                row["capture_id"],
                *item_values,
            ),
        ).fetchone()
    connection.execute(
        """
        UPDATE agent_suggestions
        SET status = 'accepted', reviewed_at = now(), accepted_payload_json = %s
        WHERE id = %s AND user_id = %s AND status = 'pending'
        """,
        (Jsonb(accepted_payload), suggestion_id, user_id),
    )
    return _review_result(
        connection,
        suggestion_id=suggestion_id,
        user_id=user_id,
        status="accepted",
        accepted_payload=accepted_payload,
        item_id=item["id"],
    )


def reject_suggestion(
    connection: psycopg.Connection,
    *,
    user_id: str,
    suggestion_id: UUID,
) -> dict[str, object] | None:
    row = _review_row(
        connection,
        user_id=user_id,
        suggestion_id=suggestion_id,
    )
    if row is None:
        return None
    if row["status"] == "rejected":
        return _review_result(
            connection,
            suggestion_id=suggestion_id,
            user_id=user_id,
            status="rejected",
            accepted_payload=None,
            item_id=None,
        )
    if row["status"] == "accepted":
        raise ReviewConflictError("An accepted suggestion cannot be rejected.")
    if row["status"] == "stale":
        return _review_result(
            connection,
            suggestion_id=suggestion_id,
            user_id=user_id,
            status="stale",
            accepted_payload=None,
            item_id=None,
        )

    next_status = (
        "stale" if row["updated_at"] != row["capture_revision"] else "rejected"
    )
    connection.execute(
        """
        UPDATE agent_suggestions
        SET status = %s, reviewed_at = now()
        WHERE id = %s AND user_id = %s AND status = 'pending'
        """,
        (next_status, suggestion_id, user_id),
    )
    return _review_result(
        connection,
        suggestion_id=suggestion_id,
        user_id=user_id,
        status=next_status,
        accepted_payload=None,
        item_id=None,
    )
