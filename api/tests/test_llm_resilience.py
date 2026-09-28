"""The LLM client's retry / fallback / circuit-breaker behaviour.

Every path here is one that looks correct in review and fails silently in
production: a decommissioned model that should have fallen back, a retry that
duplicated half an answer, a breaker that never opened. Each is pinned against
a mock transport — no network, no key, no Groq quota spent.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import settings
from app.errors import NotConfigured, RateLimited, UpstreamUnavailable
from app.services import llm as llm_module
from app.services.llm import GroqLLM

PRIMARY = "big-model"
SECONDARY = "small-model"


def _sse(*deltas: str) -> bytes:
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": d}}]}) for d in deltas
    ]
    return ("\n\n".join([*lines, "data: [DONE]"]) + "\n\n").encode()


def _error(status: int, code: str | None = None, headers: dict | None = None) -> httpx.Response:
    body = json.dumps({"error": {"code": code, "message": "provider detail"}})
    return httpx.Response(status, content=body.encode(), headers=headers or {})


class _Script:
    """Answers each request from a queue of responses, recording which model
    was asked for — so a test can assert on the exact fallback order."""

    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.models: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.models.append(json.loads(request.content)["model"])
        nxt = self.responses.pop(0)
        return nxt(request) if callable(nxt) else nxt


def _client(script: _Script) -> GroqLLM:
    llm = GroqLLM()
    llm._client = httpx.AsyncClient(  # noqa: SLF001
        base_url="https://groq.test", transport=httpx.MockTransport(script)
    )
    return llm


async def _collect(llm: GroqLLM, messages=None, model=None) -> str:
    out = []
    async for d in llm.stream_chat(messages or [{"role": "user", "content": "hi"}], model=model):
        out.append(d)
    return "".join(out)


@pytest.fixture(autouse=True)
def _fast(monkeypatch: pytest.MonkeyPatch):
    """No real sleeping, deterministic model names, predictable limits."""

    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(llm_module.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(settings, "groq_model", PRIMARY)
    monkeypatch.setattr(settings, "groq_model_fast", SECONDARY)
    monkeypatch.setattr(settings, "groq_max_retries", 2)
    monkeypatch.setattr(settings, "groq_max_retry_after_s", 2.0)
    monkeypatch.setattr(settings, "groq_breaker_threshold", 3)
    monkeypatch.setattr(settings, "groq_breaker_cooldown_s", 30.0)


# ── Retry ───────────────────────────────────────────────────────────────


async def test_transient_failure_retries_same_model_then_succeeds():
    script = _Script(_error(503), httpx.Response(200, content=_sse("Hel", "lo")))
    assert await _collect(_client(script)) == "Hello"
    assert script.models == [PRIMARY, PRIMARY]


async def test_short_retry_after_is_honoured_on_the_same_model():
    script = _Script(
        _error(429, headers={"retry-after": "1"}),
        httpx.Response(200, content=_sse("ok")),
    )
    assert await _collect(_client(script)) == "ok"
    assert script.models == [PRIMARY, PRIMARY]


async def test_long_retry_after_skips_the_wait_and_falls_back():
    # Sleeping 60s for the big model is worse than answering now with the other.
    script = _Script(
        _error(429, headers={"retry-after": "60"}),
        httpx.Response(200, content=_sse("fallback")),
    )
    assert await _collect(_client(script)) == "fallback"
    assert script.models == [PRIMARY, SECONDARY]


async def test_exhausted_retries_fall_back_to_the_other_text_model():
    script = _Script(
        _error(503), _error(503), _error(503),
        httpx.Response(200, content=_sse("saved")),
    )
    assert await _collect(_client(script)) == "saved"
    assert script.models == [PRIMARY, PRIMARY, PRIMARY, SECONDARY]


async def test_every_model_failing_surfaces_the_last_real_error():
    script = _Script(*[_error(429)] * 6)
    with pytest.raises(RateLimited):
        await _collect(_client(script))


# ── Model gone ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "response",
    [
        _error(404),
        _error(400, code="model_decommissioned"),
        _error(400, code="model_not_found"),
    ],
)
async def test_a_gone_model_falls_back_immediately_without_retrying(response):
    # This is the exact shape of both real 2026 decommissions.
    script = _Script(response, httpx.Response(200, content=_sse("still here")))
    assert await _collect(_client(script)) == "still here"
    assert script.models == [PRIMARY, SECONDARY]


# ── Permanent failures ──────────────────────────────────────────────────


async def test_bad_credentials_stop_immediately_without_fallback():
    # The other model shares the key; trying it can only fail the same way.
    script = _Script(_error(401))
    with pytest.raises(NotConfigured):
        await _collect(_client(script))
    assert script.models == [PRIMARY]


async def test_an_ordinary_bad_request_is_not_retried():
    script = _Script(_error(400, code="invalid_request"))
    with pytest.raises(UpstreamUnavailable):
        await _collect(_client(script))
    assert script.models == [PRIMARY]


# ── Never retry after the first token ───────────────────────────────────


class _DiesMidStream(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield ("data: " + json.dumps({"choices": [{"delta": {"content": "Half"}}]}) + "\n\n").encode()
        raise httpx.ReadError("connection dropped")


async def test_a_failure_after_the_first_token_is_never_retried():
    script = _Script(
        httpx.Response(200, stream=_DiesMidStream()),
        httpx.Response(200, content=_sse("should never be requested")),
    )
    got: list[str] = []
    with pytest.raises(UpstreamUnavailable, match="partway"):
        async for d in _client(script).stream_chat([{"role": "user", "content": "hi"}]):
            got.append(d)
    # The student saw "Half" once — a retry would have repeated it.
    assert got == ["Half"]
    assert script.models == [PRIMARY]


# ── Vision never falls back ─────────────────────────────────────────────


async def test_an_image_request_does_not_fall_back_to_a_text_model():
    image_msg = [{"role": "user", "content": [{"type": "text", "text": "what is this"}]}]
    script = _Script(_error(404))
    with pytest.raises(UpstreamUnavailable):
        await _collect(_client(script), messages=image_msg, model="vision-model")
    assert script.models == ["vision-model"]


# ── Circuit breaker ─────────────────────────────────────────────────────


async def test_breaker_opens_and_later_requests_skip_the_dead_model():
    llm = _client(_Script())
    # Request 1: primary fails 3×, opening its circuit, then fallback answers.
    first = _Script(_error(503), _error(503), _error(503), httpx.Response(200, content=_sse("a")))
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(first))  # noqa: SLF001
    assert await _collect(llm) == "a"

    # Request 2: primary is skipped outright — not one call wasted on it.
    second = _Script(httpx.Response(200, content=_sse("b")))
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(second))  # noqa: SLF001
    assert await _collect(llm) == "b"
    assert second.models == [SECONDARY]


async def test_breaker_lets_a_probe_through_after_the_cooldown(monkeypatch: pytest.MonkeyPatch):
    llm = _client(_Script())
    clock = [1000.0]
    monkeypatch.setattr(llm_module.time, "monotonic", lambda: clock[0])

    first = _Script(_error(503), _error(503), _error(503), httpx.Response(200, content=_sse("a")))
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(first))  # noqa: SLF001
    await _collect(llm)

    clock[0] += 31  # past the 30s cooldown
    probe = _Script(httpx.Response(200, content=_sse("recovered")))
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(probe))  # noqa: SLF001
    assert await _collect(llm) == "recovered"
    assert probe.models == [PRIMARY]
