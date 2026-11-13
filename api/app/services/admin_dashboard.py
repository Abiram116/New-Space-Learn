"""The numbers on the admin dashboard: a few bounded reads, kept for a minute.

Everything here is a count (a `HEAD` request, no rows) or a single capped read
of two id columns, so opening the page costs a couple of dozen light queries
at most, and only once a minute however often it is refreshed. One entry is
kept in memory. Nothing personal leaves this module: counts and day totals only,
never an email, a name or anything anyone wrote.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from . import supabase

_TTL_S = 60.0
#: Rows read when a distinct-people figure cannot be a plain count. Past this the
#: figure is an estimate from the newest rows, and the page says so.
_ROW_CAP = 5000
_DAYS = 30

_cache: tuple[float, dict[str, Any]] | None = None


def reset() -> None:
    global _cache
    _cache = None


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


async def _windowed(
    table: str, column: str, now: datetime, extra: dict[str, str] | None = None
) -> dict[str, int | None]:
    """Total, this week, and the week before for one table."""
    week, two_weeks = now - timedelta(days=7), now - timedelta(days=14)
    base = dict(extra or {})
    total, this_week, last_week = await asyncio.gather(
        supabase.db_count(table, filters=base),
        supabase.db_count(table, filters={**base, column: f"gte.{_iso(week)}"}),
        supabase.db_count(
            table, filters={**base, "and": f"({column}.gte.{_iso(two_weeks)},{column}.lt.{_iso(week)})"}
        ),
    )
    return {"total": total, "this_week": this_week, "last_week": last_week}


async def _distinct_users(table: str, filters: dict[str, str]) -> tuple[set[str], bool]:
    rows = await supabase.db_select(table, select="user_id", filters=filters, limit=_ROW_CAP)
    return {str(r["user_id"]) for r in rows if r.get("user_id")}, len(rows) >= _ROW_CAP


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


async def build(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    today = now.date()
    week, month = now - timedelta(days=7), now - timedelta(days=30)

    async def signups() -> dict[str, int]:
        total, new_7, new_30 = await asyncio.gather(
            supabase.db_count("user_settings"),
            supabase.db_count("user_settings", filters={"created_at": f"gte.{_iso(week)}"}),
            supabase.db_count("user_settings", filters={"created_at": f"gte.{_iso(month)}"}),
        )
        return {"total": total, "new_7d": new_7, "new_30d": new_30}

    async def activity() -> list[dict[str, Any]]:
        return await supabase.db_select(
            "daily_activity", select="user_id,day,chat_messages", order="day.desc", limit=_ROW_CAP
        )

    people, activity_rows, messages, files, notes, quizzes, reviews, cards, uploaders, carders, quizzers = (
        await asyncio.gather(
            signups(),
            activity(),
            _windowed("chat_messages", "created_at", now, {"role": "eq.user"}),
            _windowed("documents", "created_at", now, {"status": "eq.ready"}),
            _windowed("notes", "created_at", now),
            _windowed("quiz_results", "submitted_at", now),
            _windowed("card_reviews", "reviewed_at", now),
            supabase.db_count("flashcards"),
            _distinct_users("documents", {"status": "eq.ready"}),
            _distinct_users("flashcards", {}),
            _distinct_users("quiz_results", {}),
        )
    )

    # Daily active people, from the one capped read of per-day rows.
    per_day: dict[str, set[str]] = {}
    days_by_user: dict[str, set[str]] = {}
    asked: set[str] = set()
    for r in activity_rows:
        uid, day = str(r.get("user_id")), str(r.get("day"))[:10]
        per_day.setdefault(day, set()).add(uid)
        days_by_user.setdefault(uid, set()).add(day)
        if int(r.get("chat_messages") or 0) > 0:
            asked.add(uid)

    def active_since(days: int) -> int:
        cutoff = (today - timedelta(days=days - 1)).isoformat()
        return len(set().union(*(u for d, u in per_day.items() if d >= cutoff)) if per_day else set())

    series = [
        {"date": (d := (today - timedelta(days=_DAYS - 1 - i))).isoformat(), "count": len(per_day.get(d.isoformat(), ()))}
        for i in range(_DAYS)
    ]

    signed_up = people["total"]
    came_back = sum(1 for d in days_by_user.values() if len(d) >= 2)
    made_cards_or_quiz = carders[0] | quizzers[0]
    capped = bool(activity_rows and len(activity_rows) >= _ROW_CAP)
    steps = [
        ("Signed up", signed_up),
        ("Uploaded a file", min(len(uploaders[0]), signed_up)),
        ("Asked a question", min(len(asked), signed_up)),
        ("Made cards or a quiz", min(len(made_cards_or_quiz), signed_up)),
        ("Came back another day", min(came_back, signed_up)),
    ]
    approximate = capped or uploaders[1] or carders[1] or quizzers[1]

    return {
        "generated_at": now.isoformat(),
        "users": {
            **people,
            "active_1d": active_since(1),
            "active_7d": active_since(7),
            "active_30d": active_since(30),
            "daily": series,
        },
        "usage": {
            "messages": messages,
            "files": files,
            "notes": notes,
            "quizzes": quizzes,
            "reviews": reviews,
            # Cards carry no creation date, so only the total is known.
            "cards": {"total": cards, "this_week": None, "last_week": None},
        },
        "funnel": {
            "steps": [{"label": label, "count": n, "percent": _pct(n, signed_up)} for label, n in steps],
            "approximate": bool(approximate),
        },
    }


async def dashboard() -> dict[str, Any]:
    """`build()`, reused for a minute. One entry, so nothing grows."""
    global _cache
    now = time.monotonic()
    if _cache and _cache[0] > now:
        return _cache[1]
    result = await build()
    _cache = (now + _TTL_S, result)
    return result
