import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env.local")
load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
GOOGLE_WEB_CLIENT_ID = os.environ.get("AUTH_GOOGLE_ID")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be configured before starting the API.")
