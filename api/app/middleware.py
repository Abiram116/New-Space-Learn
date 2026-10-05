"""Per-request plumbing that has to happen before any route runs.

Pure ASGI rather than `BaseHTTPMiddleware`: that class buffers the body and
breaks streaming responses, and the chat endpoint streams.
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import PayloadTooLarge
from .services import clock

#: Ordinary JSON requests. The largest legitimate ones are a chat message with
#: three images (~6.3 MB of data URLs) and a note with embedded images (5 MB
#: of text), so this leaves headroom without leaving the door open.
MAX_BODY_BYTES = 12 * 1024 * 1024
#: A document upload: the 20 MB file limit plus multipart framing.
MAX_UPLOAD_BYTES = 21 * 1024 * 1024


class RequestGuard:
    """Two jobs, once per request:

    1. **Refuse oversized bodies before they are read.** The API is one worker
       with 512 MB. Without this, a single request with a multi-hundred-megabyte
       body — a file, or just a huge JSON string — was read fully into memory
       before any size check ran, and could take the server down for everyone.
       Checked twice: against `Content-Length` up front, and by counting bytes
       as they arrive, because a chunked body declares no length.
    2. **Record the student's time zone** (`X-Timezone`) for `services/clock`,
       so "today" means their day rather than the server's.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k: v for k, v in scope.get("headers", [])}
        clock.set_zone(headers.get(b"x-timezone", b"").decode("latin-1") or None)

        is_upload = scope.get("method") == "POST" and scope.get("path", "").endswith("/documents")
        limit = MAX_UPLOAD_BYTES if is_upload else MAX_BODY_BYTES

        declared = headers.get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            await _reject(send)
            return

        received = 0
        too_large = False

        async def counted() -> Message:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_large = True
                    # Stops whoever is reading the body (the form parser, the
                    # JSON reader) from holding any more of it.
                    raise PayloadTooLarge()
            return message

        replied = False

        async def guarded_send(message: Message) -> None:
            # The framework turns an error raised while it reads a body into
            # its own generic 400. Say what actually happened instead.
            nonlocal replied
            if not too_large:
                await send(message)
            elif not replied:
                replied = True
                await _reject(send)

        try:
            await self.app(scope, counted, guarded_send)
        except PayloadTooLarge:
            if not replied:
                await _reject(send)


async def _reject(send: Send) -> None:
    error = PayloadTooLarge()
    body = json.dumps({"error": {"code": error.code, "message": error.message}}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": error.status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


#: Sent on every response. The API serves JSON and an event stream, never a
#: page, so the strictest settings cost nothing: nothing may be framed,
#: sniffed into another type, run as a document, or followed by a referrer.
SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"strict-transport-security", b"max-age=63072000; includeSubDomains"),
    (b"cross-origin-resource-policy", b"same-site"),
)


class SecurityHeaders:
    """Adds `SECURITY_HEADERS` to every HTTP response, without overriding a
    header a route set on purpose. Pure ASGI for the same reason as
    `RequestGuard`: the chat stream must not be buffered."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers.extend(h for h in SECURITY_HEADERS if h[0] not in present)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, with_headers)
