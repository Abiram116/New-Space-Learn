"""The flashcard scoring is pure code, so it is tested without a model."""

import pytest

agents = pytest.importorskip("eval.agents")

from app.services.coverage import Source  # noqa: E402

SRC = [Source(1, "c", "d", "p. 1", "A page fault occurs when a process touches a page that is not in memory.")]


def test_a_card_made_from_its_passage_is_grounded_and_a_made_up_one_is_not():
    deck = [
        {"front": "What is a page fault?", "back": "It occurs when a process touches a page not in memory.", "source": 1},
        {"front": "Why does the sky look blue?", "back": "Rayleigh scattering of sunlight.", "source": 1},
    ]
    out = agents.score_deck(deck, SRC)
    assert out["grounded"] == 1
    assert out["cards"] == 2 and out["question_fronts"] == 2 and out["with_source"] == 2


def test_a_card_pointing_at_no_real_source_counts_as_ungrounded():
    out = agents.score_deck([{"front": "What is X?", "back": "A thing about pages.", "source": 9}], SRC)
    assert out["with_source"] == 0 and out["grounded"] == 0


def test_repeated_fronts_are_counted():
    deck = [
        {"front": "What is a page fault?", "back": "A page not in memory is touched.", "source": 1},
        {"front": "What is a page fault?", "back": "A process touches a page not in memory.", "source": 1},
    ]
    assert agents.score_deck(deck, SRC)["repeated_fronts"] >= 1
