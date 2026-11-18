from fastapi import Request
from fastapi.responses import JSONResponse

API_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
}


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


async def api_error_handler(_: Request, error: ApiError) -> JSONResponse:
    body: dict[str, str] = {"error": error.message}
    if error.code is not None:
        body["code"] = error.code
    return JSONResponse(
        body,
        status_code=error.status_code,
        headers=API_HEADERS,
    )
