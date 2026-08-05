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
    """Return the subspace row (with its parent subject's name embedded, as
    `row["subjects"]["name"]`), or 404 if it isn't this user's."""
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{subspace_id}"},
        select="*,subjects(name)",
        limit=1,
    )
    if not rows:
        # 404 rather than 403: don't confirm that someone else's id exists.
        raise NotFound("Subspace not found.")
    return rows[0]


def subspace_label(subspace_row: dict) -> str:
    """'<subject> — <subspace>', for grounding generation prompts so a bare
    word like 'transformers' resolves to the actual subject, not whatever a
    model free-associates from the word alone."""
    subject_name = (subspace_row.get("subjects") or {}).get("name")
    name = subspace_row.get("name", "")
    return f"{subject_name} — {name}" if subject_name else name


async def assert_space(user_id: str, space_id: str) -> dict:
    """Return the subject ('space') row, or 404 if it isn't this user's."""
    rows = await supabase.db_select(
        "subjects",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{space_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Space not found.")
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
