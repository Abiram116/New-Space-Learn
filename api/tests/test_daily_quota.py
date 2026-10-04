"""A student's day: 30 answers, rolling, only for the text models — and nobody else's business."""

from __future__ import annotations

import pytest

from app.config import settings
from app.errors import RateLimited
from app.services import ratelimit


@pytest.fixture
def clock(monkeypatch):
    """Wall and monotonic time moved together by hand."""
    now = [1_000_000.0]
    monkeypatch.setattr(ratelimit.time, "time", lambda: now[0])
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: now[0])
    return now


async def _ask(user: str, n: int, *, cost=1.0, daily=True, clock=None, gap=20.0):
    for _ in range(n):
        await ratelimit.consume_llm_quota(user, cost=cost, daily=daily)
        if clock is not None:
            clock[0] += gap  # slower than the per-minute refill, so only the day can refuse


@pytest.mark.asyncio
async def test_a_student_gets_their_full_daily_allowance_and_then_is_told_plainly(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit, clock=clock)
    with pytest.raises(RateLimited) as err:
        await ratelimit.consume_llm_quota("a", daily=True)
    assert f"{limit} free answers" in err.value.message
    assert "frees up in" in err.value.message


@pytest.mark.asyncio
async def test_the_day_is_rolling_so_answers_come_back_one_by_one(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit, clock=clock)
    # A day after the FIRST answer, that one has expired; the rest have not.
    clock[0] = 1_000_000.0 + ratelimit.DAILY_WINDOW_S + 5
    await ratelimit.consume_llm_quota("a", daily=True)
    with pytest.raises(RateLimited):
        await ratelimit.consume_llm_quota("a", daily=True)


@pytest.mark.asyncio
async def test_a_quiz_costs_two_answers_of_the_day(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit - 1, clock=clock)
    with pytest.raises(RateLimited):
        await ratelimit.consume_llm_quota("a", cost=2, daily=True)  # one left, a quiz needs two


@pytest.mark.asyncio
async def test_calls_that_spend_no_text_model_allowance_never_use_up_the_day(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit * 2, daily=False, clock=clock)  # reading scans, plain uploads
    await ratelimit.consume_llm_quota("a", daily=True)  # the day is untouched


@pytest.mark.asyncio
async def test_one_students_day_is_not_anothers(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit, clock=clock)
    await ratelimit.consume_llm_quota("b", daily=True)


@pytest.mark.asyncio
async def test_a_refused_call_takes_nothing(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit, clock=clock)
    for _ in range(3):
        with pytest.raises(RateLimited):
            await ratelimit.consume_llm_quota("a", daily=True)
    clock[0] = 1_000_000.0 + ratelimit.DAILY_WINDOW_S + 5
    await ratelimit.consume_llm_quota("a", daily=True)  # the first expired; refusals did not extend it


@pytest.mark.asyncio
async def test_the_per_minute_burst_is_sized_to_what_the_key_can_serve(clock):
    assert ratelimit.CAPACITY <= 8  # the key serves ~3 a minute for everyone; 20 let one student take it all
    for _ in range(int(ratelimit.CAPACITY)):
        await ratelimit.consume_llm_quota("a")
    with pytest.raises(RateLimited) as err:
        await ratelimit.consume_llm_quota("a")
    assert "second" in err.value.message


@pytest.mark.asyncio
async def test_a_refunded_call_gives_back_the_day_and_the_burst(clock):
    limit = int(settings.llm_daily_quota)
    await _ask("a", limit - 1, clock=clock)
    await ratelimit.consume_llm_quota("a", daily=True)  # the last one of the day
    ratelimit.refund("a", 1.0)
    await ratelimit.consume_llm_quota("a", daily=True)  # fits again
    with pytest.raises(RateLimited):
        await ratelimit.consume_llm_quota("a", daily=True)


def test_the_switch_to_the_small_model_follows_our_own_token_count(monkeypatch):
    from app.services import usage

    usage.reset()
    usage.record("m", {"prompt_tokens": 150_000, "completion_tokens": 31_000})
    assert usage.near_daily_limit("m", 200_000, 0.9) is True
    assert usage.near_daily_limit("m", 200_000, 0.95) is False
    assert usage.near_daily_limit("other", 200_000, 0.9) is False
    usage.reset()
