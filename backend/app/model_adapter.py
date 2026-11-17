"""Provider-neutral model interface and Groq chat-completion adapter."""

import json
from dataclasses import dataclass
from http.client import HTTPException
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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

GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
REQUEST_TIMEOUT_SECONDS = 30
MAX_PROVIDER_RESPONSE_BYTES = 128_000
MAX_COMPLETION_TOKENS = 3_000


class ModelAdapterError(Exception):
    """Safe, non-sensitive model invocation failure."""


class ModelTemporarilyUnavailable(ModelAdapterError):
    """A transient provider or network error that can be retried."""


class ModelOutputError(ModelAdapterError):
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
    """Use Groq's OpenAI-compatible Chat Completions HTTP endpoint."""

    def __init__(self, *, api_key: str, model: str) -> None:
        if not api_key.strip():
            raise ValueError("A Groq API key is required.")
        if not model.strip():
            raise ValueError("A Groq model identifier is required.")
        self._api_key = api_key.strip()
        self._model = model.strip()

    def propose_capture(self, capture_text: str) -> ModelProposalResult:
        messages = build_capture_processing_messages(capture_text)
        request_body = json.dumps(
            {
                "model": self._model,
                "messages": messages,
                "response_format": {"type": "json_object"},
                "max_completion_tokens": MAX_COMPLETION_TOKENS,
                "temperature": 0.2,
            }
        ).encode("utf-8")
        request = Request(
            GROQ_CHAT_COMPLETIONS_URL,
            data=request_body,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                response_body = response.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
        except HTTPError as error:
            if error.code in {408, 409, 425, 429} or error.code >= 500:
                raise ModelTemporarilyUnavailable(
                    "Groq is temporarily unavailable."
                ) from None
            raise ModelAdapterError("Groq rejected the processing request.") from None
        except (URLError, TimeoutError, HTTPException, OSError):
            raise ModelTemporarilyUnavailable(
                "The model service could not be reached."
            ) from None

        if len(response_body) > MAX_PROVIDER_RESPONSE_BYTES:
            raise ModelOutputError("The model response exceeds the allowed size.")

        try:
            provider_payload = json.loads(response_body)
            choice = provider_payload["choices"][0]
            content = choice["message"]["content"]
            finish_reason = choice.get("finish_reason")
        except (
            json.JSONDecodeError,
            UnicodeDecodeError,
            KeyError,
            IndexError,
            TypeError,
        ):
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
        except (ValidationError, ValueError):
            raise ModelOutputError(
                "The model returned a proposal that failed validation."
            ) from None

        returned_model = provider_payload.get("model")
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
