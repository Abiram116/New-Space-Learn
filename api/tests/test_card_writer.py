"""Decks: written from planned sources, checked in code, one model call."""

from __future__ import annotations

import json

import pytest

from app.services import card_writer
from app.services.coverage import Source

SOURCES = [
    Source(1, "chunk-a", "notes.pdf", "p. 2 · Photosynthesis", "Plants turn light into sugar in chloroplasts."),
    Source(2, "chunk-b", "notes.pdf", "p. 5 · Respiration", "Cells release energy from glucose in mitochondria."),
]


def card(front: str, back: str = "A compact answer in a sentence.", source: int = 1) -> dict:
    return {"front": front, "back": back, "source": source}


class Script:
    def __init__(self, reply: str) -> None:
        self.reply, self.calls = reply, []

    async def __call__(self, messages, model, temperature):
        self.calls.append(messages[-1]["content"])
        return self.reply


async def write(reply_items, *, count=2, earlier=()):
    script = Script("TITLE: Energy in Cells\n" + json.dumps(reply_items))
    deck = await card_writer.write_deck(
        count=count, topic="energy", label="Biology", sources=SOURCES, conversation="", earlier=list(earlier), complete=script,
    )
    return deck, script


async def test_one_call_two_spare_and_each_card_keeps_its_source():
    deck, script = await write([card("Where does photosynthesis happen?"), card("Where is glucose broken down?", source=2), card("Third card question here?")])
    assert len(script.calls) == 1 and "Write 4 flashcards" in script.calls[0]
    assert [(c.front, c.source, c.source_chunk) for c in deck.cards] == [
        ("Where does photosynthesis happen?", "notes.pdf · p. 2 · Photosynthesis", "chunk-a"),
        ("Where is glucose broken down?", "notes.pdf · p. 5 · Respiration", "chunk-b"),
    ]
    assert deck.title == "Energy in Cells"


async def test_broken_cards_and_cards_the_student_already_has_are_dropped():
    have = [{"front": "Where does photosynthesis happen?", "back": "A compact answer in a sentence."}]
    deck, script = await write(
        [
            card("Where does photosynthesis happen?"),  # already in a deck
            card("Short?"),  # no real question
            card("A question with no source at all?", source=7),
            card("What is the same as its answer?", back="What is the same as its answer?"),
            card("Where is glucose broken down?", source=2),
        ],
        earlier=have,
    )
    assert [c.front for c in deck.cards] == ["Where is glucose broken down?"]
    assert deck.trace == {"written": 5, "malformed": 3, "repeats": 1, "kept": 1}
    assert "already has" in script.calls[0] and "Where does photosynthesis happen?" in script.calls[0]


@pytest.mark.parametrize("reply", ["no json at all", "[]", "[1, 2, 3]"])
async def test_an_unreadable_reply_gives_an_empty_deck_not_an_exception(reply):
    script = Script(reply)
    deck = await card_writer.write_deck(
        count=3, topic="t", label="l", sources=SOURCES, conversation="", earlier=[], complete=script
    )
    assert deck.cards == []


async def test_sides_are_cut_to_what_the_database_holds():
    deck, _ = await write([card("Q" * 900 + "?", back="A" * 3000)], count=1)
    assert len(deck.cards[0].front) == card_writer.FRONT_MAX and len(deck.cards[0].back) == card_writer.BACK_MAX
