"""Subject (Space) CRUD + nested subspaces list per space."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import OkOut, SpaceCreate, SpaceOut, SpaceUpdate, SubspaceOut
from ..services import supabase

router = APIRouter()


@router.get("/spaces", response_model=list[SpaceOut])
async def list_spaces(user: CurrentUser = Depends(get_current_user)) -> list[SpaceOut]:
    subjects = await supabase.db_select(
        "subjects",
        filters={"user_id": f"eq.{user.id}"},
        order="created_at.asc",
    )
    if not subjects:
        return []
    subspaces = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user.id}"},
        order="created_at.asc",
    )
    counts_by_subspace = await _bulk_counts(user.id, [s["id"] for s in subspaces])

    grouped: dict[str, list[SubspaceOut]] = {}
    for s in subspaces:
        grouped.setdefault(s["subject_id"], []).append(
            SubspaceOut(
                id=s["id"],
                subject_id=s["subject_id"],
                name=s["name"],
                last_activity_at=s.get("last_activity_at"),
                counts=counts_by_subspace.get(s["id"], {}),
            )
        )

    return [
        SpaceOut(
            id=sub["id"],
            name=sub["name"],
            tone=sub.get("tone", "brand"),
            subspaces=grouped.get(sub["id"], []),
        )
        for sub in subjects
    ]


@router.post("/spaces", response_model=SpaceOut, status_code=201)
async def create_space(
    body: SpaceCreate, user: CurrentUser = Depends(get_current_user)
) -> SpaceOut:
    inserted = await supabase.db_insert(
        "subjects", {"user_id": user.id, "name": body.name, "tone": body.tone}
    )
    row = inserted[0]
    return SpaceOut(id=row["id"], name=row["name"], tone=row["tone"], subspaces=[])


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
async def update_space(
    space_id: str, body: SpaceUpdate, user: CurrentUser = Depends(get_current_user)
) -> SpaceOut:
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        rows = await supabase.db_select(
            "subjects",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{space_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Space not found.")
        row = rows[0]
    else:
        updated = await supabase.db_update(
            "subjects",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{space_id}"},
            patch=patch,
        )
        if not updated:
            raise NotFound("Space not found.")
        row = updated[0]
    return SpaceOut(id=row["id"], name=row["name"], tone=row["tone"], subspaces=[])


@router.delete("/spaces/{space_id}", response_model=OkOut)
async def delete_space(
    space_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "subjects",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{space_id}"},
    )
    return OkOut()


# ── Helpers ────────────────────────────────────────────────────────────


async def _bulk_counts(user_id: str, subspace_ids: list[str]) -> dict[str, dict[str, int]]:
    """Fetch counts for docs/notes/quizzes/cards in a single pass per table."""

    if not subspace_ids:
        return {}
    ids_csv = ",".join(subspace_ids)
    tables = {
        "docs": ("documents", "subspace_id"),
        "notes": ("notes", "subspace_id"),
        "quizzes": ("quizzes", "subspace_id"),
    }
    out: dict[str, dict[str, int]] = {sid: {"docs": 0, "notes": 0, "quizzes": 0, "cards": 0} for sid in subspace_ids}
    for key, (table, col) in tables.items():
        rows = await supabase.db_select(
            table,
            filters={"user_id": f"eq.{user_id}", col: f"in.({ids_csv})"},
            select=f"{col}",
        )
        for r in rows:
            sid = r[col]
            if sid in out:
                out[sid][key] += 1

    # Cards: join through decks (deck belongs to subspace).
    decks = await supabase.db_select(
        "decks",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"in.({ids_csv})"},
        select="id,subspace_id",
    )
    deck_to_subspace = {d["id"]: d["subspace_id"] for d in decks}
    if decks:
        deck_ids = ",".join(deck_to_subspace.keys())
        cards = await supabase.db_select(
            "flashcards",
            filters={"user_id": f"eq.{user_id}", "deck_id": f"in.({deck_ids})"},
            select="deck_id",
        )
        for c in cards:
            sid = deck_to_subspace.get(c["deck_id"])
            if sid in out:
                out[sid]["cards"] += 1
    return out
