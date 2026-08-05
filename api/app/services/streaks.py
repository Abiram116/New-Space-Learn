"""Streak math — shared by /me/stats and the Student Model's computed
signals so both report the same number from one implementation."""

from __future__ import annotations

from datetime import date, timedelta


def to_date(v: str | date) -> date:
    return v if isinstance(v, date) else date.fromisoformat(v)


def compute_streak(day_strings: list[str], today: date, *, freeze: bool) -> int:
    if not day_strings:
        return 0
    days_set = {to_date(d) for d in day_strings}
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


def compute_max_streak(day_strings: list[str]) -> int:
    if not day_strings:
        return 0
    days = sorted({to_date(d) for d in day_strings})
    longest = current = 1
    for i in range(1, len(days)):
        if (days[i] - days[i - 1]).days == 1:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest
