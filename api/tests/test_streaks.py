"""`compute_streak` — the freeze bridges a single missed day, not more.

Before this, `streak_freeze_enabled` only covered *today* not being logged
yet ("give it until the day is over"); a real missed day anywhere else in the
run broke the streak even with the setting on, which is not what "streak
freeze" promises. See `services/streaks.py` for the exact rule: one missed
day surrounded by active days is bridged, two in a row still break it, and a
freeze can only bridge once every 7 days.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.services.streaks import compute_streak

TODAY = date(2026, 9, 28)


def _days_ago(*offsets: int) -> list[str]:
    return [(TODAY - timedelta(days=n)).isoformat() for n in offsets]


def test_plain_contiguous_streak_unaffected_by_freeze():
    days = _days_ago(0, 1, 2, 3)
    assert compute_streak(days, TODAY, freeze=False) == 4
    assert compute_streak(days, TODAY, freeze=True) == 4


def test_no_activity_at_all_is_zero():
    assert compute_streak([], TODAY, freeze=True) == 0


def test_without_freeze_a_single_missed_day_breaks_it():
    # Active today and the day before, missed two days ago, active further back.
    days = _days_ago(0, 1, 3, 4)
    assert compute_streak(days, TODAY, freeze=False) == 2


def test_with_freeze_a_single_missed_day_is_bridged():
    # Same shape as above, but freeze bridges the day-2 gap, so the run on
    # the far side of it still counts.
    days = _days_ago(0, 1, 3, 4)
    assert compute_streak(days, TODAY, freeze=True) == 4


def test_with_freeze_two_consecutive_missed_days_still_break_it():
    # Missed both day 2 and day 3 — a freeze forgives a slip, not an absence.
    days = _days_ago(0, 1, 4, 5)
    assert compute_streak(days, TODAY, freeze=True) == 2


def test_freeze_only_bridges_once_per_rolling_week():
    # Active today and yesterday, missed day 2 (bridged), active day 3,
    # missed day 4 — only 2 days after the first bridge, so this second gap
    # is NOT bridged even though it's a single missed day.
    days = _days_ago(0, 1, 3, 5, 6)
    assert compute_streak(days, TODAY, freeze=True) == 3


def test_freeze_bridges_again_once_the_cooldown_has_passed():
    # First bridge at day 2. The next gap, at day 10, is 8 days later — past
    # the 7-day cooldown — so it can be bridged too.
    days = _days_ago(0, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12)
    assert compute_streak(days, TODAY, freeze=True) == 11


def test_today_not_yet_logged_is_just_another_gap():
    # Nothing logged today, but yesterday and before are active. Without
    # freeze this is a plain break (streak requires today); with freeze it's
    # bridged like any other single missed day.
    days = _days_ago(1, 2, 3)
    assert compute_streak(days, TODAY, freeze=False) == 0
    assert compute_streak(days, TODAY, freeze=True) == 3
