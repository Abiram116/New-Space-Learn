"""Short-lived per-student copies of small, read-mostly rows.

Chat reads the same few rows on every turn (which skills are on for a topic,
which topics are linked) and they change only when the student toggles a skill
or links a topic, which are writes through this API. Each read is a round trip
to a database in another country, so a turn pays for them again and again for
answers that did not change.

The rule that keeps this honest is the same one `student_model` follows: any
request that is not a read first calls `note_write(user_id)` (see
`deps.get_current_user`), and an entry stored before that moment is never
served. The TTL only bounds how long a row changed some other way (an admin
editing a library skill) can be missed. In memory, bounded, per process.
"""

from __future__ import annotations

import time
from typing import Generic, TypeVar

from .memo import TTLCache

V = TypeVar("V")

#: When each student last wrote anything. An entry older than this is stale.
_written_at: dict[str, float] = {}
_MAX_USERS = 5000
#: Longer than any TTL used with `UserCache`, so a mark this old cannot matter.
_FORGET_AFTER_S = 3600.0


def note_write(user_id: str) -> None:
    """This student is about to change something: nothing stored so far is current."""
    now = time.monotonic()
    if len(_written_at) >= _MAX_USERS and user_id not in _written_at:
        for key in [k for k, t in _written_at.items() if now - t > _FORGET_AFTER_S]:
            del _written_at[key]
        if len(_written_at) >= _MAX_USERS:
            _written_at.clear()
            _all_caches_clear()
    _written_at[user_id] = now


_caches: list[UserCache] = []


def _all_caches_clear() -> None:
    for cache in _caches:
        cache.clear()


class UserCache(Generic[V]):
    def __init__(self, *, maxsize: int, ttl: float) -> None:
        self._cache: TTLCache[tuple[float, V]] = TTLCache(maxsize=maxsize, ttl=ttl)
        _caches.append(self)

    @staticmethod
    def _key(user_id: str, key: str) -> str:
        return f"{user_id}:{key}"

    def get(self, user_id: str, key: str) -> V | None:
        hit = self._cache.get(self._key(user_id, key))
        if hit is None:
            return None
        stored_at, value = hit
        if stored_at <= _written_at.get(user_id, 0.0):
            return None
        return value

    def set(self, user_id: str, key: str, value: V, *, read_at: float | None = None) -> None:
        """`read_at`: when the read that produced `value` began. A write that landed
        while it was in flight may not be in it, so it is not kept."""
        stamp = time.monotonic() if read_at is None else read_at
        if stamp <= _written_at.get(user_id, 0.0):
            return
        self._cache.set(self._key(user_id, key), (stamp, value))

    def clear(self) -> None:
        self._cache.clear()


def reset() -> None:
    """Test hook."""
    _written_at.clear()
    _all_caches_clear()
