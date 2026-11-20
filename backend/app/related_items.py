"""Bounded keyword matching for user-owned saved-item link candidates."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg import Connection

from app.text_signals import meaningful_terms

MAX_RELATED_ITEM_SCAN = 500
MAX_RELATED_ITEM_CANDIDATES = 5
MIN_SHARED_TERMS = 2


@dataclass(frozen=True)
class RelatedItemCandidate:
    id: UUID
    title: str
    item_type: str
    summary: str
    match_terms: tuple[str, ...]

    def as_prompt_data(self) -> dict[str, str]:
        return {
            "id": str(self.id),
            "title": self.title[:160],
            "type": self.item_type,
            "summary": self.summary[:400],
            "matching_terms": ", ".join(term[:40] for term in self.match_terms),
        }


def find_related_item_candidates(
    connection: Connection,
    *,
    user_id: str,
    capture_id: UUID,
    capture_text: str,
) -> list[RelatedItemCandidate]:
    """Find a few keyword-relevant saved items without loading their captures."""
    source_terms = meaningful_terms(capture_text)
    if len(source_terms) < MIN_SHARED_TERMS:
        return []

    rows = connection.execute(
        """
        SELECT id, item_type, title, summary, labels_json, candidate_tasks_json,
            created_at
        FROM items
        WHERE user_id = %s AND capture_id <> %s
        ORDER BY created_at DESC, id DESC
        LIMIT %s
        """,
        (user_id, capture_id, MAX_RELATED_ITEM_SCAN),
    ).fetchall()
    matches: list[tuple[float, Any, set[str]]] = []
    for row in rows:
        task_text: list[str] = []
        for task in row["candidate_tasks_json"]:
            if isinstance(task, dict):
                task_text.extend(
                    value
                    for key in ("title", "source_text", "due_date")
                    if isinstance((value := task.get(key)), str)
                )
        searchable = " ".join(
            (row["title"], row["summary"], *row["labels_json"], *task_text)
        )
        common = source_terms.intersection(meaningful_terms(searchable))
        if len(common) < MIN_SHARED_TERMS:
            continue
        candidate_terms = meaningful_terms(searchable)
        score = len(common) / len(source_terms.union(candidate_terms))
        matches.append((score, row, common))

    matches.sort(key=lambda match: (match[0], match[1]["created_at"]), reverse=True)
    return [
        RelatedItemCandidate(
            id=row["id"],
            title=row["title"],
            item_type=row["item_type"],
            summary=row["summary"],
            match_terms=tuple(sorted(common, key=lambda term: (-len(term), term))[:5]),
        )
        for _, row, common in matches[:MAX_RELATED_ITEM_CANDIDATES]
    ]
