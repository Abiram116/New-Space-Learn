"""Daily activity tracking (streaks, heatmap, badges).

One row per user per day. Three routers were each carrying their own
read-modify-write copy of this; two of them let a failure bubble up, which
meant a hiccup writing a *stat* could fail the flashcard grade or quiz submit
that the user actually cared about.

Activity tracking is strictly nice-to-have, so every failure here is logged
and swallowed. The caller's real work must never fail because of it.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime

from . import supabase

log = logging.getLogger("space_learn.activity")


async def bump(
    user_id: str,
    *,
    chat_messages: int = 0,
    cards_reviewed: int = 0,
    quizzes_taken: int = 0,
    study_seconds: int = 0,
) -> None:
    """Increment today's counters for `user_id`. Never raises."""

    today = date.today().isoformat()
    try:
        existing = await supabase.db_select(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
            limit=1,
        )
        if existing:
            row = existing[0]
            await supabase.db_update(
                "daily_activity",
                filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
                patch={
                    "chat_messages": int(row.get("chat_messages", 0)) + chat_messages,
                    "cards_reviewed": int(row.get("cards_reviewed", 0)) + cards_reviewed,
                    "quizzes_taken": int(row.get("quizzes_taken", 0)) + quizzes_taken,
                    "study_seconds": int(row.get("study_seconds", 0)) + study_seconds,
                },
            )
        else:
            await supabase.db_insert(
                "daily_activity",
                {
                    "user_id": user_id,
                    "day": today,
                    "chat_messages": chat_messages,
                    "cards_reviewed": cards_reviewed,
                    "quizzes_taken": quizzes_taken,
                    "study_seconds": study_seconds,
                },
            )
    except Exception:  # noqa: BLE001 — telemetry must never break the request
        log.warning("activity bump failed for %s", user_id, exc_info=True)


async def touch_subspace(subspace_id: str) -> None:
    """Refresh `last_activity_at` so "Continue learning" ordering stays honest."""
    try:
        await supabase.db_update(
            "subspaces",
            filters={"id": f"eq.{subspace_id}"},
            patch={"last_activity_at": datetime.now(UTC).isoformat()},
        )
    except Exception:  # noqa: BLE001
        log.warning("subspace touch failed for %s", subspace_id, exc_info=True)
