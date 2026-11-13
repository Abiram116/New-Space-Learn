import asyncio

from app.deps import CurrentUser
from app.routers.me import account


def test_export_is_scoped_to_the_caller_and_survives_an_unreadable_table(monkeypatch):
    seen: list[tuple[str, str, str]] = []

    async def fake_select(table, *, select="*", filters=None, order=None, limit=None):
        seen.append((table, select, (filters or {}).get("user_id", "")))
        if table == "card_reviews":
            raise RuntimeError("boom")
        return [{"id": f"{table}-1"}]

    monkeypatch.setattr(account.supabase, "db_select", fake_select)
    user = CurrentUser(id="u-1", email="a@b.c") if "email" in CurrentUser.__dataclass_fields__ else CurrentUser(id="u-1")
    res = asyncio.run(account.export_me(user))

    assert all(uid == "eq.u-1" for _, _, uid in seen), "every table is read as the caller, never unscoped"
    import json

    body = json.loads(res.body)
    assert body["skipped"] == ["card_reviews"]
    assert "notes" in body["tables"] and "card_reviews" not in body["tables"]
    assert "storage_path" not in next(sel for t, sel, _ in seen if t == "documents")
    assert res.headers["content-disposition"].startswith("attachment")
