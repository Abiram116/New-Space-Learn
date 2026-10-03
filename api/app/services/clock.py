"""What day it is — for the student, not for the server.

Render runs in UTC. A student in India who reviews cards at 1 a.m. has started
a new day; the server, five and a half hours behind them, had it still counting
toward yesterday, so the streak and the daily goal lagged until 05:30. Every
"today" in the app goes through `today()` here instead of `date.today()`.

The zone comes from the browser, on every request, as an `X-Timezone` header
(an IANA name such as `Asia/Kolkata`, or signed minutes east of UTC). It is
held in a context variable for the life of that request, so nothing has to pass
it down by hand. No header, or one we can't read, means UTC — exactly the old
behaviour, never an error.
"""

from __future__ import annotations

import re
from contextvars import ContextVar
from datetime import UTC, date, datetime, timedelta, timezone, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo

HEADER = "x-timezone"

_zone_var: ContextVar[tzinfo | None] = ContextVar("user_zone", default=None)


@lru_cache(maxsize=128)
def parse_zone(tz: str | None) -> tzinfo | None:
    """The client's zone, from an IANA name or signed minutes east of UTC.

    Deliberately strict about what it will even look up: the value is
    attacker-controlled, and `ZoneInfo` resolves names against the filesystem.
    """
    if not tz:
        return None
    tz = tz.strip()
    if re.fullmatch(r"[+-]?\d{1,4}", tz):
        minutes = int(tz)
        return timezone(timedelta(minutes=minutes)) if abs(minutes) <= 14 * 60 else None
    if not re.fullmatch(r"[A-Za-z0-9_+\-/]{1,64}", tz) or ".." in tz or tz.startswith("/"):
        return None
    try:
        return ZoneInfo(tz)
    except Exception:  # noqa: BLE001 — unknown key, missing tzdata, malformed path
        return None


def set_zone(tz: str | None) -> None:
    """Record this request's zone (called by the middleware in `main.py`)."""
    _zone_var.set(parse_zone(tz))


def zone() -> tzinfo | None:
    """This request's zone, or None when the client sent none we could read."""
    return _zone_var.get()


def today(now: datetime | None = None) -> date:
    """The student's calendar date right now (UTC when their zone is unknown)."""
    now = now or datetime.now(UTC)
    return now.astimezone(_zone_var.get() or UTC).date()
