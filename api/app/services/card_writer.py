"""Writing a deck: plan, write, check.

The same shape as a quiz (`quiz_agent.py`) without the verify call — a card
states a fact and its answer, so there is no "only one right choice" to check,
and the code checks catch what goes wrong with cards in practice: an empty
side, a source that does not exist, the same card twice, or a card the
student already has.

    plan    `coverage.py`: the sections least used by earlier decks (or the
            material the student just read, when a deck is made from a reply)
    write   one call, a couple more cards than asked for, each naming its source
    check   in code, and keep the first `count` that pass

One model call. If the writer fails, that is the student's error to see; there
is nothing optional to skip.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field

from ..config import settings
from . import question_checks, usage
from .coverage import Source
from .llm import extract_title_line
from .quiz_agent import Complete, _complete, _sources_block, material, parse_items
from .voice import CARDS_AGENT_VOICE

log = logging.getLogger("space_learn.card_writer")

SPARE = 2
FRONT_MAX = 500
BACK_MAX = 2000
#: Earlier cards shown to the writer as "the student already has these".
SHOW_EARLIER = 15


@dataclass(slots=True)
class Card:
    front: str
    back: str
    #: Where it came from, as the student sees it.
    source: str | None = None
    source_chunk: str | None = None


@dataclass(slots=True)
class Deck:
    cards: list[Card]
    title: str | None = None
    trace: dict = field(default_factory=dict)


def card_problems(card: dict, *, sources: int) -> list[str]:
    found: list[str] = []
    front, back = str(card.get("front") or "").strip(), str(card.get("back") or "").strip()
    if len(front) < 8:
        found.append("no question")
    if len(back) < 3:
        found.append("no answer")
    if front and back and question_checks.text_similarity(front, back) >= 0.9:
        found.append("the answer repeats the question")
    source = card.get("source")
    if sources and (isinstance(source, bool) or not isinstance(source, int) or not 1 <= source <= sources):
        found.append("no valid source")
    return found


def write_prompt(*, count: int, topic: str, label: str, items: Sequence[Source], earlier: Sequence[dict]) -> str:
    have = [str(c.get("front", "")).strip()[:140] for c in earlier[:SHOW_EARLIER] if c.get("front")]
    have_block = (
        "Cards the student already has on this topic — do not write these again, even reworded:\n"
        + "\n".join(f"- {f}" for f in have)
        + "\n\n"
        if have
        else ""
    )
    return (
        f"Write {count} flashcards about '{topic}', within the subject '{label}' — resolve any ambiguity in "
        "the topic name using that subject, not a generic reading of the words. Write every card from ONE of "
        "the numbered sources below and from nothing else, and spread the cards across the sources.\n\n"
        f"Sources:\n{_sources_block(items)}\n\n"
        f"{have_block}"
        "Before the array, on its own line, write a name for this deck: 'TITLE: ' followed by 3-6 words naming "
        "what it actually covers (e.g. 'TITLE: Loop of Henle Basics') — not a generic label like 'Flashcards'.\n\n"
        'Then the JSON array — no other prose, no code fences. Each item: {"front": str, "back": str, "source": int}. '
        "front is a single question. back is a complete but compact answer, 2-3 sentences at most. source is the "
        "NUMBER of the source the card was written from. Plain sentences only — no markdown, no asterisks, no "
        "headings, no numbering."
    )


def usable(items: list[dict], sources: int, earlier: Sequence[dict]) -> tuple[list[dict], dict]:
    well_formed = [it for it in items if not card_problems(it, sources=sources)]
    repeats = question_checks.repeats_by_wording(well_formed, earlier)
    kept = [it for i, it in enumerate(well_formed) if i not in repeats]
    return kept, {"written": len(items), "malformed": len(items) - len(well_formed), "repeats": len(repeats)}


async def write_deck(
    *,
    count: int,
    topic: str,
    label: str,
    sources: Sequence[Source],
    conversation: str,
    earlier: Sequence[dict],
    student_context: str = "",
    complete: Complete = _complete,
) -> Deck:
    items = material(sources, conversation)
    system = CARDS_AGENT_VOICE + (f"\n\n{student_context}" if student_context else "")
    with usage.task("cards.write"):
        raw = await complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": write_prompt(count=count + SPARE, topic=topic, label=label, items=items, earlier=earlier)},
            ],
            settings.groq_model,
            0.3,
        )
    kept, trace = usable(parse_items(raw), len(items), earlier)
    cards: list[Card] = []
    for it in kept[:count]:
        source = items[it["source"] - 1] if isinstance(it.get("source"), int) and 0 < it["source"] <= len(items) else None
        cards.append(
            Card(
                front=str(it["front"]).strip()[:FRONT_MAX],
                back=str(it["back"]).strip()[:BACK_MAX],
                source=source.label if source else None,
                source_chunk=(source.chunk_id or None) if source else None,
            )
        )
    trace["kept"] = len(cards)
    return Deck(cards, extract_title_line(raw), trace)


#: Earlier cards read for the ledger.
LEDGER_CARDS = 400


async def ledger(user_id: str, subspace_id: str):  # noqa: ANN201 - (Counter, list[dict])
    """How often each chunk has had cards written from it in this topic, and
    the cards themselves — `coverage.ledger`'s twin for decks."""
    from collections import Counter

    from . import supabase

    decks = await supabase.db_select(
        "decks", filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"}, select="id"
    )
    used: Counter[str] = Counter()
    if not decks:
        return used, []
    cards = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "deck_id": f"in.({','.join(str(d['id']) for d in decks)})"},
        select="front,back,source_chunk",
        # Cards have no creation time; the order does not matter for counting,
        # and for "cards you already have" any sample of them will do.
        limit=LEDGER_CARDS,
    )
    for c in cards:
        if c.get("source_chunk"):
            used[str(c["source_chunk"])] += 1
    return used, cards
