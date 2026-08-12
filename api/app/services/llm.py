"""LLM interface + Groq implementation + graceful stub when no key is set.

The Chat streaming route treats every LLM as an `AsyncIterator[str]`. That
keeps SSE happy and lets us swap Groq for OpenAI, Anthropic, or a local model
by writing one class — no route changes required.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
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


class GroqLLM:
    """OpenAI-compatible client pointed at Groq."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

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

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        client = await self._get()
        payload: dict[str, Any] = {
            "model": model or settings.groq_model,
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
                    log.warning("groq %s: %s", r.status_code, body[:300])
                    raise _upstream_error(r.status_code)
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
            raise UpstreamUnavailable("The AI took too long to respond. Try again.") from e
        except httpx.HTTPError as e:
            raise UpstreamUnavailable("The AI service didn't respond.") from e


def _upstream_error(status: int) -> ApiError:
    """Translate a provider status into our own typed error.

    429 matters most: 'you're rate limited, wait' is a different instruction to
    the user than 'the service is down', and the UI toasts them differently.
    """
    if status == 429:
        return RateLimited("The AI is at capacity right now. Try again in a moment.")
    if status in (401, 403):
        # Our key is bad — the user can't fix this, so don't imply they can.
        return NotConfigured("The AI provider rejected our credentials.")
    if status == 400:
        return UpstreamUnavailable("The AI couldn't handle that request.")
    return UpstreamUnavailable("The AI service is unavailable.")


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
