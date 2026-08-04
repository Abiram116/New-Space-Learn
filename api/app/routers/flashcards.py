"""Flashcards: decks, cards, and SM-2-lite grading.

Grading rules are kept in one place because they double as the client-side
optimistic update. Keep the two in sync.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import (
    DeckCreate,
    DeckOut,
    FlashcardCreate,
    FlashcardOut,
    GradeIn,
    OkOut,
)
from ..services import supabase

router = APIRouter()


# ── Decks ──────────────────────────────────────────────────────────────


@router.get("/subspaces/{subspace_id}/decks", response_model=list[DeckOut])
async def list_decks(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[DeckOut]:
    decks = await supabase.db_select(
        "decks",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.asc",
    )
    if not decks:
        return []
    ids = ",".join(d["id"] for d in decks)
    cards = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user.id}", "deck_id": f"in.({ids})"},
        select="id,deck_id,reps,due_at",
    )
    now = datetime.now(UTC)
    counts: dict[str, dict[str, int]] = {d["id"]: {"total": 0, "due": 0, "known": 0} for d in decks}
    for c in cards:
        did = c["deck_id"]
        counts[did]["total"] += 1
        if _to_dt(c["due_at"]) <= now:
            counts[did]["due"] += 1
        if int(c.get("reps", 0)) > 0:
            counts[did]["known"] += 1
    return [
        DeckOut(
            id=d["id"],
            name=d["name"],
            total=counts[d["id"]]["total"],
            due=counts[d["id"]]["due"],
            known_pct=(
                round(counts[d["id"]]["known"] * 100 / counts[d["id"]]["total"])
                if counts[d["id"]]["total"]
                else 0
            ),
        )
        for d in decks
    ]


@router.post(
    "/subspaces/{subspace_id}/decks", response_model=DeckOut, status_code=201
)
async def create_deck(
    subspace_id: str,
    body: DeckCreate,
    user: CurrentUser = Depends(get_current_user),
) -> DeckOut:
    inserted = await supabase.db_insert(
        "decks",
        {"user_id": user.id, "subspace_id": subspace_id, "name": body.name},
    )
    return DeckOut(id=inserted[0]["id"], name=body.name, total=0, due=0, known_pct=0)


@router.delete("/decks/{deck_id}", response_model=OkOut)
async def delete_deck(
    deck_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "decks", filters={"user_id": f"eq.{user.id}", "id": f"eq.{deck_id}"}
    )
    return OkOut()


# ── Cards ──────────────────────────────────────────────────────────────


@router.get("/decks/{deck_id}/cards", response_model=list[FlashcardOut])
async def list_cards(
    deck_id: str,
    user: CurrentUser = Depends(get_current_user),
    due_only: bool = False,
) -> list[FlashcardOut]:
    filters = {"user_id": f"eq.{user.id}", "deck_id": f"eq.{deck_id}"}
    if due_only:
        filters["due_at"] = f"lte.{datetime.now(UTC).isoformat()}"
    rows = await supabase.db_select(
        "flashcards", filters=filters, order="due_at.asc"
    )
    return [FlashcardOut(**{k: r.get(k) for k in FlashcardOut.model_fields}) for r in rows]


@router.post(
    "/decks/{deck_id}/cards", response_model=FlashcardOut, status_code=201
)
async def create_card(
    deck_id: str,
    body: FlashcardCreate,
    user: CurrentUser = Depends(get_current_user),
) -> FlashcardOut:
    inserted = await supabase.db_insert(
        "flashcards",
        {
            "user_id": user.id,
            "deck_id": deck_id,
            "front": body.front,
            "back": body.back,
            "source": body.source,
        },
    )
    r = inserted[0]
    return FlashcardOut(**{k: r.get(k) for k in FlashcardOut.model_fields})


@router.post("/cards/{card_id}/grade", response_model=FlashcardOut)
async def grade_card(
    card_id: str,
    body: GradeIn,
    user: CurrentUser = Depends(get_current_user),
) -> FlashcardOut:
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Card not found.")
    card = rows[0]
    ease = float(card.get("ease", 2.5))
    interval = int(card.get("interval_days", 0))
    reps = int(card.get("reps", 0))

    if body.grade == "again":
        ease = max(1.3, ease - 0.2)
        interval = 1
        reps = 0
    elif body.grade == "hard":
        ease = max(1.3, ease - 0.15)
        interval = max(1, int(round(interval * 1.2)))
        reps += 1
    elif body.grade == "good":
        interval = max(1, int(round(interval * ease))) if reps > 0 else 1
        reps += 1
    else:  # easy
        ease = ease + 0.15
        interval = max(2, int(round((interval or 1) * ease * 1.3)))
        reps += 1

    due_at = datetime.now(UTC) + timedelta(days=interval)
    updated = await supabase.db_update(
        "flashcards",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
        patch={
            "ease": ease,
            "interval_days": interval,
            "reps": reps,
            "due_at": due_at.isoformat(),
        },
    )
    await _bump_review_activity(user.id)
    r = updated[0]
    return FlashcardOut(**{k: r.get(k) for k in FlashcardOut.model_fields})


# ── Helpers ────────────────────────────────────────────────────────────


def _to_dt(v: str | datetime) -> datetime:
    if isinstance(v, datetime):
        return v.astimezone(UTC) if v.tzinfo else v.replace(tzinfo=UTC)
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


async def _bump_review_activity(user_id: str) -> None:
    today = date.today().isoformat()
    existing = await supabase.db_select(
        "daily_activity",
        filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
        limit=1,
    )
    if existing:
        await supabase.db_update(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
            patch={
                "cards_reviewed": int(existing[0].get("cards_reviewed", 0)) + 1,
                "study_seconds": int(existing[0].get("study_seconds", 0)) + 20,
            },
        )
    else:
        await supabase.db_insert(
            "daily_activity",
            {
                "user_id": user_id,
                "day": today,
                "cards_reviewed": 1,
                "study_seconds": 20,
            },
        )
