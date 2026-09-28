"""Streak math — shared by /me/stats and the Student Model's computed
signals so both report the same number from one implementation."""

from __future__ import annotations

from datetime import date, timedelta


def to_date(v: str | date) -> date:
    return v if isinstance(v, date) else date.fromisoformat(v)


#: How often a freeze can bridge a gap. Unlimited bridging would make
#: "streak" mean "signed up a while ago", not "shows up regularly" — a
#: student who studies one day a week would keep an ever-growing streak
#: forever. One bridge per week keeps the freeze what it's sold as: forgiveness
#: for the occasional missed day, not a second currency for buying a longer
#: number.
_BRIDGE_COOLDOWN_DAYS = 7


def compute_streak(day_strings: list[str], today: date, *, freeze: bool) -> int:
    """Consecutive days of activity ending today, walking backward.

    Without freeze, a single missed day ends the streak right there — the
    original, strict definition. With freeze on, one missed day surrounded by
    active days ("bridged") doesn't end it: the walk steps over that day and
    keeps counting the active days on the far side. Two missed days in a row
    still end it even with freeze on — a freeze forgives a slip, not an
    absence. And a freeze can only bridge once every `_BRIDGE_COOLDOWN_DAYS`
    days, so it smooths out the occasional miss without letting a
    once-a-week habit read as an unbroken streak.

    The missed day itself is never counted toward the streak length — only
    real active days are. `today` not yet having an activity row is just the
    first day the walk can encounter, handled the same as any other: with
    freeze on and yesterday active, it's bridged like any midstream gap.
    """
    if not day_strings:
        return 0
    days_set = {to_date(d) for d in day_strings}

    cursor = today
    streak = 0
    bridged: list[date] = []
    while True:
        if cursor in days_set:
            streak += 1
            cursor -= timedelta(days=1)
            continue
        # `cursor` is a missed day.
        if not freeze:
            break
        prior = cursor - timedelta(days=1)
        if prior not in days_set:
            break  # two misses in a row — freeze doesn't cover that
        if any((b - cursor).days < _BRIDGE_COOLDOWN_DAYS for b in bridged):
            break  # already bridged a gap within the last 7 days
        bridged.append(cursor)
        cursor = prior
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
