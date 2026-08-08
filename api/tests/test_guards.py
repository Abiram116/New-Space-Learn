"""Ownership guards — the actual authorization boundary.

Why this file exists, from `docs/SECURITY.md §2` and `docs/adr/0004`: the
backend talks to Postgres with the **service-role key, which bypasses RLS**.
So RLS is defense-in-depth, not the thing stopping a cross-user read — these
guards are. A missed or broken guard is a silent data leak, not a loud error,
and `docs/architecture.md` records that exactly this leak has happened once
already and was fixed by hand.

That makes these the highest-value tests in the codebase.
"""

from __future__ import annotations

import pytest

from app.errors import NotFound
from app.guards import assert_deck, assert_space, assert_subspace, subspace_label

from .conftest import INTRUDER, OWNER

SUBSPACE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
SPACE_ID = "bbbbbbbb-0000-0000-0000-000000000001"
DECK_ID = "cccccccc-0000-0000-0000-000000000001"


# ── assert_subspace ────────────────────────────────────────────────────


async def test_assert_subspace_returns_row_for_owner(db):
    db.seed(
        "subspaces",
        [{"id": SUBSPACE_ID, "user_id": OWNER, "name": "Markov decision processes"}],
    )
    row = await assert_subspace(OWNER, SUBSPACE_ID)
    assert row["id"] == SUBSPACE_ID


async def test_assert_subspace_rejects_another_users_row(db):
    """The row exists — it just isn't the caller's. This is the leak case."""
    db.seed(
        "subspaces",
        [{"id": SUBSPACE_ID, "user_id": OWNER, "name": "Markov decision processes"}],
    )
    with pytest.raises(NotFound):
        await assert_subspace(INTRUDER, SUBSPACE_ID)


async def test_assert_subspace_rejects_missing_row(db):
    db.seed("subspaces", [])
    with pytest.raises(NotFound):
        await assert_subspace(OWNER, SUBSPACE_ID)


async def test_assert_subspace_filters_on_user_id_not_just_row_id(db):
    """Guard against a regression where the user filter is dropped.

    A query filtered only by `id` would return the row and pass the "owner"
    test above while leaking every other user's data. Assert the filter itself,
    because the happy path alone cannot catch this.
    """
    db.seed("subspaces", [{"id": SUBSPACE_ID, "user_id": OWNER, "name": "x"}])
    await assert_subspace(OWNER, SUBSPACE_ID)
    query = db.selects[-1]
    assert query["filters"].get("user_id") == f"eq.{OWNER}"
    assert query["filters"].get("id") == f"eq.{SUBSPACE_ID}"


async def test_assert_subspace_embeds_parent_subject(db):
    """`subspace_label` depends on the subject being embedded in the select.

    If the `select` drops `subjects(name)`, generation prompts silently lose
    their subject grounding — the exact "transformers → movie trivia" bug in
    `docs/backlog.md`. Cheap to assert, expensive to rediscover.
    """
    db.seed("subspaces", [{"id": SUBSPACE_ID, "user_id": OWNER, "name": "x"}])
    await assert_subspace(OWNER, SUBSPACE_ID)
    assert "subjects(name)" in db.selects[-1]["select"]


# ── assert_space / assert_deck ─────────────────────────────────────────


async def test_assert_space_returns_row_for_owner(db):
    db.seed("subjects", [{"id": SPACE_ID, "user_id": OWNER, "name": "RL"}])
    row = await assert_space(OWNER, SPACE_ID)
    assert row["id"] == SPACE_ID


async def test_assert_space_rejects_another_users_row(db):
    db.seed("subjects", [{"id": SPACE_ID, "user_id": OWNER, "name": "RL"}])
    with pytest.raises(NotFound):
        await assert_space(INTRUDER, SPACE_ID)


async def test_assert_deck_returns_row_for_owner(db):
    db.seed("decks", [{"id": DECK_ID, "user_id": OWNER, "name": "Week 6"}])
    row = await assert_deck(OWNER, DECK_ID)
    assert row["id"] == DECK_ID


async def test_assert_deck_rejects_another_users_row(db):
    db.seed("decks", [{"id": DECK_ID, "user_id": OWNER, "name": "Week 6"}])
    with pytest.raises(NotFound):
        await assert_deck(INTRUDER, DECK_ID)


# ── Error shape ────────────────────────────────────────────────────────


async def test_guards_raise_not_found_not_forbidden(db):
    """404, never 403.

    Returning "forbidden" would confirm the id exists and belongs to somebody,
    which is an enumeration oracle. `guards.py` documents this choice; this
    test keeps a future refactor from "helpfully" making it a 403.
    """
    db.seed("subspaces", [{"id": SUBSPACE_ID, "user_id": OWNER, "name": "x"}])
    with pytest.raises(NotFound) as excinfo:
        await assert_subspace(INTRUDER, SUBSPACE_ID)
    assert excinfo.value.status == 404
    assert excinfo.value.code == "not_found"


# ── subspace_label ─────────────────────────────────────────────────────


def test_subspace_label_combines_subject_and_topic():
    label = subspace_label({"name": "Attention", "subjects": {"name": "Deep Learning"}})
    assert label == "Deep Learning — Attention"


def test_subspace_label_falls_back_to_topic_alone():
    assert subspace_label({"name": "Attention", "subjects": None}) == "Attention"
    assert subspace_label({"name": "Attention"}) == "Attention"
