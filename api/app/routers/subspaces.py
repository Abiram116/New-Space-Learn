"""Subspace CRUD + membership queries."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import Forbidden, NotFound
from ..schemas import OkOut, SubspaceCreate, SubspaceOut, SubspaceUpdate
from ..services import supabase

router = APIRouter()


async def _get_owned_subspace(user_id: str, subspace_id: str) -> dict:
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{subspace_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Subspace not found.")
    return rows[0]


async def _assert_space_owned(user_id: str, space_id: str) -> None:
    rows = await supabase.db_select(
        "subjects",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{space_id}"},
        limit=1,
    )
    if not rows:
        raise Forbidden("You don't own that space.")


@router.post(
    "/spaces/{space_id}/subspaces", response_model=SubspaceOut, status_code=201
)
async def create_subspace(
    space_id: str,
    body: SubspaceCreate,
    user: CurrentUser = Depends(get_current_user),
) -> SubspaceOut:
    await _assert_space_owned(user.id, space_id)
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
    await _get_owned_subspace(user.id, subspace_id)
    await supabase.db_delete(
        "subspaces",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{subspace_id}"},
    )
    return OkOut()
