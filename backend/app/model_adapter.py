"""Provider-neutral model interface and Groq chat-completion adapter."""

import json
import re
from dataclasses import dataclass
from typing import Protocol

from groq import APIConnectionError, APIStatusError, APITimeoutError, Groq

from app.agent_prompts import (
    CAPTURE_PROCESSING_PROMPT_VERSION,
    build_capture_processing_messages,
)
from app.agent_schema import (
    MAX_PROPOSAL_JSON_BYTES,
    ProcessingProposal,
    ValidationError,
    validate_proposal_json,
)

REQUEST_TIMEOUT_SECONDS = 30
MAX_COMPLETION_TOKENS = 3_000
SAFE_PROVIDER_LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def _safe_provider_label(value: object) -> str | None:
    if isinstance(value, str) and SAFE_PROVIDER_LABEL.fullmatch(value):
        return value
    return None


def _provider_error_fields(body: object) -> tuple[str | None, str | None]:
    if not isinstance(body, dict):
        return None, None
    provider_error = body.get("error")
    if not isinstance(provider_error, dict):
        return None, None
    return (
        _safe_provider_label(provider_error.get("type")),
        _safe_provider_label(provider_error.get("code")),
    )


def _provider_status_reason(status_code: int) -> str:
    if status_code == 400 or status_code == 422:
        return "invalid_request"
    if status_code == 401:
        return "authentication_failed"
    if status_code == 403:
        return "permission_denied"
    if status_code == 404:
        return "model_or_endpoint_not_found"
    if status_code == 413:
        return "request_too_large"
    if status_code == 429:
        return "rate_limited"
    if status_code >= 500:
        return "provider_server_error"
    return "provider_http_error"


class ModelAdapterError(Exception):
    """Safe model invocation failure with non-sensitive provider diagnostics."""

    def __init__(
        self,
        message: str,
        *,
        provider_status_code: int | None = None,
        provider_reason: str | None = None,
        provider_error_type: str | None = None,
        provider_error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.provider_status_code = provider_status_code
        self.provider_reason = provider_reason
        self.provider_error_type = provider_error_type
        self.provider_error_code = provider_error_code


class ModelTemporarilyUnavailable(ModelAdapterError):
    """A transient provider or network error that can be retried."""


class ModelOutputError(Exception):
    """Provider output was missing, oversized, or failed schema validation."""


@dataclass(frozen=True)
class ModelProposalResult:
    proposal: ProcessingProposal
    model_identifier: str
    prompt_version: str


class ModelAdapter(Protocol):
    def propose_capture(self, capture_text: str) -> ModelProposalResult:
        """Return a validated proposal without persisting it."""


class GroqChatAdapter:
    """Use the official Groq Python SDK for chat completions."""

    def __init__(self, *, api_key: str, model: str) -> None:
        if not api_key.strip():
            raise ValueError("A Groq API key is required.")
        if not model.strip():
            raise ValueError("A Groq model identifier is required.")
        self._model = model.strip()
        self._client = Groq(
            api_key=api_key.strip(),
            timeout=REQUEST_TIMEOUT_SECONDS,
            max_retries=0,
        )

    def propose_capture(self, capture_text: str) -> ModelProposalResult:
        messages = build_capture_processing_messages(capture_text)
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                response_format={"type": "json_object"},
                max_completion_tokens=MAX_COMPLETION_TOKENS,
                temperature=0.2,
            )
        except APIStatusError as error:
            error_type, error_code = _provider_error_fields(error.body)
            diagnostics = {
                "provider_status_code": error.status_code,
                "provider_reason": _provider_status_reason(error.status_code),
                "provider_error_type": error_type,
                "provider_error_code": error_code,
            }
            if error.status_code in {408, 409, 425, 429} or error.status_code >= 500:
                raise ModelTemporarilyUnavailable(
                    "Groq is temporarily unavailable.", **diagnostics
                ) from None
            raise ModelAdapterError(
                "Groq rejected the processing request.", **diagnostics
            ) from None
        except (APIConnectionError, APITimeoutError):
            raise ModelTemporarilyUnavailable(
                "The model service could not be reached.",
                provider_error_code="connection_error",
            ) from None

        try:
            choice = response.choices[0]
            content = choice.message.content
            finish_reason = choice.finish_reason
        except (AttributeError, IndexError, TypeError):
            raise ModelOutputError("Groq returned an invalid response.") from None

        if not isinstance(content, str) or not content:
            raise ModelOutputError("Groq returned no proposal content.")
        if finish_reason == "length":
            raise ModelOutputError("The model response was truncated.")
        if len(content.encode("utf-8")) > MAX_PROPOSAL_JSON_BYTES:
            raise ModelOutputError("The model proposal exceeds the allowed size.")

        try:
            proposal = validate_proposal_json(
                content,
                original_capture=capture_text,
            )
        except (json.JSONDecodeError, ValidationError, ValueError):
            raise ModelOutputError(
                "The model returned a proposal that failed validation."
            ) from None

        returned_model = response.model
        model_identifier = (
            returned_model[:200]
            if isinstance(returned_model, str) and returned_model
            else self._model
        )
        return ModelProposalResult(
            proposal=proposal,
            model_identifier=model_identifier,
            prompt_version=CAPTURE_PROCESSING_PROMPT_VERSION,
        )
