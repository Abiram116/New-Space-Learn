"""Deleting a topic / subject / account removes the uploaded files too."""

from __future__ import annotations

import pytest

from app.services import ingest, purge, supabase


@pytest.fixture
def calls(monkeypatch):
    log: dict = {"selects": [], "deleted": [], "cancelled": []}
    rows: list[dict] = []

    async def db_select(table, *, filters=None, select="*", **_):
        log["selects"].append((table, filters))
        return rows

    async def delete_many(paths):
        log["deleted"].append(list(paths))

    async def cancel(doc_id):
        log["cancelled"].append(doc_id)

    monkeypatch.setattr(supabase, "db_select", db_select)
    monkeypatch.setattr(supabase, "storage_delete_many", delete_many)
    monkeypatch.setattr(ingest, "cancel", cancel)
    log["rows"] = rows
    return log


async def test_deletes_files_and_cancels_jobs(calls):
    calls["rows"].extend(
        [
            {"id": "d1", "storage_path": "u/d1/a.pdf"},
            {"id": "d2", "storage_path": None},
            {"id": "d3", "storage_path": "u/d3/b.txt"},
        ]
    )
    await purge.purge_documents("u", subspace_ids=["s1", "s2"])
    assert calls["deleted"] == [["u/d1/a.pdf", "u/d3/b.txt"]]
    assert calls["cancelled"] == ["d1", "d2", "d3"]
    table, filters = calls["selects"][0]
    assert table == "documents"
    assert filters == {"user_id": "eq.u", "subspace_id": "in.(s1,s2)"}


async def test_account_wide_has_no_subspace_filter(calls):
    await purge.purge_documents("u")
    assert calls["selects"][0][1] == {"user_id": "eq.u"}


async def test_empty_subspace_list_touches_nothing(calls):
    await purge.purge_documents("u", subspace_ids=[])
    assert calls["selects"] == [] and calls["deleted"] == []


async def test_storage_failure_never_blocks_the_delete(calls, monkeypatch):
    calls["rows"].append({"id": "d1", "storage_path": "u/d1/a.pdf"})

    async def boom(_paths):
        raise RuntimeError("storage down")

    monkeypatch.setattr(supabase, "storage_delete_many", boom)
    await purge.purge_documents("u")  # must not raise
