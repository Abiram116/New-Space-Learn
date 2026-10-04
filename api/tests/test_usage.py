"""What each model call costs, counted by task (`services/usage`).

The counts are what every token-saving change will be judged by, so the
counting itself is pinned: the right task gets the call even when the reply is
streamed somewhere else, a daily-limit refusal is told apart from a per-minute
one, and the numbers reach the admin page and nobody else.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.errors import RateLimited
from app.main import create_app
from app.services import admin_gate, usage
from app.services import llm as llm_module
from app.services.llm import GroqLLM

MODEL = "big-model"
REPORT = {
    "prompt_tokens": 1200,
    "completion_tokens": 300,
    "completion_tokens_details": {"reasoning_tokens": 40},
    "prompt_tokens_details": {"cached_tokens": 1024},
}


def _sse(*deltas: str, report: dict | None = REPORT) -> bytes:
    lines = ["data: " + json.dumps({"choices": [{"delta": {"content": d}}]}) for d in deltas]
    if report is not None:
        # Groq puts the whole call's use on the last chunk, under `x_groq`.
        lines.append("data: " + json.dumps({"choices": [{"delta": {}}], "x_groq": {"usage": report}}))
    return ("\n\n".join([*lines, "data: [DONE]"]) + "\n\n").encode()


def _llm(*responses: httpx.Response) -> GroqLLM:
    queue = list(responses)
    llm = GroqLLM()
    llm._client = httpx.AsyncClient(  # noqa: SLF001
        base_url="https://groq.test", transport=httpx.MockTransport(lambda _: queue.pop(0))
    )
    return llm


async def _drain(llm: GroqLLM) -> str:
    return "".join([d async for d in llm.stream_chat([{"role": "user", "content": "hi"}], model=MODEL)])


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch):
    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(llm_module.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(settings, "groq_model", MODEL)
    monkeypatch.setattr(settings, "groq_model_fast", MODEL)
    monkeypatch.setattr(settings, "groq_max_retries", 0)
    usage.reset()
    yield
    usage.reset()


async def test_a_call_is_counted_under_its_task():
    llm = _llm(httpx.Response(200, content=_sse("Hel", "lo"), headers={"x-ratelimit-remaining-tokens": "6500"}))
    with usage.task("quiz.verify"):
        assert await _drain(llm) == "Hello"

    snap = usage.snapshot()
    [row] = snap["tasks"]
    assert (row["task"], row["model"], row["calls"]) == ("quiz.verify", MODEL, 1)
    assert (row["prompt"], row["reply"], row["reasoning"], row["cached"]) == (1200, 300, 40, 1024)
    [model] = snap["models"]
    assert model["tokens_today"] == 1500
    assert model["limits"]["remaining-tokens"] == "6500"


async def test_an_untagged_call_is_still_counted():
    await _drain(_llm(httpx.Response(200, content=_sse("ok"))))
    assert usage.snapshot()["tasks"][0]["task"] == "other"


async def test_the_task_is_the_one_in_force_when_the_call_began():
    """A streamed reply is read after the caller's block may have moved on."""
    llm = _llm(httpx.Response(200, content=_sse("a", "b")))
    with usage.task("chat"):
        stream = llm.stream_chat([{"role": "user", "content": "hi"}], model=MODEL)
        first = await anext(stream)
    rest = [d async for d in stream]
    assert first + "".join(rest) == "ab"
    assert usage.snapshot()["tasks"][0]["task"] == "chat"


async def test_the_decorator_tags_a_whole_function():
    @usage.tagged("chat.memory")
    async def summarise() -> str:
        return await _drain(_llm(httpx.Response(200, content=_sse("ok"))))

    await summarise()
    assert usage.current_task() == "other"  # nothing leaks out of it
    assert usage.snapshot()["tasks"][0]["task"] == "chat.memory"


async def test_a_reply_without_a_report_counts_nothing():
    await _drain(_llm(httpx.Response(200, content=_sse("ok", report=None))))
    assert usage.snapshot()["tasks"] == []


@pytest.mark.parametrize(
    ("message", "field"),
    [
        ("Rate limit reached ... on tokens per day (TPD): Limit 200000", "refused_day"),
        ("Rate limit reached ... on tokens per minute (TPM): Limit 8000", "refused_minute"),
    ],
)
async def test_a_daily_refusal_is_told_apart_from_a_minute_one(message, field):
    body = json.dumps({"error": {"message": message}}).encode()
    with pytest.raises(RateLimited):
        await _drain(_llm(httpx.Response(429, content=body)))
    [model] = usage.snapshot()["models"]
    assert model[field] == 1
    assert model["refused_day" if field == "refused_minute" else "refused_minute"] == 0


def test_the_numbers_are_for_the_admin_page_only(monkeypatch: pytest.MonkeyPatch):
    usage.record(MODEL, REPORT)
    monkeypatch.setattr(settings, "admin_password_hash", admin_gate.hash_password("correct horse"))
    client = TestClient(create_app())
    assert client.get("/api/v1/admin/usage").status_code == 403
    token, _ = admin_gate.issue_token()
    r = client.get("/api/v1/admin/usage", headers={"X-Admin-Token": token})
    assert r.status_code == 200
    assert r.json()["tasks"][0]["prompt"] == 1200
