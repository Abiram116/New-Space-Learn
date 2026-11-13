"""Which model each task uses, and how it degrades on the free tier (`ROUTES` in services/llm.py).

The free tier gives each model ~8,000 tokens a minute and 200,000 a day, shared by
every student. These pin the decisions that keep the app answering as it runs out:
the reply cap per task, chat moving to the small model before the large one's day is
gone (and the agents not), optional work skipped instead of spending the last
tokens, cheap work never moving up to the large model when it is scarce, retries
that never multiply load, and every move to a smaller model logged and counted.
No network, no key: a mock transport answers.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.errors import RateLimited, UpstreamUnavailable
from app.services import llm as llm_module
from app.services import usage
from app.services.context_budget import estimate_tokens
from app.services.llm import (
    DEFAULT_ROUTE,
    ROUTES,
    GroqLLM,
    _reply_budget,
    _wait_in_message,
    model_for,
    route_for,
)

LARGE, FAST, VISION = "big-model", "small-model", "eye-model"
OK = httpx.Response(200, content=b'data: {"choices": [{"delta": {"content": "ok"}}]}\n\ndata: [DONE]\n\n')


def _error(status: int, headers: dict | None = None, message: str = "provider detail") -> httpx.Response:
    return httpx.Response(status, content=json.dumps({"error": {"message": message}}).encode(), headers=headers or {})


class _Script:
    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.models: list[str] = []
        self.caps: list[int] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.models.append(body["model"])
        self.caps.append(body["max_completion_tokens"])
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def _llm(script: _Script) -> GroqLLM:
    llm = GroqLLM()
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(script))  # noqa: SLF001
    return llm


async def _ask(llm: GroqLLM, task: str, model: str | None = None) -> str:
    with usage.task(task):
        return "".join([d async for d in llm.stream_chat([{"role": "user", "content": "hi"}], model=model)])


def _spend_day(model: str, fraction: float) -> None:
    tokens = int(settings.groq_daily_token_limit * fraction)
    usage.record(model, {"prompt_tokens": tokens, "completion_tokens": 0})


@pytest.fixture(autouse=True)
def _setup(monkeypatch: pytest.MonkeyPatch):
    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(llm_module.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(settings, "groq_model", LARGE)
    monkeypatch.setattr(settings, "groq_model_fast", FAST)
    monkeypatch.setattr(settings, "groq_model_vision", VISION)
    monkeypatch.setattr(settings, "groq_max_retries", 2)
    monkeypatch.setattr(settings, "groq_max_attempts", 4)
    monkeypatch.setattr(settings, "groq_max_retry_after_s", 2.0)
    monkeypatch.setattr(settings, "groq_breaker_threshold", 3)
    monkeypatch.setattr(settings, "groq_daily_token_limit", 200_000)
    monkeypatch.setattr(settings, "groq_switch_at", 0.9)
    monkeypatch.setattr(settings, "groq_shed_at", 0.9)
    monkeypatch.setattr(settings, "groq_max_completion_tokens", 4096)
    usage.reset()
    yield
    usage.reset()


# ── The table itself ────────────────────────────────────────────────────


def test_every_task_the_app_tags_has_a_route_and_names_its_routes_model():
    """A new `usage.task("x")` without a route would silently get the defaults (the
    large model's 4,096-token cap and its fallback); a call site naming another model
    than its route would make the table, and the report built from it, wrong."""
    tier = {"groq_model_fast": "fast", "groq_model_vision": "vision", "groq_model": "large"}
    tag = re.compile(r'usage\.(?:task|tagged)\(\s*"([\w.]+)"')
    ref = re.compile(r"\b(?:settings|cfg)\.(groq_model_fast|groq_model_vision|groq_model)\b")
    app = Path(llm_module.__file__).resolve().parents[1]
    problems = []
    for path in app.rglob("*.py"):
        if path.name in ("usage.py", "llm.py"):
            continue
        text = path.read_text(encoding="utf-8")
        found = list(tag.finditer(text))
        for i, m in enumerate(found):
            end = found[i + 1].start() if i + 1 < len(found) else len(text)
            named = {tier[t] for t in ref.findall(text[m.end(): min(end, m.end() + 2500)])}
            route = ROUTES.get(m.group(1))
            if route is None:
                problems.append(f"{path.name}: {m.group(1)} has no route")
            elif named and route.tier not in named:
                problems.append(f"{path.name}: {m.group(1)} names {named}, route says {route.tier}")
    assert problems == []


def test_reply_caps_are_per_task_and_never_above_the_setting(monkeypatch: pytest.MonkeyPatch):
    assert _reply_budget(LARGE, "chat.resolve")["max_completion_tokens"] == ROUTES["chat.resolve"].max_tokens < 4096
    assert _reply_budget(LARGE, "quiz.write")["max_completion_tokens"] == 4096
    assert _reply_budget(LARGE, "never-heard-of-it")["max_completion_tokens"] == 4096
    assert _reply_budget(LARGE)["max_completion_tokens"] == 4096  # untagged: as before
    monkeypatch.setattr(settings, "groq_max_completion_tokens", 300)
    assert _reply_budget(LARGE, "quiz.write")["max_completion_tokens"] == 300
    for r in ROUTES.values():
        assert 0 < r.reply_tokens <= r.max_tokens <= 4096


def test_the_routing_table_keeps_quality_where_it_matters():
    # What students read and what agents write stays on the large model.
    for task in ("chat", "quiz.write", "quiz.repair", "cards.write", "notes.write"):
        assert ROUTES[task].tier == "large", task
    # Images only ever go to the vision model, which has nothing to fall back to.
    assert all(not r.fallback for r in ROUTES.values() if r.tier == "vision")
    # Only chat gives up the large model early; the agents keep the last of its day.
    assert [t for t, r in ROUTES.items() if r.degrade_early] == ["chat"]
    assert route_for("something-new") is DEFAULT_ROUTE
    assert route_for(None) is DEFAULT_ROUTE


async def test_the_task_reply_cap_reaches_the_request():
    script = _Script(OK)
    await _ask(_llm(script), "chat.resolve", FAST)
    assert script.caps == [ROUTES["chat.resolve"].max_tokens]


# ── model_for: the chat route's one decision ────────────────────────────


def test_model_for_picks_by_task_and_image():
    assert model_for("chat") == LARGE
    assert model_for("chat.smalltalk") == FAST
    assert model_for("chat", images=True) == VISION
    assert model_for("quiz.write") == LARGE


def test_chat_moves_to_the_small_model_once_the_large_models_day_is_nearly_spent(caplog):
    _spend_day(LARGE, 0.91)
    with caplog.at_level(logging.WARNING, logger="space_learn.llm"):
        assert model_for("chat") == FAST
    assert "routing task=chat" in caplog.text
    assert usage.snapshot()["reroutes"] == [
        {"task": "chat", "wanted": LARGE, "used": FAST, "why": "day-nearly-spent", "count": 1}
    ]
    # An image still needs eyes, and the agents keep the large model's last tokens.
    assert model_for("chat", images=True) == VISION
    assert model_for("quiz.write") == LARGE


def test_below_the_switch_point_chat_stays_on_the_large_model():
    _spend_day(LARGE, 0.85)
    assert model_for("chat") == LARGE


# ── Optional work, and cheap work moving up ─────────────────────────────


async def test_optional_work_is_skipped_without_a_call_once_its_models_day_is_nearly_spent():
    _spend_day(FAST, 0.95)
    script = _Script()
    with pytest.raises(RateLimited):
        await _ask(_llm(script), "brief", FAST)
    assert script.models == []
    assert usage.snapshot()["reroutes"][0] | {} == {"task": "brief", "wanted": FAST, "used": None, "why": "shed", "count": 1}


async def test_optional_work_never_falls_back_to_the_large_model():
    script = _Script(_error(503), _error(503), _error(503))
    with pytest.raises(UpstreamUnavailable):
        await _ask(_llm(script), "chat.starters", FAST)
    assert set(script.models) == {FAST}


async def test_cheap_work_moves_up_to_the_large_model_only_while_it_is_plentiful():
    script = _Script(_error(404), OK)
    assert await _ask(_llm(script), "quiz.verify", FAST) == "ok"
    assert script.models == [FAST, LARGE]

    _spend_day(LARGE, 0.95)
    script = _Script(_error(404))
    with pytest.raises(UpstreamUnavailable):
        await _ask(_llm(script), "quiz.verify", FAST)
    assert script.models == [FAST]


# ── Falling back is never silent ────────────────────────────────────────


async def test_a_move_down_to_the_small_model_is_a_logged_and_counted_warning(caplog):
    script = _Script(_error(404), OK)
    with caplog.at_level(logging.WARNING, logger="space_learn.llm"):
        assert await _ask(_llm(script), "quiz.write", LARGE) == "ok"
    assert "task=quiz.write answered by small-model instead of big-model (model-gone)" in caplog.text
    [row] = usage.snapshot()["reroutes"]
    assert (row["task"], row["wanted"], row["used"], row["why"]) == ("quiz.write", LARGE, FAST, "model-gone")


# ── Retries never multiply load ─────────────────────────────────────────


async def test_a_timeout_is_not_retried_on_the_same_model():
    script = _Script(httpx.ReadTimeout("slow"), OK)
    assert await _ask(_llm(script), "chat", LARGE) == "ok"
    assert script.models == [LARGE, FAST]


async def test_a_refusal_without_a_stated_wait_goes_straight_to_the_fallback():
    script = _Script(_error(429), OK)
    assert await _ask(_llm(script), "chat", LARGE) == "ok"
    assert script.models == [LARGE, FAST]


async def test_one_call_makes_at_most_the_attempt_budget_across_both_models():
    script = _Script(*[_error(503)] * 10)
    with pytest.raises(UpstreamUnavailable):
        await _ask(_llm(script), "chat", LARGE)
    assert len(script.models) == settings.groq_max_attempts
    assert script.models[-1] == FAST  # the fallback always gets its try


async def test_a_long_refusal_is_remembered_so_later_calls_skip_that_model():
    llm = _llm(_Script())
    first = _Script(_error(429, {"retry-after": "60"}), OK)
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(first))  # noqa: SLF001
    await _ask(llm, "chat", LARGE)
    second = _Script(OK)
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(second))  # noqa: SLF001
    assert await _ask(llm, "chat", LARGE) == "ok"
    assert second.models == [FAST]
    assert usage.snapshot()["reroutes"][-1]["why"] == "refused-recently"


async def test_the_wait_in_groqs_message_is_used_when_the_header_is_missing():
    assert _wait_in_message(b'{"error":{"message":"... Please try again in 7m12.5s. Need more tokens?"}}') == 432.5
    assert _wait_in_message(b"try again in 950ms") == 0.95
    assert _wait_in_message(b"no wait here") is None
    # A day's refusal names minutes: that model is skipped by the next call too.
    llm = _llm(_Script())
    first = _Script(_error(429, message="Rate limit reached on tokens per day (TPD). Please try again in 7m12.5s."), OK)
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(first))  # noqa: SLF001
    await _ask(llm, "quiz.write", LARGE)
    assert first.models == [LARGE, FAST]
    second = _Script(OK)
    llm._client = httpx.AsyncClient(base_url="https://groq.test", transport=httpx.MockTransport(second))  # noqa: SLF001
    await _ask(llm, "quiz.write", LARGE)
    assert second.models == [FAST]
    assert usage.snapshot()["refusals"] == [{"task": "quiz.write", "model": LARGE, "count": 1}]


async def test_a_request_too_large_for_a_minute_is_not_sent_to_the_other_model():
    script = _Script(_error(413, message="Request too large on tokens per minute (TPM): Limit 8000, Requested 9100"))
    with pytest.raises(UpstreamUnavailable, match="shorter"):
        await _ask(_llm(script), "chat", LARGE)
    assert script.models == [LARGE]


# ── This minute's allowance ─────────────────────────────────────────────


def test_minute_wait_follows_groqs_headers_and_refills(monkeypatch: pytest.MonkeyPatch):
    clock = [1000.0]
    monkeypatch.setattr(usage.time, "time", lambda: clock[0])
    assert usage.minute_wait_s(LARGE, 3000) == 0.0  # no reading: no opinion
    usage.limits(LARGE, {"x-ratelimit-remaining-tokens": "500", "x-ratelimit-limit-tokens": "8000"})
    assert usage.minute_wait_s(LARGE, 3000) == pytest.approx(2500 / (8000 / 60))
    clock[0] += 30  # half a minute refills 4,000
    assert usage.minute_wait_s(LARGE, 3000) == 0.0
    assert usage.minute_wait_s(LARGE, 9000) == 0.0  # could never fit: the provider's call


async def test_a_model_short_of_this_minutes_tokens_is_skipped_for_the_fallback():
    usage.limits(LARGE, {"x-ratelimit-remaining-tokens": "100", "x-ratelimit-limit-tokens": "8000"})
    script = _Script(OK)
    assert await _ask(_llm(script), "chat", LARGE) == "ok"
    assert script.models == [FAST]
    assert usage.snapshot()["reroutes"][0]["why"] == "minute-spent"


async def test_the_last_model_is_tried_even_when_its_minute_looks_spent():
    usage.limits(VISION, {"x-ratelimit-remaining-tokens": "0", "x-ratelimit-limit-tokens": "8000"})
    script = _Script(OK)
    image = [{"role": "user", "content": [{"type": "text", "text": "what is this"}]}]
    with usage.task("image.read"):
        got = "".join([d async for d in _llm(script).stream_chat(image, model=VISION)])
    assert got == "ok"
    assert script.models == [VISION]


def test_token_estimate_counts_text_parts_and_messages():
    assert estimate_tokens([{"role": "user", "content": "x" * 400}]) == 104
    assert estimate_tokens([{"role": "user", "content": [{"type": "text", "text": "x" * 40}, {"type": "image_url"}]}]) == 14
