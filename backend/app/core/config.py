import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env.local")
load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
GOOGLE_WEB_CLIENT_ID = os.environ.get("AUTH_GOOGLE_ID")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL")

APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()
PRODUCTION_DAILY_PROCESSING_LIMIT = 20
try:
    configured_daily_processing_limit = int(
        os.environ.get(
            "AI_DAILY_PROCESSING_LIMIT",
            str(PRODUCTION_DAILY_PROCESSING_LIMIT),
        )
    )
except ValueError as error:
    raise RuntimeError(
        "AI_DAILY_PROCESSING_LIMIT must be a positive integer."
    ) from error

if configured_daily_processing_limit < 1:
    raise RuntimeError("AI_DAILY_PROCESSING_LIMIT must be a positive integer.")

# Only explicitly marked development servers may raise the production cap.
AI_DAILY_PROCESSING_LIMIT = (
    configured_daily_processing_limit
    if APP_ENV == "development"
    else min(configured_daily_processing_limit, PRODUCTION_DAILY_PROCESSING_LIMIT)
)

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be configured before starting the API.")
