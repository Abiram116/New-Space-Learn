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
from ..errors import UpstreamUnavailable

log = logging.getLogger("space_learn.llm")


ChatMessage = dict[str, str]  # {"role": "system"|"user"|"assistant", "content": ...}


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
                timeout=httpx.Timeout(60.0, connect=5.0),
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
                    log.warning("groq %s: %s", r.status_code, body[:200])
                    raise UpstreamUnavailable("The AI service is unavailable.")
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
        except httpx.HTTPError as e:
            raise UpstreamUnavailable("The AI service didn't respond.") from e


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
