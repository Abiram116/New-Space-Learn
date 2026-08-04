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
from dataclasses import dataclass, field

from ..errors import RateLimited

# Refill rate and burst size. Chat costs 1, quiz generation costs 2.
# ~20 calls/min sustained is far above real study use and far below Groq's cap.
CAPACITY = 20.0
REFILL_PER_SECOND = 20.0 / 60.0

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


async def consume_llm_quota(user_id: str, *, cost: float = 1.0) -> None:
    """Take `cost` tokens from the user's bucket, or raise RateLimited."""

    now = time.monotonic()
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

    bucket.tokens -= cost


def reset() -> None:
    """Test hook — clears all buckets."""
    _buckets.clear()
