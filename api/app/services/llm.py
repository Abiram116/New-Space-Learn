"""LLM interface + Groq implementation + graceful stub when no key is set.

The Chat streaming route treats every LLM as an `AsyncIterator[str]`. That
keeps SSE happy and lets us swap Groq for OpenAI, Anthropic, or a local model
by writing one class — no route changes required.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from ..config import settings
from ..errors import ApiError, NotConfigured, RateLimited, UpstreamUnavailable

log = logging.getLogger("space_learn.llm")


#: {"role": "system"|"user"|"assistant", "content": str | list[dict]}
#:
#: `content` is a plain string for text turns and an OpenAI-style content array
#: when images are attached. Typed `Any` rather than a union because every
#: call site builds one shape or the other and none inspects it — a union here
#: would buy a cast at each of them for no checking that matters.
ChatMessage = dict[str, Any]


class LLM(Protocol):
    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]: ...


#: Worth retrying on the SAME model — the request was fine, the moment wasn't.
#: 498 is Groq's own "flex tier over capacity".
_RETRYABLE_STATUS = frozenset({408, 429, 498, 500, 502, 503, 504})

#: Groq's error codes for "this model id is gone or was never here". The
#: 2026-08-16 and 2026-09-21 decommissions both surfaced as exactly this, and
#: each one took the whole feature down because nothing fell back.
_MODEL_GONE_CODES = frozenset({"model_decommissioned", "model_not_found"})


class _Retryable(Exception):
    """A transient failure. `error` is what the student sees if every attempt
    and every fallback fails the same way."""

    def __init__(self, error: ApiError, retry_after: float | None = None) -> None:
        super().__init__(error.message)
        self.error = error
        self.retry_after = retry_after


class _ModelGone(Exception):
    """This model id is unusable. Retrying it is pointless; the next model in
    the chain is the only move."""


@dataclass(slots=True)
class _Breaker:
    """A per-model circuit breaker.

    Closed: calls go through. After `threshold` consecutive failures it OPENS:
    for `cooldown` seconds the model is skipped outright, straight to the
    fallback, rather than every request separately waiting out a timeout
    against an upstream already known to be down. After the cooldown one
    request is let through as a probe — success closes it, failure re-opens it.
    """

    failures: int = 0
    opened_at: float | None = None

    def allows(self, now: float, cooldown: float) -> bool:
        return self.opened_at is None or now - self.opened_at >= cooldown

    def succeed(self) -> None:
        self.failures = 0
        self.opened_at = None

    def fail(self, now: float, threshold: int) -> None:
        self.failures += 1
        if self.failures >= threshold:
            self.opened_at = now

    def trip(self, now: float) -> None:
        """Open immediately — for a model that's gone, not merely flaky."""
        self.failures = max(self.failures, 1)
        self.opened_at = now


def _has_images(messages: list[ChatMessage]) -> bool:
    return any(isinstance(m.get("content"), list) for m in messages)


def _backoff(attempt: int, retry_after: float | None) -> float:
    """Full-jitter exponential backoff, or the server's own Retry-After.

    Jitter matters even on one worker: without it, every request that failed
    in the same blip retries in the same instant and trips the same limit.
    """
    if retry_after is not None:
        return retry_after + random.uniform(0, 0.25)
    return random.uniform(0, min(4.0, 0.4 * (2**attempt)))


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _error_code(body: bytes) -> str | None:
    try:
        return json.loads(body).get("error", {}).get("code")
    except (ValueError, AttributeError):
        return None


