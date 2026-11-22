"""Construct the optional model adapter from backend configuration."""

from app.agent.model_adapter import GroqChatAdapter, ModelAdapter
from app.core.config import GROQ_API_KEY, GROQ_MODEL


def configured_model_adapter() -> ModelAdapter | None:
    if not GROQ_API_KEY and not GROQ_MODEL:
        return None
    if not GROQ_API_KEY or not GROQ_MODEL:
        raise RuntimeError(
            "Set both GROQ_API_KEY and GROQ_MODEL to enable AI processing."
        )
    return GroqChatAdapter(api_key=GROQ_API_KEY, model=GROQ_MODEL)
