"""Helpers shared by more than one `/me` module.

Only what genuinely has two callers lives here. A shared-helpers module is a
magnet for anything that looks vaguely reusable, and the version of this file
that collects every private function is the original 679-line `me.py` again
with extra import statements.

`_count` has two callers (stats and the brief); `_ensure_settings_row` has
two (the settings endpoints and stats, which needs the daily goal).
Everything else stayed next to its only caller.
"""

from __future__ import annotations

from ...schemas import SettingsOut
from ...services import supabase

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


async def _count(user_id: str, table: str, *, extra: dict[str, str] | None = None) -> int:
    filters = {"user_id": f"eq.{user_id}"}
    if extra:
        filters.update(extra)
    return await supabase.db_count(table, filters=filters)
