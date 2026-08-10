"""Subspace CRUD + membership queries.

Ownership checks come from `guards.py` — this module kept private copies of
them until 2026-08-10, and they had drifted: the local space check raised
`Forbidden` (403) where the shared guard raises `NotFound` (404). That
difference matters. A 403 confirms the row exists and belongs to somebody,
which turns the endpoint into an enumeration oracle; the 404 is a deliberate
anti-enumeration choice documented in `docs/decisions.md`. Two
implementations of one security rule is one implementation too many.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound, ValidationFailed
from ..guards import assert_space, assert_subspace
from ..schemas import OkOut, SubspaceCreate, SubspaceLinkCreate, SubspaceOut, SubspaceUpdate
from ..services import supabase

router = APIRouter()


@router.post(
    "/spaces/{space_id}/subspaces", response_model=SubspaceOut, status_code=201
)
async def create_subspace(
    space_id: str,
    body: SubspaceCreate,
    user: CurrentUser = Depends(get_current_user),
) -> SubspaceOut:
    await assert_space(user.id, space_id)
    # No `slug` field — the slug columns were dropped from the database.
    inserted = await supabase.db_insert(
        "subspaces",
        {"user_id": user.id, "subject_id": space_id, "name": body.name},
    )
    row = inserted[0]
    return SubspaceOut(
        id=row["id"],
        subject_id=row["subject_id"],
        name=row["name"],
        last_activity_at=row.get("last_activity_at"),
        counts={},
    )


@router.patch("/subspaces/{subspace_id}", response_model=SubspaceOut)
async def update_subspace(
    subspace_id: str,
    body: SubspaceUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> SubspaceOut:
    updated = await supabase.db_update(
        "subspaces",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{subspace_id}"},
        patch={"name": body.name},
    )
    if not updated:
        raise NotFound("Subspace not found.")
    row = updated[0]
    return SubspaceOut(
        id=row["id"],
        subject_id=row["subject_id"],
        name=row["name"],
        last_activity_at=row.get("last_activity_at"),
        counts={},
    )


@router.delete("/subspaces/{subspace_id}", response_model=OkOut)
async def delete_subspace(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await assert_subspace(user.id, subspace_id)
    await supabase.db_delete(
        "subspaces",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{subspace_id}"},
    )
    return OkOut()


# ── Linked subspaces ──────────────────────────────────────────────────
#
# An explicit, opt-in "related to" edge — not an auto-extracted graph. See
# docs/v2-review.md for why. Links are stored symmetrically (A→B and B→A)
# so either side surfaces the relationship without a second lookup.


@router.get("/subspaces/{subspace_id}/links", response_model=list[SubspaceOut])
async def list_links(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[SubspaceOut]:
    await assert_subspace(user.id, subspace_id)
    links = await supabase.db_select(
        "subspace_links",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        select="linked_subspace_id",
    )
    ids = [row["linked_subspace_id"] for row in links]
    if not ids:
        return []
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user.id}", "id": f"in.({','.join(ids)})"},
    )
    return [
        SubspaceOut(
            id=r["id"],
            subject_id=r["subject_id"],
            name=r["name"],
            last_activity_at=r.get("last_activity_at"),
            counts={},
        )
        for r in rows
    ]


@router.post("/subspaces/{subspace_id}/links", response_model=OkOut, status_code=201)
async def create_link(
    subspace_id: str,
    body: SubspaceLinkCreate,
    user: CurrentUser = Depends(get_current_user),
) -> OkOut:
    if body.linked_subspace_id == subspace_id:
        raise ValidationFailed("A topic can't link to itself.")
    await assert_subspace(user.id, subspace_id)
    await assert_subspace(user.id, body.linked_subspace_id)
    await supabase.db_insert(
        "subspace_links",
        [
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "linked_subspace_id": body.linked_subspace_id,
            },
            {
                "user_id": user.id,
                "subspace_id": body.linked_subspace_id,
                "linked_subspace_id": subspace_id,
            },
        ],
    )
    return OkOut()


@router.delete("/subspaces/{subspace_id}/links/{linked_subspace_id}", response_model=OkOut)
async def delete_link(
    subspace_id: str,
    linked_subspace_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> OkOut:
    await assert_subspace(user.id, subspace_id)
    await supabase.db_delete(
        "subspace_links",
        filters={
            "user_id": f"eq.{user.id}",
            "subspace_id": f"eq.{subspace_id}",
            "linked_subspace_id": f"eq.{linked_subspace_id}",
        },
    )
    await supabase.db_delete(
        "subspace_links",
        filters={
            "user_id": f"eq.{user.id}",
            "subspace_id": f"eq.{linked_subspace_id}",
            "linked_subspace_id": f"eq.{subspace_id}",
        },
    )
    return OkOut()
