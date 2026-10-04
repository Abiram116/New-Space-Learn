"""A small in-process cache with an expiry, for results that are pure functions of their input.

Used for two things that repeat when a student regenerates an answer or retries
a message: the rewrite of a follow-up question into a standalone one (a model
call) and the embedding of a question (CPU on a very small machine). Both give
the same result for the same input, so the second time is free.

What it is not: shared between workers, kept across a restart, or a place for
anything about a person. Keys are the full input text hashed, values are the
result of that exact input, entries expire after minutes and the whole thing is
bounded, so it can only ever return what the same call would have returned.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Generic, TypeVar

V = TypeVar("V")


class TTLCache(Generic[V]):
    def __init__(self, *, maxsize: int, ttl: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._data: OrderedDict[str, tuple[float, V]] = OrderedDict()
        self._maxsize = maxsize
        self._ttl = ttl
        self._clock = clock

    def get(self, key: str) -> V | None:
        hit = self._data.get(key)
        if hit is None:
            return None
        stamp, value = hit
        if self._clock() - stamp > self._ttl:
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: V) -> None:
        self._data[key] = (self._clock(), value)
        self._data.move_to_end(key)
        while len(self._data) > self._maxsize:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)
