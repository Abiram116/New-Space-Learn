"""The admin dashboard's numbers: counted from bounded reads, cached for a minute."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.services import admin_dashboard, supabase

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def _matches(row: dict, key: str, expr: str) -> bool:
    if key == "and":
        return all(_matches(row, *part.split(".", 1)) for part in expr.strip("()").split(","))
    op, _, want = expr.partition(".")
    have = row.get(key)
    if op == "eq":
        return str(have) == want
    if op == "gte":
        return have is not None and str(have) >= want
    if op == "lt":
        return have is not None and str(have) < want
    return True


@pytest.fixture
def world(monkeypatch):
    tables: dict[str, list[dict]] = {}
    calls = {"n": 0}

    def rows(table, filters):
        calls["n"] += 1
        return [r for r in tables.get(table, []) if all(_matches(r, k, v) for k, v in (filters or {}).items())]

    async def db_count(table, *, filters=None):
        return len(rows(table, filters))

    async def db_select(table, *, filters=None, select="*", order=None, limit=None):
        out = rows(table, filters)
        return out[:limit] if limit else out

    monkeypatch.setattr(supabase, "db_count", db_count)
    monkeypatch.setattr(supabase, "db_select", db_select)
    admin_dashboard.reset()
    tables["_calls"] = calls  # type: ignore[assignment]
    return tables


def _seed(t):
    t["user_settings"] = [
        {"user_id": "a", "created_at": "2026-10-09T10:00:00Z"},
        {"user_id": "b", "created_at": "2026-10-01T10:00:00Z"},
        {"user_id": "c", "created_at": "2026-08-01T10:00:00Z"},
        {"user_id": "d", "created_at": "2026-08-02T10:00:00Z"},
    ]
    t["daily_activity"] = [
        {"user_id": "a", "day": "2026-10-10", "chat_messages": 3},
        {"user_id": "b", "day": "2026-10-10", "chat_messages": 0},
        {"user_id": "b", "day": "2026-10-04", "chat_messages": 1},
        {"user_id": "c", "day": "2026-09-20", "chat_messages": 0},
    ]
    t["chat_messages"] = [
        {"role": "user", "created_at": "2026-10-09T09:00:00Z"},
        {"role": "assistant", "created_at": "2026-10-09T09:00:01Z"},
        {"role": "user", "created_at": "2026-10-01T09:00:00Z"},
    ]
    t["documents"] = [
        {"user_id": "a", "status": "ready", "created_at": "2026-10-09T09:00:00Z"},
        {"user_id": "a", "status": "failed", "created_at": "2026-10-09T09:00:00Z"},
    ]
    t["quiz_results"] = [{"user_id": "b", "submitted_at": "2026-10-05T09:00:00Z"}]
    t["flashcards"] = [{"user_id": "a"}, {"user_id": "a"}]
    t["card_reviews"] = [{"reviewed_at": "2026-10-08T09:00:00Z"}]


async def test_users_usage_and_funnel(world):
    _seed(world)
    d = await admin_dashboard.build(NOW)
    users = d["users"]
    assert (users["total"], users["new_7d"], users["new_30d"]) == (4, 1, 2)
    assert (users["active_1d"], users["active_7d"], users["active_30d"]) == (2, 2, 3)
    assert len(users["daily"]) == 30 and users["daily"][-1] == {"date": "2026-10-10", "count": 2}
    # Only the person's own messages count, and the week before is its own window.
    assert d["usage"]["messages"] == {"total": 2, "this_week": 1, "last_week": 1}
    assert d["usage"]["files"]["total"] == 1  # the failed upload is not a file
    assert d["usage"]["cards"] == {"total": 2, "this_week": None, "last_week": None}
    steps = {s["label"]: s for s in d["funnel"]["steps"]}
    assert steps["Signed up"]["percent"] == 100
    assert steps["Uploaded a file"]["count"] == 1
    assert steps["Asked a question"]["count"] == 2  # a and b
    assert steps["Made cards or a quiz"]["count"] == 2  # a (cards), b (quiz)
    assert steps["Came back another day"] == {"label": "Came back another day", "count": 1, "percent": 25}
    assert d["funnel"]["approximate"] is False


async def test_an_empty_database_is_all_zeros(world):
    d = await admin_dashboard.build(NOW)
    assert d["users"]["total"] == 0 and d["funnel"]["steps"][0]["percent"] == 0
    assert all(s["count"] == 0 for s in d["funnel"]["steps"])


async def test_the_result_is_kept_for_a_minute(world):
    _seed(world)
    first = await admin_dashboard.dashboard()
    used = world["_calls"]["n"]
    assert await admin_dashboard.dashboard() is first
    assert world["_calls"]["n"] == used


async def test_a_capped_read_is_labelled_approximate(world, monkeypatch):
    _seed(world)
    monkeypatch.setattr(admin_dashboard, "_ROW_CAP", 2)
    assert (await admin_dashboard.build(NOW))["funnel"]["approximate"] is True


def test_the_dashboard_endpoint_never_carries_an_email(world, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import create_app
    from app.services import admin_gate

    monkeypatch.setattr(settings, "admin_password_hash", admin_gate.hash_password("correct horse battery"))
    _seed(world)
    c = TestClient(create_app())
    token = c.post("/api/v1/admin/unlock", json={"password": "correct horse battery"}).json()["token"]
    r = c.get("/api/v1/admin/dashboard", headers={"X-Admin-Token": token})
    assert r.status_code == 200 and "@" not in r.text