class GroqLLM:
    """OpenAI-compatible client pointed at Groq, with retry, fallback, and a
    circuit breaker.

    **The one rule everything below follows: never retry after the first
    token.** Once text has reached the student, a retry would restart the
    answer and duplicate what they already read. So every retry and every
    fallback happens in the window before the first `yield`; a failure after
    it is surfaced as a clean "stopped mid-answer" error instead.

    Fallback order: the requested model, then the other text model. Vision
    requests never fall back — the text models can't see the image, and a
    confident answer that ignored the attachment is worse than an honest error.
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._breakers: dict[str, _Breaker] = {}

    async def _get(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=settings.groq_base_url.rstrip("/"),
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(settings.groq_timeout_s, connect=5.0),
            )
        return self._client

    def _chain(self, model: str | None, messages: list[ChatMessage]) -> list[str]:
        primary = model or settings.groq_model
        if _has_images(messages):
            return [primary]
        text_models = [settings.groq_model, settings.groq_model_fast]
        return [primary, *[m for m in text_models if m != primary]]

    def _breaker(self, model: str) -> _Breaker:
        return self._breakers.setdefault(model, _Breaker())

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        chain = self._chain(model, messages)
        last_error: ApiError = UpstreamUnavailable("The AI service is unavailable.")

        for position, candidate in enumerate(chain):
            breaker = self._breaker(candidate)
            is_last = position == len(chain) - 1
            # The last model is always tried, open circuit or not: failing a
            # request without making a single attempt helps nobody.
            if not is_last and not breaker.allows(
                time.monotonic(), settings.groq_breaker_cooldown_s
            ):
                log.info("groq circuit open for %s; skipping to fallback", candidate)
                continue

            for attempt in range(settings.groq_max_retries + 1):
                started = False
                try:
                    async for delta in self._stream_once(candidate, messages, temperature):
                        started = True
                        yield delta
                    breaker.succeed()
                    if position:
                        log.info("groq answered via fallback %s", candidate)
                    return
                except _ModelGone:
                    breaker.trip(time.monotonic())
                    log.warning("groq model %s is gone; falling back", candidate)
                    break
                except _Retryable as e:
                    if started:
                        raise UpstreamUnavailable(
                            "The AI stopped partway through. Try again."
                        ) from e
                    breaker.fail(time.monotonic(), settings.groq_breaker_threshold)
                    last_error = e.error
                    waits_too_long = (
                        e.retry_after is not None
                        and e.retry_after > settings.groq_max_retry_after_s
                    )
                    if attempt >= settings.groq_max_retries or waits_too_long:
                        break
                    delay = _backoff(attempt, e.retry_after)
                    log.info(
                        "groq %s transient failure (%s); retry %d in %.2fs",
                        candidate, e.error.code, attempt + 1, delay,
                    )
                    await asyncio.sleep(delay)

        raise last_error

    async def _stream_once(
        self, model: str, messages: list[ChatMessage], temperature: float
    ) -> AsyncIterator[str]:
        client = await self._get()
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        try:
            async with client.stream("POST", "/chat/completions", json=payload) as r:
                if r.status_code >= 400:
                    body = await r.aread()
                    # Log the provider's text; never surface it — it can carry
                    # account and quota details the user shouldn't see.
                    log.warning("groq %s on %s: %s", r.status_code, model, body[:300])
                    raise _classify(r.status_code, body, r.headers.get("retry-after"))
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    delta = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content")
                    )
                    if delta:
                        yield delta
        except httpx.TimeoutException as e:
            raise _Retryable(
                UpstreamUnavailable("The AI took too long to respond. Try again.")
            ) from e
        except httpx.HTTPError as e:
            raise _Retryable(UpstreamUnavailable("The AI service didn't respond.")) from e


def _classify(status: int, body: bytes, retry_after: str | None) -> Exception:
    """Sort a provider failure into: retry this model, try the next model, or
    stop — and pick the message the student sees if it comes to that.

    429 matters most for the message: 'at capacity, wait' is a different
    instruction than 'the service is down', and the UI toasts them differently.
    """
    code = _error_code(body)
    if status == 404 or code in _MODEL_GONE_CODES:
        return _ModelGone()
    if status == 429:
        return _Retryable(
            RateLimited("The AI is at capacity right now. Try again in a moment."),
            _parse_retry_after(retry_after),
        )
    if status in _RETRYABLE_STATUS:
        return _Retryable(UpstreamUnavailable("The AI service is unavailable."))
    if status in (401, 403):
        # Our key is bad — the user can't fix this, so don't imply they can.
        return NotConfigured("The AI provider rejected our credentials.")
    return UpstreamUnavailable("The AI couldn't handle that request.")


class StubLLM:
    """Streams a canned reply so the UI is exercisable without a real key."""

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        _ = messages, model, temperature
        text = (
            "This is a placeholder reply — the AI provider isn't configured yet.\n\n"
            "Add `GROQ_API_KEY` to your `.env`, restart the backend, and this "
            "message will be replaced with a real answer that cites your uploaded "
            "documents."
        )
        for word in text.split(" "):
            await asyncio.sleep(0.02)
            yield word + " "


# Module-level singleton — one instance per process.
_llm: LLM | None = None


def get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = GroqLLM() if settings.llm_configured else StubLLM()
    return _llm


async def close_llm() -> None:
    global _llm
    if isinstance(_llm, GroqLLM) and _llm._client is not None:  # noqa: SLF001
        await _llm._client.aclose()  # noqa: SLF001
    _llm = None


def loads_lenient(text: str) -> Any:
    """`json.loads`, but tolerant of the one thing models reliably get wrong.

    A model asked for `{"title": ..., "body_md": ...}` will happily put real
    newlines inside the markdown string rather than escaping them as `\\n`.
    That is invalid JSON — U+000A is a control character and the strict
    parser rejects it — so a perfectly good note was thrown away with
    "came back in an unexpected format" for the crime of having more than
    one line. Which is every note.

    `strict=False` is the documented switch for exactly this: it permits
    control characters inside strings and changes nothing else. Preferred
    over regex-repairing the payload, which would risk corrupting content
    that happens to contain braces or quotes.
    """

    return json.JSONDecoder(strict=False).decode(text)


def extract_title_line(raw: str, *, before: str = "[") -> str | None:
    """Pull a short model-written title out of a `TITLE: ...` line.

    Shared by quiz and flashcard-deck generation, which both ask the model
    to precede its JSON payload with `TITLE: <3-6 words>` — the one place a
    generated quiz or deck gets a real name instead of the caller's own
    (often unset, or a raw excerpt of chat text) `topic` string. Originally
    written for quizzes alone; decks had the exact same "topic ends up as
    the visible name, unedited" problem — `firstSentence()` on the frontend
    truncates a chat reply into a title-shaped string, `…` included, and
    nothing downstream ever replaced it with something a model was actually
    asked to write.

    Only looks `before` the payload marker (default `[`, the JSON array both
    callers use) rather than anywhere in the raw text, since a generated
    question or card can otherwise contain the word "title" itself.
    """
    array_start = raw.find(before)
    head = raw[:array_start] if array_start != -1 else raw
    for line in head.splitlines():
        line = line.strip().strip("*_# ")
        if line.upper().startswith("TITLE:"):
            title = line.split(":", 1)[1].strip().strip('"\'')
            return title[:140] or None
    return None
