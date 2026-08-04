"""Current-user endpoints: identity, stats, settings."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import (
    Badge,
    HeatmapCell,
    Me,
    SettingsOut,
    SettingsUpdate,
    StatsOut,
)
from ..services import supabase

router = APIRouter()


@router.get("/me", response_model=Me)
async def me(user: CurrentUser = Depends(get_current_user)) -> Me:
    return Me(id=user.id, email=user.email)


# ── Settings ───────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = SettingsOut(
    daily_goal=20,
    reminder_time=None,
    streak_freeze_enabled=True,
    spaced_pace="balanced",
    answer_only_from_docs=True,
    always_show_citations=True,
)


async def _ensure_settings_row(user_id: str) -> dict:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    if rows:
        return rows[0]
    inserted = await supabase.db_insert(
        "user_settings",
        {**_DEFAULT_SETTINGS.model_dump(mode="json"), "user_id": user_id},
    )
    return inserted[0]


@router.get("/me/settings", response_model=SettingsOut)
async def get_settings(user: CurrentUser = Depends(get_current_user)) -> SettingsOut:
    row = await _ensure_settings_row(user.id)
    return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})


@router.patch("/me/settings", response_model=SettingsOut)
async def patch_settings(
    body: SettingsUpdate, user: CurrentUser = Depends(get_current_user)
) -> SettingsOut:
    await _ensure_settings_row(user.id)
    patch = body.model_dump(exclude_unset=True, mode="json")
    if not patch:
        row = await _ensure_settings_row(user.id)
        return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})
    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = await supabase.db_update(
        "user_settings", filters={"user_id": f"eq.{user.id}"}, patch=patch
    )
    if not updated:
        raise NotFound("Settings row missing.")
    return SettingsOut(**{k: updated[0].get(k) for k in SettingsOut.model_fields})


# ── Stats ──────────────────────────────────────────────────────────────


@router.get("/me/stats", response_model=StatsOut)
async def stats(user: CurrentUser = Depends(get_current_user)) -> StatsOut:
    settings_row = await _ensure_settings_row(user.id)

    # 8 weeks of activity → 56 cells (or 8 rows of 14 for the profile grid).
    today = date.today()
    since = today - timedelta(days=55)
    days = await supabase.db_select(
        "daily_activity",
        filters={
            "user_id": f"eq.{user.id}",
            "day": f"gte.{since.isoformat()}",
        },
        order="day.asc",
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
        heatmap.append(HeatmapCell(day=d, intensity=intensity))
        d += timedelta(days=1)

    # Streak: consecutive days ending today (or yesterday if streak-freeze on).
    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = _compute_streak([r["day"] for r in days], today, freeze=freeze)
    max_streak = _compute_max_streak([r["day"] for r in days])

    week_start = today - timedelta(days=6)
    week_seconds = sum(
        int(r.get("study_seconds", 0))
        for r in days
        if _to_date(r["day"]) >= week_start
    )

    # Aggregates from other tables.
    cards_due = await _count_cards_due(user.id)
    quiz_avg = await _quiz_average(user.id)
    docs_indexed = await _count(user.id, "documents", extra={"status": "eq.ready"})
    spaces_count = await _count(user.id, "subjects")

    badges = [
        Badge(
            id="streak_10", label="10-day streak", icon="🔥", tone="sun",
            earned=max_streak >= 10,
        ),
        Badge(
            id="streak_30", label="30-day streak", icon="🔒", tone="brand",
            earned=max_streak >= 30,
        ),
        Badge(
            id="perfect_quiz", label="Perfect quiz", icon="🎯", tone="mint",
            earned=await _has_perfect_quiz(user.id),
        ),
        Badge(
            id="ten_docs", label="10 docs", icon="📄", tone="sky",
            earned=docs_indexed >= 10,
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
    )


# ── Internal helpers ───────────────────────────────────────────────────


def _to_date(v: str | date) -> date:
    return v if isinstance(v, date) else date.fromisoformat(v)


def _compute_streak(day_strings: list[str], today: date, *, freeze: bool) -> int:
    if not day_strings:
        return 0
    days_set = {_to_date(d) for d in day_strings}
    cursor = today
    if cursor not in days_set:
        # Allow one grace day when streak freeze is on.
        if freeze and (cursor - timedelta(days=1)) in days_set:
            cursor = cursor - timedelta(days=1)
        else:
            return 0
    streak = 0
    while cursor in days_set:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def _compute_max_streak(day_strings: list[str]) -> int:
    if not day_strings:
        return 0
    days = sorted({_to_date(d) for d in day_strings})
    longest = current = 1
    for i in range(1, len(days)):
        if (days[i] - days[i - 1]).days == 1:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest


async def _count_cards_due(user_id: str) -> int:
    now = datetime.now(UTC).isoformat()
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "due_at": f"lte.{now}"},
        select="id",
    )
    return len(rows)


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


async def _has_perfect_quiz(user_id: str) -> bool:
    rows = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}", "score": "eq.100"},
        select="id",
        limit=1,
    )
    return bool(rows)


async def _count(user_id: str, table: str, *, extra: dict[str, str] | None = None) -> int:
    filters = {"user_id": f"eq.{user_id}"}
    if extra:
        filters.update(extra)
    rows = await supabase.db_select(table, filters=filters, select="id")
    return len(rows)
