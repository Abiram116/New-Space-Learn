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


class NothingIndexed(ApiError):
    """RAG retrieval found zero chunks for a generation request. Distinct
    from a failure: the request is fine, there's just nothing to ground it
    on yet, and the model must not be left to free-associate on a bare
    topic string instead."""

    code = "nothing_indexed"
    status = 422
    # Names both ways out, because both work. The old copy said "Upload a
    # document first", which was wrong advice as soon as the generators
    # started accepting chat history as material — a student who had talked
    # the topic through was told to go do something they didn't need to.
    message = (
        "Nothing to build from yet. Upload a document or chat about this "
        "topic first."
    )


def _envelope(code: str, message: str, status: int, extra: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if extra is not None:
        body["error"]["detail"] = extra
    return JSONResponse(status_code=status, content=body)


async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    return _envelope(exc.code, exc.message, exc.status)


#: What each status says to a person. FastAPI's own detail strings ("Not Found",
#: "Method Not Allowed") are developer text, not something to put on a screen.
_HTTP_MESSAGES = {
    401: "Please sign in again.",
    403: "You don't have access to that.",
    404: "We couldn't find that.",
    405: "That action isn't available here.",
    413: "That's too large to upload.",
    429: "Slow down for a moment and try again.",
}


async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Map generic HTTPExceptions to our envelope so clients see one shape.
    code = {
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        429: "rate_limited",
    }.get(exc.status_code, "http_error")
    message = _HTTP_MESSAGES.get(exc.status_code, "That request didn't work. Please try again.")
    return _envelope(code, message, exc.status_code)


def _field_label(loc: tuple[Any, ...]) -> str:
    """"body_md" -> "Body md", from the last part of where the error was found."""
    name = next((str(p) for p in reversed(loc) if isinstance(p, str) and p != "body"), "")
    return name.replace("_", " ").strip().capitalize() or "That field"


def friendly_validation_message(errors: list[dict[str, Any]]) -> str:
    """One plain sentence for the first thing wrong with a request.

    Pydantic's own text ("String should have at least 1 character", "Input
    should be a valid integer, unable to parse string as an integer") is written
    for developers. This says what to change, in terms of the field.
    """
    if not errors:
        return "Some of the input isn't valid."
    first = errors[0]
    field = _field_label(tuple(first.get("loc", ())))
    kind = str(first.get("type", ""))
    ctx = first.get("ctx") or {}
    if kind == "missing":
        return f"{field} is required."
    if kind == "string_too_short":
        minimum = ctx.get("min_length", 1)
        return f"{field} can't be empty." if minimum <= 1 else f"{field} is too short (at least {minimum} characters)."
    if kind == "string_too_long":
        return f"{field} is too long (at most {ctx.get('max_length', '?')} characters)."
    if kind == "too_long":
        return f"{field} has too many items (at most {ctx.get('max_length', '?')})."
    if kind == "too_short":
        return f"{field} needs at least {ctx.get('min_length', 1)} item(s)."
    if kind in {"greater_than", "greater_than_equal", "less_than", "less_than_equal"}:
        return f"{field} is outside the allowed range."
    if kind in {"int_parsing", "int_type", "float_parsing", "float_type", "bool_parsing"}:
        return f"{field} has to be a number."
    if kind == "literal_error":
        return f"{field} isn't one of the allowed choices."
    if kind in {"json_invalid", "model_attributes_type", "dict_type"}:
        return "That request couldn't be read. Please try again."
    return "Some of the input isn't valid."


async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    return _envelope("validation_error", friendly_validation_message(errors), 422, extra=errors[:5])


async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error: %s", exc)
    return _envelope("internal_error", "Something went wrong on our side.", 500)
