"""Student Model: explicit preferences + signals computed from real stored
data (quiz averages, streak) — the shared personalization context every
chat/agent/brief prompt draws from. Same discipline as `/me/brief`: nothing
here is model-generated, so nothing here can drift from what's actually
stored.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

from ..schemas import StudentModelOut, TopicSignal
from . import supabase
from .streaks import compute_streak


async def get(user_id: str) -> StudentModelOut:
    # Every chat turn and every generation call waits on this before the LLM
    # even starts, so the three reads run concurrently rather than stacking
    # three round trips onto the critical path.
    settings_row, signals, days = await asyncio.gather(
        _settings_row(user_id),
        _quiz_signals(user_id),
        _activity_days(user_id),
    )
    explicit = dict(settings_row.get("student_model") or {})
    weak = sorted(signals, key=lambda s: s.average)[:3]
    strong = sorted(signals, key=lambda s: -s.average)[:3]
    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = compute_streak([r["day"] for r in days], date.today(), freeze=freeze)

    return StudentModelOut(
        learning_style=explicit.get("learning_style"),
        session_length_minutes=explicit.get("session_length_minutes"),
        exam_context=explicit.get("exam_context"),
        teaching_preference=explicit.get("teaching_preference"),
        weak_areas=weak,
        strong_areas=strong,
        streak_days=streak_days,
    )


async def set_explicit(user_id: str, patch: dict) -> StudentModelOut:
    settings_row = await _settings_row(user_id)
    existing = dict(settings_row.get("student_model") or {})
    existing.update(patch)
    await supabase.db_update(
        "user_settings",
        filters={"user_id": f"eq.{user_id}"},
        patch={"student_model": existing, "updated_at": datetime.now(UTC).isoformat()},
    )
    return await get(user_id)


def format_for_prompt(sm: StudentModelOut) -> str:
    """A short block to prepend to a system prompt. Empty string if there's
    nothing real to say yet — never pads with generic filler."""

    lines: list[str] = []
    if sm.teaching_preference:
        lines.append(f"- Prefers explanations like this: {sm.teaching_preference}")
    if sm.learning_style:
        lines.append(f"- Learning style: {sm.learning_style}")
    if sm.session_length_minutes:
        lines.append(f"- Typical session length: {sm.session_length_minutes} minutes")
    if sm.exam_context:
        lines.append(f"- Studying for: {sm.exam_context}")
    if sm.weak_areas:
        lines.append(
            "- Weaker areas (lower quiz averages): "
            + ", ".join(a.topic for a in sm.weak_areas)
        )
    if sm.strong_areas:
        lines.append(
            "- Stronger areas (higher quiz averages): "
            + ", ".join(a.topic for a in sm.strong_areas)
        )
    if not lines:
        return ""
    return "What you know about this student:\n" + "\n".join(lines)


async def _settings_row(user_id: str) -> dict:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    return rows[0] if rows else {}


async def _quiz_signals(user_id: str) -> list[TopicSignal]:
    results = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}"},
        select="score,quizzes(subspace_id,topic)",
        order="submitted_at.desc",
        limit=50,
    )
    groups: dict[str, dict] = {}
    for r in results:
        q = r.get("quizzes") or {}
        subspace_id = q.get("subspace_id")
        if not subspace_id:
            continue
        g = groups.setdefault(subspace_id, {"scores": [], "topic": q.get("topic")})
        g["scores"].append(int(r["score"]))
    return [
        TopicSignal(
            subspace_id=sid,
            topic=g["topic"] or "Untitled",
            average=round(sum(g["scores"]) / len(g["scores"])),
        )
        for sid, g in groups.items()
        if len(g["scores"]) >= 2
    ]


async def _activity_days(user_id: str) -> list[dict]:
    return await supabase.db_select(
        "daily_activity",
        filters={"user_id": f"eq.{user_id}"},
        select="day",
        order="day.desc",
        limit=200,
    )
