"""Ownership guards.

The backend talks to Postgres with the **service role key**, which bypasses
RLS. That's deliberate — it lets one request write across tables without
round-tripping a user JWT — but it means RLS is *not* our safety net here.
Every handler that accepts a caller-supplied row id must prove the row belongs
to the caller before touching it.

These live in one module so the check is identical everywhere; three routers
had drifted into their own near-copies.
"""

from __future__ import annotations

from .errors import NotFound
from .services import supabase


async def assert_subspace(user_id: str, subspace_id: str) -> dict:
    """Return the subspace row, or 404 if it isn't this user's."""
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{subspace_id}"},
        limit=1,
    )
    if not rows:
        # 404 rather than 403: don't confirm that someone else's id exists.
        raise NotFound("Subspace not found.")
    return rows[0]


async def assert_deck(user_id: str, deck_id: str) -> dict:
    rows = await supabase.db_select(
        "decks",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{deck_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Deck not found.")
    return rows[0]
