"""Renaming a deck, and renaming or deleting a quiz.

Each one must touch only the caller's own row: the filters carry `user_id`,
so another user's id is "not found", never changed.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.deps import CurrentUser
from app.errors import NotFound
from app.routers import flashcards as flashcards_router
from app.routers import quizzes as quizzes_router
from app.schemas import DeckUpdate, QuizUpdate
from app.services import supabase as supabase_module

from .conftest import INTRUDER, OWNER

DECK = "dddddddd-0000-0000-0000-0000000000d1"
QUIZ = "cccccccc-0000-0000-0000-0000000000c1"
TOPIC = "aaaaaaaa-0000-0000-0000-0000000000a1"


def _user(user_id: str = OWNER) -> CurrentUser:
    return CurrentUser(id=user_id, email=None)


def _deck() -> dict:
    return {"id": DECK, "user_id": OWNER, "subspace_id": TOPIC, "name": "Old name"}


def _card(i: int, *, reps: int, due_at: str) -> dict:
    return {"id": f"card-{i}", "user_id": OWNER, "deck_id": DECK, "reps": reps, "due_at": due_at}


def _quiz() -> dict:
    return {
        "id": QUIZ,
        "user_id": OWNER,
        "subspace_id": TOPIC,
        "topic": "Old topic",
        "created_at": "2026-09-01T00:00:00+00:00",
        "questions": [{"q": "Q", "choices": ["a", "b"], "answer_index": 0}],
    }


@pytest.fixture
def deletes(db, monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """The shared fake has no delete; record what would have been removed."""
    seen: list[dict] = []

    async def db_delete(table: str, *, filters: dict[str, str]) -> None:
        seen.append({"table": table, "filters": filters})

    monkeypatch.setattr(supabase_module, "db_delete", db_delete)
    return seen


# ── Decks ──────────────────────────────────────────────────────────────


async def test_rename_deck_returns_the_new_name_with_its_counts(db):
    db.seed("decks", [_deck()])
    db.seed(
        "flashcards",
        [
            _card(1, reps=2, due_at="2020-01-01T00:00:00+00:00"),  # known, due
            _card(2, reps=0, due_at="2999-01-01T00:00:00+00:00"),  # new, not due
        ],
    )
    out = await flashcards_router.rename_deck(DECK, DeckUpdate(name="  Cell biology  "), _user())
    assert (out.id, out.name) == (DECK, "Cell biology")
    assert (out.total, out.due, out.known_pct) == (2, 1, 50)
    assert out.subspace_id == TOPIC
    assert db.updates == [
        {
            "table": "decks",
            "filters": {"user_id": f"eq.{OWNER}", "id": f"eq.{DECK}"},
            "patch": {"name": "Cell biology"},
        }
    ]


async def test_rename_deck_refuses_another_users_deck(db):
    db.seed("decks", [_deck()])
    with pytest.raises(NotFound):
        await flashcards_router.rename_deck(DECK, DeckUpdate(name="Mine now"), _user(INTRUDER))
    assert db.updates == []


@pytest.mark.parametrize("name", ["", "   ", "x" * 81])
def test_deck_name_length_is_checked(name: str):
    with pytest.raises(ValidationError):
        DeckUpdate(name=name)


# ── Quizzes ────────────────────────────────────────────────────────────


async def test_rename_quiz_changes_the_topic_and_keeps_its_scores(db):
    db.seed("quizzes", [_quiz()])
    db.seed(
        "quiz_results",
        [
            {"quiz_id": QUIZ, "user_id": OWNER, "score": 60},
            {"quiz_id": QUIZ, "user_id": OWNER, "score": 80},
        ],
    )
    out = await quizzes_router.rename_quiz(QUIZ, QuizUpdate(topic=" Mitosis "), _user())
    assert (out.id, out.topic) == (QUIZ, "Mitosis")
    assert (out.best_score, out.attempts) == (80, 2)
    assert out.subspace_id == TOPIC
    assert db.updates[0]["filters"] == {"user_id": f"eq.{OWNER}", "id": f"eq.{QUIZ}"}
    assert db.updates[0]["patch"] == {"topic": "Mitosis"}


async def test_rename_quiz_refuses_another_users_quiz(db):
    db.seed("quizzes", [_quiz()])
    with pytest.raises(NotFound):
        await quizzes_router.rename_quiz(QUIZ, QuizUpdate(topic="Mine now"), _user(INTRUDER))


@pytest.mark.parametrize("topic", ["", "   ", "x" * 141])
def test_quiz_topic_length_is_checked(topic: str):
    with pytest.raises(ValidationError):
        QuizUpdate(topic=topic)


async def test_delete_quiz_is_scoped_to_the_caller(db, deletes):
    """Only the quiz row is deleted: `quiz_results` cascades in the schema."""
    db.seed("quizzes", [_quiz()])
    out = await quizzes_router.delete_quiz(QUIZ, _user(INTRUDER))
    assert out.ok is True
    assert deletes == [
        {"table": "quizzes", "filters": {"user_id": f"eq.{INTRUDER}", "id": f"eq.{QUIZ}"}}
    ]


def test_quiz_results_cascade_when_a_quiz_is_deleted():
    """The route relies on the foreign key; fail here if that ever changes."""
    from pathlib import Path

    init = Path(__file__).resolve().parents[2] / "supabase/migrations/20260803120000_init.sql"
    assert "quiz_id uuid not null references public.quizzes(id) on delete cascade" in init.read_text()
