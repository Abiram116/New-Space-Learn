"""Developer and tester accounts are exempt from the per-student limits, and only they."""

import pytest

from app.config import settings
from app.errors import RateLimited
from app.services import ratelimit


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    ratelimit._buckets.clear()
    ratelimit._daily.clear()
    monkeypatch.setattr(settings, "llm_unlimited_user_ids", "dev-1, dev-2")
    yield
    ratelimit._buckets.clear()
    ratelimit._daily.clear()


async def test_a_listed_account_is_never_limited():
    for _ in range(200):
        await ratelimit.consume_llm_quota("dev-2", cost=2, daily=True)


async def test_everyone_else_still_is():
    with pytest.raises(RateLimited):
        for _ in range(200):
            await ratelimit.consume_llm_quota("student-1", cost=2, daily=True)


def test_an_empty_list_exempts_nobody(monkeypatch):
    monkeypatch.setattr(settings, "llm_unlimited_user_ids", "")
    assert not ratelimit.is_unlimited("")
    assert not ratelimit.is_unlimited("dev-1")
