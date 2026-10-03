"""Flashcards: decks, cards, and FSRS-5 grading.

Grading rules live in `services/fsrs.py` because they double as the
client-side optimistic update (mirrored in `web/src/lib/schedule.ts`). Keep
the two in sync.
"""

from __future__ import annotations

import asyncio
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
from ..services import (
    activity,
    card_writer,
    coverage,
    fsrs,
    locks,
    personalization,
    rag,
    student_model,
    supabase,
)
from ..services.chat_context import format_history, recent_history
from ..services.coverage import Source
from ..services.ratelimit import consume_llm_quota

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


@router.get("/decks", response_model=list[DeckOut])
async def list_all_decks(
    user: CurrentUser = Depends(get_current_user), limit: int = 300
) -> list[DeckOut]:
    """Every deck this user has, wherever it lives — same shape and same
    reasoning as `notes.list_all_notes`: a deck belongs to the student, not
    to whichever topic they happened to create it in.

    No `assert_*` guard for the same reason `list_all_notes` has none: the
    filter IS `user_id`, applied server-side, so it cannot leak another
    user's rows. `test_guard_coverage.py` accepts this shape explicitly
    (see the note on that file for `list_all_notes`).
    """
    decks, subspaces, subjects = await asyncio.gather(
        supabase.db_select(
            "decks",
            filters={"user_id": f"eq.{user.id}"},
            order="created_at.desc",
            limit=min(limit, 500),
        ),
        supabase.db_select(
            "subspaces", filters={"user_id": f"eq.{user.id}"}, select="id,subject_id,name"
        ),
        supabase.db_select("subjects", filters={"user_id": f"eq.{user.id}"}, select="id,name"),
    )
    subject_name = {s["id"]: s.get("name") for s in subjects}
    place = {
        s["id"]: (s.get("name"), subject_name.get(s.get("subject_id")))
        for s in subspaces
    }
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

    out: list[DeckOut] = []
    for d in decks:
        sub_name, subj_name = place.get(d.get("subspace_id"), (None, None))
        total = counts[d["id"]]["total"]
        out.append(
            DeckOut(
                id=d["id"],
                name=d["name"],
                total=total,
                due=counts[d["id"]]["due"],
                known_pct=round(counts[d["id"]]["known"] * 100 / total) if total else 0,
                subspace_id=d.get("subspace_id"),
                subspace_name=sub_name,
                subject_name=subj_name,
            )
        )
    return out


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
    linked_ids, (used, earlier), history, snap = await asyncio.gather(
        rag.linked_subspace_ids(user.id, subspace_id),
        card_writer.ledger(user.id, subspace_id),
        recent_history(user.id, subspace_id),
        student_model.snapshot(user.id),
    )
    student_context = personalization.render(snap, "cards", subspace_id=subspace_id)
    if body.source_text and body.source_text.strip():
        # A deck from the answer the student just read: that answer is the
        # material, and nothing else is searched.
        sources = [Source(1, "", "The answer you were reading", "", body.source_text.strip())]
        conversation = ""
    else:
        sources = await coverage.plan(
            subspace_id=subspace_id,
            linked_subspace_ids=linked_ids,
            topic=body.topic,
            questions=body.count,
            used=used,
            weak_concepts=[c.label for c in snap.concepts_in(subspace_id) if c.is_weak],
        )
        # Chat counts as material — see the note in quizzes.generate_quiz.
        if not sources and not history:
            raise NothingIndexed()
        conversation = format_history(history)

    generated_title: str | None = None
    cards: list[card_writer.Card] = []
    if settings.llm_configured:
        try:
            deck_draft = await card_writer.write_deck(
                count=body.count,
                topic=topic,
                label=label,
                sources=sources,
                conversation=conversation,
                earlier=earlier,
                student_context=student_context,
            )
        except ApiError:
            raise
        except Exception as e:
            log.exception("card generation failed")
            raise UpstreamUnavailable("Couldn't reach the AI to write cards.") from e
        log.info("deck written subspace=%s sources=%d %s", subspace_id, len(sources), deck_draft.trace)
        cards, generated_title = deck_draft.cards, deck_draft.title

    if not cards:
        raise UpstreamUnavailable(
            "Couldn't write cards from this material yet. Upload a document or "
            "add a card yourself."
        )

    # Same priority as quizzes.generate_quiz's `topic`: an explicitly typed
    # topic (from the Flashcards tab's "Generate a deck" modal) is a real
    # name and wins outright. Only when the student didn't type one — the
    # common case, since "Make cards from this chat" never asks — does the
    # model's own generated title take over, ahead of the generic
    # `_deck_name(topic)` fallback (which now only fires when the model
    # somehow returned no title, or the AI isn't configured at all).
    deck_name = (
        body.deck_name
        or (_deck_name(body.topic) if body.topic else None)
        or generated_title
        or _deck_name(topic)
    )
    deck = (
        await supabase.db_insert(
            "decks",
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "name": deck_name,
            },
        )
    )[0]

    rows = await supabase.db_insert(
        "flashcards",
        [
            {
                "user_id": user.id,
                "deck_id": deck["id"],
                "front": c.front,
                "back": c.back,
                "source": c.source,
                "source_chunk": c.source_chunk,
            }
            for c in cards
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
    # One grade at a time per card. The schedule is computed from the card's
    # stored state and written back; two grades in flight for the same card (an
    # "Again" that re-queues it, graded again before the first request lands)
    # both read the old state, and the second silently overwrote the first.
    replay_key = f"{user.id}:{card_id}:{body.review_id}" if body.review_id else None
    async with locks.keyed(f"card:{card_id}"):
        # A re-sent grade (the client never got our reply) is answered with the
        # result of the first one, not applied a second time.
        if replay_key and (done := _graded.get(replay_key)) is not None:
            return done  # type: ignore[return-value]
        rows = await supabase.db_select(
            "flashcards",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Card not found.")
        card = rows[0]

        # The deck read genuinely depends on the card's deck_id, so it stays
        # sequential — same reasoning as list_decks above.
        deck_rows = await supabase.db_select(
            "decks", filters={"id": f"eq.{card['deck_id']}"}, limit=1
        )
        subspace_id = deck_rows[0]["subspace_id"] if deck_rows else None

        now = datetime.now(UTC)
        last_review_at = card.get("last_review_at")
        elapsed_days = max(0, (now - _to_dt(last_review_at)).days) if last_review_at else None
        stability = card.get("stability")
        difficulty = card.get("difficulty")

        result = fsrs.review(
            stability=float(stability) if stability is not None else None,
            difficulty=float(difficulty) if difficulty is not None else None,
            elapsed_days=elapsed_days,
            grade=body.grade,
        )

        lapses = int(card.get("lapses", 0)) + (1 if body.grade == "again" else 0)
        reps = 0 if body.grade == "again" else int(card.get("reps", 0)) + 1
        due_at = now + timedelta(days=result.interval_days)

        updated = await supabase.db_update(
            "flashcards",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{card_id}"},
            patch={
                "stability": result.stability,
                "difficulty": result.difficulty,
                "last_review_at": now.isoformat(),
                "lapses": lapses,
                "reps": reps,
                "interval_days": result.interval_days,
                "due_at": due_at.isoformat(),
            },
        )
    await supabase.db_insert(
        "card_reviews",
        {
            "user_id": user.id,
            "card_id": card_id,
            "subspace_id": subspace_id,
            "grade": fsrs.GRADE_NUMBER[body.grade],
            "elapsed_days": elapsed_days,
            "retrievability": result.retrievability,
            "stability_after": result.stability,
        },
    )
    await activity.bump(
        user.id, cards_reviewed=1, study_seconds=activity.SECONDS_PER_CARD_REVIEW
    )
    if subspace_id:
        await activity.touch_subspace(subspace_id)
    r = updated[0]
    out = FlashcardOut(**{k: r.get(k) for k in FlashcardOut.model_fields})
    if replay_key:
        _graded.put(replay_key, out)
    return out


#: Recently applied grades, by (user, card, review id) — see `grade_card`.
_graded = locks.Recent()


# ── Helpers ────────────────────────────────────────────────────────────


def _to_card(row: dict) -> FlashcardOut:
    return FlashcardOut(**{k: row.get(k) for k in FlashcardOut.model_fields})


def _deck_name(topic: str) -> str:
    clean = topic.strip().rstrip('.')
    return (clean[:1].upper() + clean[1:])[:80] or 'New deck'


def _to_dt(v: str | datetime) -> datetime:
    if isinstance(v, datetime):
        return v.astimezone(UTC) if v.tzinfo else v.replace(tzinfo=UTC)
    return datetime.fromisoformat(v.replace("Z", "+00:00"))
