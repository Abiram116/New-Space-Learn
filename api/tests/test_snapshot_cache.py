"""The student model's short-lived cache: reused when nothing changed, never
after the student does something."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import create_app
from app.services import student_model, supabase

from .conftest import OWNER


@pytest.fixture
def builds(monkeypatch):
    """Count real builds, with the cache switched on."""
    monkeypatch.setattr(student_model, "_SNAPSHOT_TTL_S", 20.0)
    calls: list[str] = []

    async def build(user_id: str):
        calls.append(user_id)
        await asyncio.sleep(0)
        return object()  # stands in for a Snapshot

    monkeypatch.setattr(student_model, "_build_snapshot", build)
    return calls


async def test_a_second_read_reuses_the_first(builds):
    first = await student_model.snapshot("u1")
    assert await student_model.snapshot("u1") is first
    assert builds == ["u1"]


async def test_readers_arriving_together_share_one_build(builds):
    a, b, c = await asyncio.gather(*(student_model.snapshot("u1") for _ in range(3)))
    assert a is b is c
    assert builds == ["u1"]


async def test_users_never_share(builds):
    assert await student_model.snapshot("u1") is not await student_model.snapshot("u2")
    assert builds == ["u1", "u2"]


async def test_invalidate_forces_a_fresh_build(builds):
    first = await student_model.snapshot("u1")
    student_model.invalidate("u1")
    assert await student_model.snapshot("u1") is not first
    assert builds == ["u1", "u1"]


async def test_a_build_overtaken_by_a_write_is_not_kept(builds):
    """Invalidated while it was still reading: it may have seen the old rows."""
    pending = asyncio.ensure_future(student_model.snapshot("u1"))
    await asyncio.sleep(0)
    student_model.invalidate("u1")
    await pending
    await student_model.snapshot("u1")
    assert builds == ["u1", "u1"]


async def test_it_expires(builds, monkeypatch):
    monkeypatch.setattr(student_model, "_SNAPSHOT_TTL_S", -1.0)
    await student_model.snapshot("u1")
    await student_model.snapshot("u1")
    assert builds == ["u1", "u1"]


def test_any_write_through_the_api_clears_that_users_snapshot(monkeypatch):
    """The rule lives in `get_current_user`, so every write endpoint — including
    ones written later — is covered without remembering to call anything."""
    cleared: list[str] = []
    monkeypatch.setattr(student_model, "invalidate", cleared.append)

    async def verify(_token):
        return {"sub": OWNER, "email": "o@x.test"}

    async def nothing(*_a, **_k):
        return []

    monkeypatch.setattr(supabase, "verify_access_token", verify)
    monkeypatch.setattr(supabase, "db_select", nothing)
    client = TestClient(create_app())
    auth = {"Authorization": "Bearer t"}

    client.get("/api/v1/me/admin", headers=auth)
    assert cleared == []  # a read keeps it
    client.delete("/api/v1/notes/00000000-0000-0000-0000-000000000000", headers=auth)
    assert cleared == [OWNER]  # a write clears it, whatever it then does
    assert get_current_user is not None
