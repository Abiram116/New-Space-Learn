import asyncio

from app.config import settings
from app.deps import CurrentUser
from app.routers.me import account
from app.services import ratelimit


def test_the_limits_page_reports_what_the_code_enforces_and_the_callers_own_usage(monkeypatch):
    ratelimit._daily.clear()
    user = CurrentUser(id="u-limits", email="a@b.c") if "email" in CurrentUser.__dataclass_fields__ else CurrentUser(id="u-limits")
    out = asyncio.run(account.get_limits(user))
    assert out["answers"]["per_day"] == int(settings.llm_daily_quota)
    assert out["answers"]["left_today"] == out["answers"]["per_day"]
    assert out["files"]["max_mb"] == 20
    assert out["files"]["max_passages"] > 0 and out["files"]["scan_pages"] > 0
    assert out["messages"]["max_chars"] == 4000 and out["messages"]["images_per_message"] == 3

    # Spending shows up: a chat answer costs 1, a quiz 2.
    asyncio.run(ratelimit.consume_llm_quota(user.id, cost=1.0, daily=True))
    asyncio.run(ratelimit.consume_llm_quota(user.id, cost=2.0, daily=True))
    assert asyncio.run(account.get_limits(user))["answers"]["left_today"] == out["answers"]["per_day"] - 3
    ratelimit._daily.clear()
