"""`GET /me/stats` — every number Home and Profile display.

One endpoint rather than five, because Home blocks on all of it and five
round trips to a remote Postgres is five cold-start penalties. The reads
inside are independent and run under one `asyncio.gather`."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from ...deps import CurrentUser, get_current_user
from ...schemas import (
    Badge,
    ForecastDay,
    HeatmapCell,
    StatsOut,
    StudyComposition,
)
from ...services import supabase
from ...services.streaks import compute_max_streak, compute_streak, to_date
from ._common import _count, _ensure_settings_row

router = APIRouter()


# ── Stats ──────────────────────────────────────────────────────────────


@router.get("/me/stats", response_model=StatsOut)
async def stats(user: CurrentUser = Depends(get_current_user)) -> StatsOut:
    # Home waits on this before it can render, and every one of these reads is
    # a separate network round trip to PostgREST. Run sequentially they stacked
    # to roughly two seconds; they're all independent, so they go concurrently.
    today = date.today()
    # Half a year of activity, aligned so the grid starts on a Monday. Eight
    # weeks was too little to read as a trend — a student looking at their own
    # analytics wants to see a term, not a fortnight.
    start = today - timedelta(days=181)
    since = start - timedelta(days=start.weekday())

    (
        settings_row,
        days,
        due_pair,
        quiz_avg,
        docs_indexed,
        spaces_count,
        max_reps,
        has_perfect,
    ) = await asyncio.gather(
        _ensure_settings_row(user.id),
        supabase.db_select(
            "daily_activity",
            filters={
                "user_id": f"eq.{user.id}",
                "day": f"gte.{since.isoformat()}",
            },
            order="day.asc",
        ),
        _cards_due_and_forecast(user.id),
        _quiz_average(user.id),
        _count(user.id, "documents", extra={"status": "eq.ready"}),
        _count(user.id, "subjects"),
        _cards_mastered(user.id),
        _has_perfect_quiz(user.id),
    )

    by_day: dict[str, dict] = {row["day"]: row for row in days}
    heatmap: list[HeatmapCell] = []
    max_seconds = max((int(r.get("study_seconds", 0)) for r in days), default=1) or 1
    d = since
    while d <= today:
        row = by_day.get(d.isoformat())
        seconds = int(row["study_seconds"]) if row else 0
        intensity = 0
        if seconds > 0:
            ratio = seconds / max_seconds
            intensity = 1 + min(2, int(ratio * 3))
        # Round up, so a day with any logged activity never reads as "0m".
        minutes = -(-seconds // 60) if seconds else 0
        heatmap.append(HeatmapCell(day=d, intensity=intensity, minutes=minutes))
        d += timedelta(days=1)

    # Streak: consecutive days ending today (or yesterday if streak-freeze on).
    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = compute_streak([r["day"] for r in days], today, freeze=freeze)
    max_streak = compute_max_streak([r["day"] for r in days])

    week_start = today - timedelta(days=6)
    week_rows = [r for r in days if to_date(r["day"]) >= week_start]
    week_seconds = sum(int(r.get("study_seconds", 0)) for r in week_rows)

    cards_due, due_forecast = due_pair

    # These three counters have been written on every chat message, card grade
    # and quiz submission since the app shipped, and no endpoint had ever read
    # them — the app could say how LONG you studied but not WHAT you did. The
    # row is already selected in full, so this is arithmetic, not I/O.
    def _sum(field: str) -> int:
        return sum(int(r.get(field) or 0) for r in week_rows)

    composition = StudyComposition(
        chat_messages=_sum("chat_messages"),
        cards_reviewed=_sum("cards_reviewed"),
        quizzes_taken=_sum("quizzes_taken"),
    )

    badges = [
        Badge(
            id="first_steps", label="First card", icon="deck", tone="sky",
            tier="common", earned=max_reps >= 1,
            hint="Review a single flashcard.",
        ),
        Badge(
            id="streak_10", label="10-day streak", icon="flame", tone="sun",
            tier="common", earned=max_streak >= 10,
            hint="Study ten days in a row.",
        ),
        Badge(
            id="ten_docs", label="Well read", icon="doc", tone="mint",
            tier="rare", earned=docs_indexed >= 10,
            hint="Index ten documents.",
        ),
        Badge(
            id="perfect_quiz", label="Perfect score", icon="target", tone="coral",
            tier="rare", earned=has_perfect,
            hint="Score 100% on any quiz.",
        ),
        Badge(
            id="fifty_known", label="Fifty known", icon="seal", tone="mint",
            tier="rare", earned=max_reps >= 50,
            hint="Get fifty cards to a known state.",
        ),
        Badge(
            id="streak_30", label="30-day streak", icon="flame", tone="brand",
            tier="elite", earned=max_streak >= 30,
            hint="Study thirty days in a row.",
        ),
    ]

    return StatsOut(
        streak_days=streak_days,
        max_streak=max_streak,
        study_minutes_this_week=week_seconds // 60,
        cards_due=cards_due,
        quiz_average=quiz_avg,
        docs_indexed=docs_indexed,
        spaces_count=spaces_count,
        heatmap=heatmap,
        badges=badges,
        # Already on `settings_row`, which was fetched for `streak_freeze_enabled`
        # and otherwise thrown away. Without it the streak bars have no reference
        # line, and a bar with nothing to be measured against is decoration.
        daily_goal=int(settings_row.get("daily_goal") or 20),
        composition=composition,
        due_forecast=due_forecast,
    )


# ── Internal helpers ───────────────────────────────────────────────────



async def _cards_due_and_forecast(user_id: str) -> tuple[int, list[ForecastDay]]:
    """How many cards are due now, and how many land on each of the next 7 days.

    One query for both. The previous version asked for `due_at <= now` and
    returned a bare count; widening the filter to `now + 7d` hits the same
    table on the same column and the bucketing happens in Python, so the
    forecast is genuinely free — no extra round trip on the request Home is
    already waiting for.

    Overdue cards are folded into day 0. A card that went due last week is
    work you have *today*, not a separate historical category.
    """
    now = datetime.now(UTC)
    horizon = now + timedelta(days=7)
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "due_at": f"lte.{horizon.isoformat()}"},
        select="due_at",
    )

    today = now.date()
    counts: dict[date, int] = {today + timedelta(days=i): 0 for i in range(7)}
    due_now = 0

    for row in rows:
        raw = row.get("due_at")
        if not raw:
            continue
        try:
            when = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when <= now:
            due_now += 1
            counts[today] += 1
        else:
            bucket = when.date()
            if bucket in counts:
                counts[bucket] += 1

    forecast = [ForecastDay(day=d, count=counts[d]) for d in sorted(counts)]
    return due_now, forecast


async def _quiz_average(user_id: str) -> int | None:
    rows = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}"},
        select="score",
        order="submitted_at.desc",
        limit=5,
    )
    if not rows:
        return None
    return round(sum(int(r["score"]) for r in rows) / len(rows))


async def _cards_mastered(user_id: str) -> int:
    """Cards seen at least once — the honest denominator for "known"."""
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "reps": "gte.1"},
        select="id",
    )
    return len(rows)


async def _has_perfect_quiz(user_id: str) -> bool:
    rows = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}", "score": "eq.100"},
        select="id",
        limit=1,
    )
    return bool(rows)
