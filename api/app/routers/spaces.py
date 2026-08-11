"""Subject (Space) CRUD + nested subspaces list per space."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import OkOut, SpaceCreate, SpaceOut, SpaceUpdate
from ..services import supabase

router = APIRouter()


@router.get("/spaces", response_model=list[SpaceOut])
async def list_spaces(user: CurrentUser = Depends(get_current_user)) -> list[SpaceOut]:
    """Subjects, their topics, and each topic's counts — in ONE round trip.

    This endpoint is on the critical path of every page in the app: the rail,
    Home's topic grid and the fallback-subspace lookup all read it. It was also
    the slowest thing in the product, measured at 1.4-2.4s warm.

    Nothing about it was computationally slow. It made seven REST calls in
    series — subjects, subspaces, then documents / notes / quizzes / decks /
    flashcards for the counts — and against a remote Supabase a warm round trip
    is ~250ms. The latency was network, paid seven times over.

    Overlapping them was measured and is *worse*: concurrency forces fresh TLS
    handshakes that cost more than the serialisation saves. The previous
    implementation's own comment reached the right conclusion — "the win here
    would come from asking for FEWER queries" — so this asks once, and the
    counting happens where the rows already are.
    """
    rows = await supabase.db_rpc("spaces_with_counts", {"p_user_id": user.id})
    return [SpaceOut.model_validate(row) for row in (rows or [])]


@router.post("/spaces", response_model=SpaceOut, status_code=201)
async def create_space(
    body: SpaceCreate, user: CurrentUser = Depends(get_current_user)
) -> SpaceOut:
    # No `slug` field — the slug columns and their generator function were
    # removed. Routing is by id only; see `web/src/lib/nav.ts`.
    inserted = await supabase.db_insert(
        "subjects",
        {"user_id": user.id, "name": body.name, "tone": body.tone},
    )
    row = inserted[0]
    # `pinned` read from the row rather than assumed: the default lives in the
    # database, and hardcoding False here would quietly diverge if it changed.
    return SpaceOut(
        id=row["id"],
        name=row["name"],
        tone=row["tone"],
        pinned=bool(row.get("pinned", False)),
        subspaces=[],
    )


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


