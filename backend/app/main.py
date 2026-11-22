from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.agent.routes import router as agent_router
from app.auth.routes import router as auth_router
from app.captures.routes import router as captures_router
from app.core.errors import API_HEADERS, ApiError, api_error_handler
from app.export.routes import router as export_router
from app.items.routes import router as items_router
from app.review.routes import router as review_router

app = FastAPI(
    title="Aporia API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_exception_handler(ApiError, api_error_handler)
app.include_router(auth_router)
app.include_router(agent_router)
app.include_router(captures_router)
app.include_router(export_router)
app.include_router(items_router)
app.include_router(review_router)


@app.middleware("http")
async def secure_api_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "private, no-store")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


@app.get("/healthz")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"}, headers=API_HEADERS)
