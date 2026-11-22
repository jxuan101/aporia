import logging

from fastapi import Request
from fastapi.responses import JSONResponse

API_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
}
logger = logging.getLogger("aporia.api")


class ApiError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int,
        *,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    route = request.scope.get("route")
    route_template = getattr(route, "path", "unknown")
    logger.warning(
        "api_request_rejected method=%s route=%s status_code=%d error_code=%s",
        request.method,
        route_template,
        error.status_code,
        error.code or "none",
    )
    body: dict[str, str] = {"error": error.message}
    if error.code is not None:
        body["code"] = error.code
    return JSONResponse(
        body,
        status_code=error.status_code,
        headers=API_HEADERS,
    )
