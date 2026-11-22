"""Versioned, untrusted model output contracts for capture processing."""

import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

PROPOSAL_SCHEMA_VERSION = "1"
MAX_PROPOSAL_JSON_BYTES = 64_000

Confidence = Annotated[float, Field(ge=0.0, le=1.0)]


class StrictProposalModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class CandidateTask(StrictProposalModel):
    title: str = Field(min_length=1, max_length=160)
    due_date: Annotated[str, Field(min_length=1, max_length=100)] | None
    source_text: str = Field(min_length=1, max_length=1_000)
    confidence: Confidence


class ProcessingProposal(StrictProposalModel):
    """A validated suggestion; it never authorizes persistence by itself."""

    schema_version: Literal["1"]
    item_type: Literal["task", "idea", "note", "question", "project", "reference"]
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(min_length=1, max_length=1_000)
    labels: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(
        max_length=10
    )
    candidate_tasks: list[CandidateTask] = Field(max_length=10)
    related_item_ids: list[UUID] = Field(max_length=10)
    clarifying_question: str | None = Field(max_length=500)
    confidence: Confidence
    reasoning_summary: str = Field(min_length=1, max_length=500)

    @field_validator("related_item_ids")
    @classmethod
    def related_item_ids_must_be_unique(cls, values: list[UUID]) -> list[UUID]:
        if len(values) != len(set(values)):
            raise ValueError("Related saved-item IDs must be unique.")
        return values


def validate_proposal_json(
    raw_json: str,
    *,
    original_capture: str,
    allowed_related_item_ids: set[UUID] | None = None,
) -> ProcessingProposal:
    """Parse bounded proposal JSON and reject task evidence absent from source.

    Due dates preserve the capture's own wording. Related IDs must belong to
    the user-scoped candidate set supplied to this validation boundary.
    """
    if not isinstance(raw_json, str):
        raise ValueError("The model proposal must be JSON text.")
    if len(raw_json.encode("utf-8")) > MAX_PROPOSAL_JSON_BYTES:
        raise ValueError("The model proposal exceeds the maximum allowed size.")

    proposal = ProcessingProposal.model_validate_json(raw_json)
    if allowed_related_item_ids is not None and not set(
        proposal.related_item_ids
    ).issubset(allowed_related_item_ids):
        raise ValueError("A related item was not included in the candidate list.")
    for candidate in proposal.candidate_tasks:
        if candidate.source_text not in original_capture:
            raise ValueError("A candidate task cites text absent from the capture.")
        if (
            candidate.due_date is not None
            and candidate.due_date not in candidate.source_text
        ):
            raise ValueError(
                "A candidate due date must quote text from its source evidence."
            )

    return proposal


def validate_proposal_data(
    value: object,
    *,
    original_capture: str,
    allowed_related_item_ids: set[UUID] | None = None,
) -> ProcessingProposal:
    """Validate a JSON-decoded request body with the same strict contract."""
    if not isinstance(value, dict):
        raise ValueError("The proposal must be a JSON object.")
    try:
        raw_json = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        raise ValueError("The proposal must contain only JSON values.") from None
    return validate_proposal_json(
        raw_json,
        original_capture=original_capture,
        allowed_related_item_ids=allowed_related_item_ids,
    )


__all__ = [
    "PROPOSAL_SCHEMA_VERSION",
    "CandidateTask",
    "ProcessingProposal",
    "ValidationError",
    "validate_proposal_data",
    "validate_proposal_json",
]
