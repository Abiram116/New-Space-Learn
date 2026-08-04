"""Notes CRUD — supports user-authored and agent-generated origins."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import NoteCreate, NoteOut, NoteUpdate, OkOut
from ..services import supabase

router = APIRouter()


def _to_note(row: dict) -> NoteOut:
    return NoteOut(
        id=row["id"],
        title=row["title"],
        body_md=row.get("body_md", ""),
        origin=row.get("origin", "user"),
        source_ids=row.get("source_ids"),
        updated_at=row["updated_at"],
    )


@router.get("/subspaces/{subspace_id}/notes", response_model=list[NoteOut])
async def list_notes(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[NoteOut]:
    rows = await supabase.db_select(
        "notes",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        order="updated_at.desc",
    )
    return [_to_note(r) for r in rows]


@router.post(
    "/subspaces/{subspace_id}/notes", response_model=NoteOut, status_code=201
)
async def create_note(
    subspace_id: str,
    body: NoteCreate,
    user: CurrentUser = Depends(get_current_user),
) -> NoteOut:
    now = datetime.now(UTC).isoformat()
    inserted = await supabase.db_insert(
        "notes",
        {
            "user_id": user.id,
            "subspace_id": subspace_id,
            "title": body.title,
            "body_md": body.body_md,
            "origin": body.origin,
            "updated_at": now,
        },
    )
    return _to_note(inserted[0])


@router.patch("/notes/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: str,
    body: NoteUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> NoteOut:
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        rows = await supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Note not found.")
        return _to_note(rows[0])
    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = await supabase.db_update(
        "notes",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"},
        patch=patch,
    )
    if not updated:
        raise NotFound("Note not found.")
    return _to_note(updated[0])


@router.delete("/notes/{note_id}", response_model=OkOut)
async def delete_note(
    note_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "notes", filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"}
    )
    return OkOut()
