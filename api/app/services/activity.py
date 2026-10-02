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
from datetime import UTC, datetime

from . import clock, locks, supabase

log = logging.getLogger("space_learn.activity")


# ── Study-time model ───────────────────────────────────────────────────
#
# We do not measure wall-clock time. There is no session timer, no focus
# tracking, and adding one would mean deciding what counts as "studying"
# while a tab sits open in the background — a worse kind of wrong.
#
# Instead each completed action credits a fixed, deliberately conservative
# estimate of the time it takes to do properly. These lived as bare numbers
# in three different routers, which made the model impossible to reason
# about or change coherently; they belong in one place with their reasoning.
#
# Because it is an estimate, the UI must never present it as a measurement:
# it is rendered with a "~" and labelled as approximate. Changing a number
# here changes history's meaning, so treat it as a data-model decision, not
# a tuning knob.

#: Reading an answer and forming a follow-up. The dominant cost is reading.
SECONDS_PER_CHAT_MESSAGE = 60
#: Recall, self-grade, move on. Short by design — cards are meant to be fast.
SECONDS_PER_CARD_REVIEW = 20
#: A multi-question quiz plus reviewing what came back wrong. Only the
#: fallback when the client didn't report a real duration — see `quiz_seconds`.
SECONDS_PER_QUIZ = 180
#: Bounds on a *measured* duration. Below this it's almost certainly a client
#: clock glitch, not a real attempt; above it, a tab left open overnight
#: shouldn't inflate a week's study-time total.
_MIN_MEASURED_QUIZ_SECONDS = 30
_MAX_MEASURED_QUIZ_SECONDS = 3600


def quiz_seconds(measured: int | None) -> int:
    """How long a submitted quiz counts for, in study time.

    `duration_seconds` is timed client-side and sent with the submission —
    use it when it's there, clamped to a sane range, rather than the flat
    estimate every quiz used to be credited regardless of how long it
    actually took.
    """
    if measured is None:
        return SECONDS_PER_QUIZ
    return max(_MIN_MEASURED_QUIZ_SECONDS, min(_MAX_MEASURED_QUIZ_SECONDS, measured))


async def bump(
    user_id: str,
    *,
    chat_messages: int = 0,
    cards_reviewed: int = 0,
    quizzes_taken: int = 0,
    study_seconds: int = 0,
) -> None:
    """Increment today's counters for `user_id`. Never raises."""

    # The student's own day (see `clock`), read before waiting on the lock so a
    # bump that queues across midnight still counts for the day it happened.
    today = clock.today().isoformat()
    try:
        # One at a time per user: grading cards quickly fires several of these
        # at once, they all read the same count, and each wrote back "that + 1"
        # — five cards could record as two. See `locks`.
        async with locks.keyed(f"activity:{user_id}"):
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
