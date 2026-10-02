"""Serialise a read-then-write on one thing, inside this process.

Several endpoints read a row, compute from it and write it back: today's
activity counters, a flashcard's schedule. Two of those in flight for the same
row both read the old value, and the second write silently undoes the first.

The API runs as a single worker (render.yaml), so one lock per key in memory is
enough to make them take turns — no migration and no extra round trip. If the
service is ever run with more than one worker, these need to move into SQL
(an atomic `update … set n = n + 1`, or a row lock).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

_locks: dict[str, asyncio.Lock] = {}


@asynccontextmanager
async def keyed(key: str) -> AsyncIterator[None]:
    """Hold the lock for `key`. Locks nobody holds or waits on are dropped, so
    the table does not grow with every user and card ever seen."""
    lock = _locks.setdefault(key, asyncio.Lock())
    try:
        async with lock:
            yield
    finally:
        if not lock.locked() and not getattr(lock, "_waiters", None) and _locks.get(key) is lock:
            _locks.pop(key, None)


class Recent:
    """The last few results, by key, for a short while.

    Lets an endpoint that must not run twice (a card grade moves its schedule)
    answer a re-sent request with the result it already produced. In memory and
    bounded — the same single-worker assumption as the locks above; after a
    restart a retry is simply applied as a new request.
    """

    def __init__(self, *, ttl_s: float = 600.0, max_items: int = 2000) -> None:
        self._ttl = ttl_s
        self._max = max_items
        self._items: dict[str, tuple[float, object]] = {}

    def get(self, key: str) -> object | None:
        hit = self._items.get(key)
        if hit is None:
            return None
        if hit[0] < time.monotonic():
            self._items.pop(key, None)
            return None
        return hit[1]

    def put(self, key: str, value: object) -> None:
        if len(self._items) >= self._max:
            # Oldest first: dicts keep insertion order.
            for stale in list(self._items)[: self._max // 4]:
                self._items.pop(stale, None)
        self._items[key] = (time.monotonic() + self._ttl, value)

