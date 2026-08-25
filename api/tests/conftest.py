"""Shared test fixtures.

These tests deliberately do **not** touch a real Supabase project. They stub
`services.supabase` at the function boundary, which is the same seam the
routers already depend on. That keeps the suite runnable with no network, no
credentials, and no shared mutable state between developers — the only way a
test suite gets run often enough to catch anything.
"""

from __future__ import annotations

from typing import Any

import pytest


class FakeDb:
    """Records queries and replays canned rows.

    Keyed by table name so a test can say "the `subspaces` table contains this
    row" without caring how the query was assembled.
    """

    def __init__(self) -> None:
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.selects: list[dict[str, Any]] = []
        self.updates: list[dict[str, Any]] = []
        self.inserts: list[dict[str, Any]] = []

    def seed(self, table: str, rows: list[dict[str, Any]]) -> None:
        self.rows[table] = rows

    async def db_rpc(self, fn: str, args: dict):
        """Refuse, loudly.

        The fake models tables, not Postgres functions, so it cannot answer an
        RPC faithfully. Raising sends callers down their documented fallback —
        which is the path these tests are asserting on — and, more importantly,
        stops an unmocked RPC from quietly making a real network call and
        returning the developer's own data instead of the seeded fixture. That
        is what happened when `student_snapshot` shipped: six tests failed
        against live rows.
        """
        raise ConnectionError(f"FakeDb has no RPC {fn!r}")

    async def db_select(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
        select: str = "*",
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        self.selects.append({"table": table, "filters": filters or {}, "select": select})
        rows = self.rows.get(table, [])
        # Apply `eq.` filters, which is all the guards use. Anything richer
        # (in., lte.) would be simulating PostgREST rather than testing our own
        # code, so it's deliberately not supported.
        for key, expr in (filters or {}).items():
            if not expr.startswith("eq."):
                continue
            wanted = expr[3:]
            rows = [r for r in rows if str(r.get(key)) == wanted]
        return rows[:limit] if limit else rows

    async def db_count(self, table: str, *, filters: dict[str, str] | None = None) -> int:
        rows = await self.db_select(table, filters=filters, select="id")
        return len(rows)

    async def db_update(
        self, table: str, *, filters: dict[str, str], patch: dict[str, Any]
    ) -> list[dict[str, Any]]:
        self.updates.append({"table": table, "filters": filters, "patch": patch})
        matched = await self.db_select(table, filters=filters)
        return [{**row, **patch} for row in matched]

    async def db_insert(
        self, table: str, rows: dict[str, Any] | list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        payload = rows if isinstance(rows, list) else [rows]
        self.inserts.append({"table": table, "rows": payload})
        return [{"id": f"generated-{i}", **r} for i, r in enumerate(payload)]


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> FakeDb:
    """Patch the supabase service everywhere it's imported.

    `guards.py` does `from .services import supabase` then `supabase.db_select`,
    so patching the attribute on the module object covers every caller without
    each test needing to know who imported what.
    """
    from app.services import supabase as supabase_module

    fake = FakeDb()
    monkeypatch.setattr(supabase_module, "db_select", fake.db_select)
    monkeypatch.setattr(supabase_module, "db_count", fake.db_count)
    monkeypatch.setattr(supabase_module, "db_rpc", fake.db_rpc)
    monkeypatch.setattr(supabase_module, "db_update", fake.db_update)
    monkeypatch.setattr(supabase_module, "db_insert", fake.db_insert)
    return fake


OWNER = "11111111-1111-1111-1111-111111111111"
INTRUDER = "22222222-2222-2222-2222-222222222222"
