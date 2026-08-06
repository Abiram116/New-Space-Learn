"""Flashcards: decks, cards, and SM-2-lite grading.

Grading rules are kept in one place because they double as the client-side
optimistic update. Keep the two in sync.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, NothingIndexed, UpstreamUnavailable
from ..guards import assert_deck, assert_subspace, subspace_label
from ..schemas import (
    CardsGenerate,
    DeckCreate,
    DeckOut,
    FlashcardCreate,
    FlashcardOut,
    FlashcardUpdate,
    GradeIn,
    OkOut,
)
from ..services import activity, rag, student_model, supabase
from ..services.chat_context import format_history, recent_history
from ..services.llm import get_llm
from ..services.ratelimit import consume_llm_quota
from ..services.voice import CARDS_AGENT_VOICE

log = logging.getLogger("space_learn.cards")
router = APIRouter()


# ── Decks ──────────────────────────────────────────────────────────────


@router.get("/subspaces/{subspace_id}/decks", response_model=list[DeckOut])
async def list_decks(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[DeckOut]:
    # Guard and deck read run together — see the note in notes.list_notes.
    # The card read below genuinely depends on the deck ids, so it stays
    # sequential: three round trips become two.
    _, decks = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "decks",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="created_at.asc",
        ),
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
    await assert_subspace(user.id, subspace_id)
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
    await assert_deck(user.id, deck_id)
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


@router.patch("/cards/{card_id}", response_model=FlashcardOut)
async def update_card(
    card_id: str,
    body: FlashcardUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> FlashcardOut:
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        rows = await supabase.db_select(
            "flashcards",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Card not found.")
        return _to_card(rows[0])
    updated = await supabase.db_update(
        "flashcards",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
        patch=patch,
    )
    if not updated:
        raise NotFound("Card not found.")
    return _to_card(updated[0])


@router.delete("/cards/{card_id}", response_model=OkOut)
async def delete_card(
    card_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "flashcards", filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"}
    )
    return OkOut()


@router.post(
    "/subspaces/{subspace_id}/cards/generate",
    response_model=list[FlashcardOut],
    status_code=201,
)
async def generate_cards(
    subspace_id: str,
    body: CardsGenerate,
    user: CurrentUser = Depends(get_current_user),
) -> list[FlashcardOut]:
    """Build a whole deck in one call.

    The previous flow split one chat reply into a single card, which is not a
    deck by any definition. Here the model is asked for `count` question/answer
    pairs grounded in the subspace's own indexed material.
    """

    subspace = await assert_subspace(user.id, subspace_id)
    await consume_llm_quota(user.id, cost=2)

    topic = body.topic or "the key concepts in this material"
    label = subspace_label(subspace)
    context = body.source_text or ""
    if not context:
        retrieved = await rag.retrieve(subspace_id, topic, k=6)
        if not retrieved:
            raise NothingIndexed()
        context = "\n\n".join(f"- {r.content}" for r in retrieved)
    history = await recent_history(user.id, subspace_id)
    student_context = student_model.format_for_prompt(await student_model.get(user.id))

    if settings.llm_configured:
        pairs = await _generate_pairs(topic, label, context, history, student_context, body.count)
    else:
        pairs = []

    if not pairs:
        raise UpstreamUnavailable(
            "Couldn't write cards from this material yet. Upload a document or "
            "add a card yourself."
        )

    deck = (
        await supabase.db_insert(
            "decks",
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "name": body.deck_name or _deck_name(topic),
            },
        )
    )[0]

    rows = await supabase.db_insert(
        "flashcards",
        [
            {
                "user_id": user.id,
                "deck_id": deck["id"],
                "front": p["front"][:500],
                "back": p["back"][:2000],
                "source": p.get("source"),
            }
            for p in pairs
        ],
    )
    await activity.touch_subspace(subspace_id)
    return [_to_card(r) for r in rows]


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
    await activity.bump(
        user.id, cards_reviewed=1, study_seconds=activity.SECONDS_PER_CARD_REVIEW
    )
    r = updated[0]
    return FlashcardOut(**{k: r.get(k) for k in FlashcardOut.model_fields})


# ── Helpers ────────────────────────────────────────────────────────────


def _to_card(row: dict) -> FlashcardOut:
    return FlashcardOut(**{k: row.get(k) for k in FlashcardOut.model_fields})


def _deck_name(topic: str) -> str:
    clean = topic.strip().rstrip('.')
    return (clean[:1].upper() + clean[1:])[:80] or 'New deck'


async def _generate_pairs(
    topic: str,
    label: str,
    context: str,
    history: list[dict[str, str]],
    student_context: str,
    count: int,
) -> list[dict]:
    """Ask for `count` Q/A pairs as JSON. Returns [] rather than raising on a
    malformed reply, so the caller owns the user-facing message."""

    material = context.strip()
    recent = format_history(history) or "(no prior chat in this space)"
    prompt = (
        f"Write {count} flashcards about '{topic}', within the subject "
        f"'{label}' — resolve any ambiguity in the topic name using that "
        f"subject, not a generic reading of the words.\n\n"
        f"Recent conversation in this space (for context on what's actually "
        f"being studied — do not quote it directly):\n{recent}\n\n"
        f"Material:\n{material}\n\n"
        'Return ONLY a JSON array. Each item: {"front": str, "back": str}. '
        "front is a single question. back is a complete but compact answer, "
        "2-3 sentences at most. Plain sentences only — no markdown, no "
        "asterisks, no headings, no numbering. No prose outside the array."
    )
    system = CARDS_AGENT_VOICE + (f"\n\n{student_context}" if student_context else "")
    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            model=settings.groq_model,
            temperature=0.3,
        ):
            parts.append(delta)
        raw = "".join(parts)
    except ApiError:
        raise
    except Exception as e:
        log.exception("card generation failed")
        raise UpstreamUnavailable("Couldn't reach the AI to write cards.") from e

    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return []

    out: list[dict] = []
    for item in data[:count]:
        if not isinstance(item, dict):
            continue
        front, back = str(item.get("front", "")).strip(), str(item.get("back", "")).strip()
        if front and back:
            out.append({"front": front, "back": back, "source": item.get("source")})
    return out


def _to_dt(v: str | datetime) -> datetime:
    if isinstance(v, datetime):
        return v.astimezone(UTC) if v.tzinfo else v.replace(tzinfo=UTC)
    return datetime.fromisoformat(v.replace("Z", "+00:00"))
