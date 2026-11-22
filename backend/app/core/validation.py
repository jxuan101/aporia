import json
import re
from typing import Any
from uuid import UUID

from fastapi import Request

from app.core.errors import ApiError

MAX_CAPTURE_LENGTH = 10_000
MAX_SEARCH_QUERY_LENGTH = 200


async def read_json_body(request: Request, max_bytes: int = 50_000) -> Any:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise ApiError("The request body is too large.", 413)
        except ValueError:
            pass

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise ApiError("The request body is too large.", 413)

    try:
        return json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError("The request body must be valid JSON.", 400) from None


def capture_text(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) < 1
        or len(value) > MAX_CAPTURE_LENGTH
        or not value.strip()
    ):
        raise ApiError("Enter a thought of up to 10,000 characters.", 400)
    return value


def capture_body(body: Any) -> str:
    if not isinstance(body, dict) or set(body) != {"text"}:
        raise ApiError("Enter a thought of up to 10,000 characters.", 400)
    return capture_text(body["text"])


def search_query(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    normalized = value.strip()
    if not normalized or len(normalized) > MAX_SEARCH_QUERY_LENGTH:
        raise ApiError("Search must be between 1 and 200 characters.", 400)
    return normalized


def capture_id(value: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        raise ApiError("The page cursor is invalid.", 400) from None


def bearer_token(authorization: str | None) -> str | None:
    if authorization is None:
        return None
    match = re.fullmatch(r"Bearer ([A-Za-z0-9_-]{43})", authorization)
    return match.group(1) if match else None
