from fastapi import Request
from fastapi.responses import JSONResponse

API_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
}


class ApiError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


async def api_error_handler(_: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(
        {"error": error.message},
        status_code=error.status_code,
        headers=API_HEADERS,
    )
