"""Per-user token bucket for LLM-backed endpoints.

Why in-process and not Redis: Render's free tier runs a single uvicorn worker,
so process memory *is* the whole cluster. A dict of buckets costs nothing and
needs no extra service. If this ever scales past one worker, swap the storage
here — callers don't change.

What it protects: the Groq quota. Without it, one stuck retry loop or an
open tab hammering chat can burn the daily token budget for every user.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

from ..config import settings
from ..errors import RateLimited

# Refill rate and burst size. Chat costs 1, quiz generation costs 2.
#
# These used to be 20 a minute, described as "far below Groq's cap". It is not: on
# the free tier the whole app gets about 3 answers a minute, so one student at 20 a
# minute could use everyone's allowance. Now a burst of a few and a refill near what
# the key can actually serve (values in `config`). Real study use is a question every
# half minute or so, which this allows.
CAPACITY = settings.llm_burst
REFILL_PER_SECOND = settings.llm_refill_per_minute / 60.0

# A rolling day, in wall-clock seconds, on top of the per-minute bucket. Only calls
# that spend the TEXT models' allowance count (`daily=True`): chat, quizzes, decks,
# notes. Reading a scanned page uses the vision model's own allowance and a plain
# upload uses none, so neither should use up a student's answers.
DAILY_WINDOW_S = 24 * 3600.0
_daily: dict[str, deque[tuple[float, float]]] = {}

# Drop buckets untouched for this long so memory can't grow unbounded.
_IDLE_TTL_S = 900.0
_SWEEP_EVERY_S = 300.0


@dataclass(slots=True)
class _Bucket:
    tokens: float = CAPACITY
    updated: float = field(default_factory=time.monotonic)


_buckets: dict[str, _Bucket] = {}
_last_sweep = time.monotonic()


def _sweep(now: float) -> None:
    global _last_sweep
    if now - _last_sweep < _SWEEP_EVERY_S:
        return
    _last_sweep = now
    stale = [k for k, b in _buckets.items() if now - b.updated > _IDLE_TTL_S]
    for k in stale:
        del _buckets[k]
    cutoff = time.time() - DAILY_WINDOW_S
    for k in [k for k, e in _daily.items() if not e or e[-1][0] < cutoff]:
        del _daily[k]


def _daily_wait_s(entries: deque[tuple[float, float]], now: float, cost: float, limit: float) -> float | None:
    """None if `cost` fits in today's budget; otherwise seconds until enough has expired."""
    while entries and now - entries[0][0] >= DAILY_WINDOW_S:
        entries.popleft()
    used = sum(c for _, c in entries)
    if used + cost <= limit:
        return None
    freed = 0.0
    for ts, c in entries:
        freed += c
        if used - freed + cost <= limit:
            return max(1.0, ts + DAILY_WINDOW_S - now)
    return DAILY_WINDOW_S


async def consume_llm_quota(user_id: str, *, cost: float = 1.0, daily: bool = False) -> None:
    """Take `cost` from the student's per-minute bucket (and, with `daily`, from their
    rolling-day allowance), or raise RateLimited. Nothing is taken unless both pass."""

    now = time.monotonic()
    wall = time.time()
    _sweep(now)

    bucket = _buckets.get(user_id)
    if bucket is None:
        bucket = _Bucket()
        _buckets[user_id] = bucket

    elapsed = now - bucket.updated
    bucket.tokens = min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND)
    bucket.updated = now

    if bucket.tokens < cost:
        wait_s = int((cost - bucket.tokens) / REFILL_PER_SECOND) + 1
        raise RateLimited(
            f"You're sending requests faster than we can answer. "
            f"Try again in about {wait_s} second{'s' if wait_s != 1 else ''}."
        )

    if daily:
        entries = _daily.setdefault(user_id, deque())
        limit = settings.llm_daily_quota
        wait = _daily_wait_s(entries, wall, cost, limit)
        if wait is not None:
            mins = max(1, round(wait / 60))
            when = f"{mins} minute{'s' if mins != 1 else ''}" if mins < 120 else f"about {round(mins / 60)} hours"
            raise RateLimited(
                f"You've used today's {int(limit)} free answers. The next one frees up in {when}, "
                "and the rest follow over the next day."
            )
        entries.append((wall, cost))

    bucket.tokens -= cost


def refund(user_id: str, cost: float = 1.0) -> None:
    """Give back a charge for a call that produced no answer (it failed, or it was served
    from the cache): the per-minute tokens and the newest matching entry of the day."""
    bucket = _buckets.get(user_id)
    if bucket is not None:
        bucket.tokens = min(CAPACITY, bucket.tokens + cost)
    entries = _daily.get(user_id)
    if entries:
        for i in range(len(entries) - 1, -1, -1):
            if entries[i][1] == cost:
                del entries[i]
                break


# ── A plain "N per window" limit ───────────────────────────────────────
#
# For things that are not model calls and should simply be rare: sending the
# feedback form. Fixed windows, in memory, same single-worker footing as the
# buckets above.
_windows: dict[str, tuple[float, int]] = {}
#: Past this many live windows, a key we have not seen is refused outright.
#: The keys include a client-supplied address (`X-Forwarded-For` can be forged),
#: so without a hard ceiling someone rotating it could add an entry per request
#: for as long as the window lasts — unbounded memory on a 512 MB worker.
_MAX_WINDOWS = 10_000


def consume_window(key: str, *, limit: int, window_s: float, message: str) -> None:
    """Count one use of `key`; raise RateLimited past `limit` per `window_s`."""
    now = time.monotonic()
    if len(_windows) > 5000:  # bounded: drop windows that have already ended
        for stale in [k for k, (start, _) in _windows.items() if now - start > window_s]:
            del _windows[stale]
    if key not in _windows and len(_windows) >= _MAX_WINDOWS:
        raise RateLimited(message)
    start, used = _windows.get(key, (now, 0))
    if now - start > window_s:
        start, used = now, 0
    if used >= limit:
        raise RateLimited(message)
    _windows[key] = (start, used + 1)


def reset() -> None:
    """Test hook — clears all buckets."""
    _buckets.clear()
    _daily.clear()
    _windows.clear()
