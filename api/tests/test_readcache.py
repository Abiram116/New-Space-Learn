"""Small per-student copies of read-mostly rows: reused until that student writes."""

from __future__ import annotations

import asyncio

from app.services import answer_cache, readcache, student_model


def test_a_stored_row_is_served_until_the_student_writes():
    cache = readcache.UserCache[list[str]](maxsize=8, ttl=60)
    cache.set("u1", "k", ["a"])
    assert cache.get("u1", "k") == ["a"]
    assert cache.get("u2", "k") is None  # never shared between students
    readcache.note_write("u1")
    assert cache.get("u1", "k") is None


def test_a_row_read_before_a_write_that_landed_meanwhile_is_not_kept():
    cache = readcache.UserCache[list[str]](maxsize=8, ttl=60)
    import time

    began = time.monotonic()
    readcache.note_write("u1")  # a write lands while the read is in flight
    cache.set("u1", "k", ["old"], read_at=began)
    assert cache.get("u1", "k") is None


async def test_chat_may_reuse_a_recent_snapshot_but_pages_do_not_get_a_stale_one(monkeypatch):
    monkeypatch.setattr(student_model, "_SNAPSHOT_TTL_S", 20.0)
    built: list[int] = []

    async def build(user_id: str):
        built.append(1)
        return object()

    monkeypatch.setattr(student_model, "_build_snapshot", build)
    first = await student_model.snapshot("u1")
    # a chat turn finishing clears what pages read, not what the next turn may reuse
    student_model.invalidate_reads("u1")
    assert await student_model.snapshot("u1", max_age=120) is first
    assert len(built) == 1
    assert await student_model.snapshot("u1") is not first  # a page rebuilds
    assert len(built) == 2
    # a real write (quiz, settings, feedback) clears both
    student_model.invalidate("u1")
    await student_model.snapshot("u1", max_age=120)
    assert len(built) == 3
    await asyncio.sleep(0)


def test_the_same_words_hit_the_answer_cache_without_a_vector():
    answer_cache.clear()
    answer_cache.store("u", "s", "What is thrashing?", [1.0, 0.0], "fp", "An answer.", None)
    assert answer_cache.lookup("u", "s", "what is thrashing", None, "fp") is not None
    assert answer_cache.lookup("u", "s", "something else", None, "fp") is None
    assert answer_cache.has_entries("u", "s", "fp")
    assert not answer_cache.has_entries("u", "s", "other-fp")
    assert not answer_cache.has_entries("u", "elsewhere", "fp")
