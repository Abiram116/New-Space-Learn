"""Domain exceptions + a single JSON envelope for every failure.

The frontend expects `{ "error": { "code": ..., "message": ... } }`. We never
leak stack traces or raw upstream text. Add new codes here, not inline.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("space_learn.errors")


class ApiError(Exception):
    """All application-thrown errors extend this."""

    code: str = "internal_error"
    status: int = 500
    message: str = "Something went wrong."

    def __init__(self, message: str | None = None) -> None:
        if message:
            self.message = message
        super().__init__(self.message)


class Unauthorized(ApiError):
    code = "unauthorized"
    status = 401
    message = "Please sign in again."


class Forbidden(ApiError):
    code = "forbidden"
    status = 403
    message = "You don't have access to that."


class NotFound(ApiError):
    code = "not_found"
    status = 404
    message = "That doesn't exist here."


class ValidationFailed(ApiError):
    code = "validation_error"
    status = 422
    message = "Some of the input isn't valid."


class RateLimited(ApiError):
    code = "rate_limited"
    status = 429
    message = "Slow down for a moment and try again."


class UpstreamUnavailable(ApiError):
    """The AI provider, DB, or another required service didn't answer."""

    code = "upstream_unavailable"
    status = 503
    message = "A service we depend on is offline. Try again shortly."


class NotConfigured(UpstreamUnavailable):
    """Env vars aren't set for the requested feature — treated as upstream down."""

    code = "not_configured"
    message = "This feature isn't configured yet."


def _envelope(code: str, message: str, status: int, extra: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if extra is not None:
        body["error"]["detail"] = extra
    return JSONResponse(status_code=status, content=body)


async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    return _envelope(exc.code, exc.message, exc.status)


async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Map generic HTTPExceptions to our envelope so clients see one shape.
    code = {
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        429: "rate_limited",
    }.get(exc.status_code, "http_error")
    message = str(exc.detail) if exc.detail else "Request failed."
    return _envelope(code, message, exc.status_code)


async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Return the first field message so users see actionable text, not a JSON dump.
    first = exc.errors()[0] if exc.errors() else None
    msg = "Please check the highlighted fields."
    if first and first.get("msg"):
        msg = str(first["msg"])
    return _envelope("validation_error", msg, 422, extra=exc.errors()[:5])


async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error: %s", exc)
    return _envelope("internal_error", "Something went wrong on our side.", 500)
