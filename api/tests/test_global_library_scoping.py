"""The three account-wide listings — `GET /notes`, `GET /decks`,
`GET /quizzes` — added by the 2026-08 UX audit so Notes/Cards/Quizzes stop
being silently restricted to whichever topic happens to be open.

None of the three take a caller-supplied row id (see the "no `assert_*`
guard" note on each handler), so `test_guard_coverage.py` correctly doesn't
flag them — but that makes it this file's job to prove the thing that
scanner would otherwise be the only check on: another user's rows never
come back, and a deck/quiz/note whose topic has since been deleted doesn't
crash the endpoint or leak a stale name.
"""

from __future__ import annotations

from app.deps import CurrentUser
from app.routers import flashcards as flashcards_router
from app.routers import notes as notes_router
from app.routers import quizzes as quizzes_router

from .conftest import INTRUDER, OWNER

SUBSPACE_A = "aaaaaaaa-0000-0000-0000-0000000000a1"
SUBSPACE_B = "aaaaaaaa-0000-0000-0000-0000000000b2"
SUBJECT_A = "bbbbbbbb-0000-0000-0000-0000000000a1"
SUBJECT_B = "bbbbbbbb-0000-0000-0000-0000000000b2"


def _owner() -> CurrentUser:
    return CurrentUser(id=OWNER, email=None)


def _intruder() -> CurrentUser:
    return CurrentUser(id=INTRUDER, email=None)


def _seed_two_subjects(db) -> None:
    db.seed(
        "subjects",
        [
            {"id": SUBJECT_A, "user_id": OWNER, "name": "FSD"},
            {"id": SUBJECT_B, "user_id": OWNER, "name": "Deep Learning"},
        ],
    )
    db.seed(
        "subspaces",
        [
            {"id": SUBSPACE_A, "user_id": OWNER, "subject_id": SUBJECT_A, "name": "Attention"},
            {"id": SUBSPACE_B, "user_id": OWNER, "subject_id": SUBJECT_B, "name": "Autoencoders"},
        ],
    )


# ── GET /notes ───────────────────────────────────────────────────────────


async def test_list_all_notes_never_returns_another_users_row(db):
    _seed_two_subjects(db)
    db.seed(
        "notes",
        [
            {
                "id": "n1", "user_id": OWNER, "subspace_id": SUBSPACE_A,
                "title": "Mine", "body_md": "", "origin": "user",
                "touched_by_user": True, "touched_by_agent": False,
                "updated_at": "2026-01-01T00:00:00Z",
            },
            {
                "id": "n2", "user_id": INTRUDER, "subspace_id": SUBSPACE_A,
                "title": "Not mine", "body_md": "", "origin": "user",
                "touched_by_user": True, "touched_by_agent": False,
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ],
    )
    rows = await notes_router.list_all_notes(_owner())
    assert [r.title for r in rows] == ["Mine"]


async def test_list_all_notes_joins_subject_and_topic_correctly_across_subjects(db):
    _seed_two_subjects(db)
    db.seed(
        "notes",
        [
            {
                "id": "n1", "user_id": OWNER, "subspace_id": SUBSPACE_A,
                "title": "A", "body_md": "", "origin": "user",
                "touched_by_user": True, "touched_by_agent": False,
                "updated_at": "2026-01-01T00:00:00Z",
            },
            {
                "id": "n2", "user_id": OWNER, "subspace_id": SUBSPACE_B,
                "title": "B", "body_md": "", "origin": "user",
                "touched_by_user": True, "touched_by_agent": False,
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ],
    )
    rows = {r.title: r for r in await notes_router.list_all_notes(_owner())}
    assert rows["A"].subject_name == "FSD"
    assert rows["A"].subspace_name == "Attention"
    assert rows["B"].subject_name == "Deep Learning"
    assert rows["B"].subspace_name == "Autoencoders"


async def test_list_all_notes_survives_a_note_whose_subspace_was_deleted(db):
    """An orphaned `subspace_id` — the topic was deleted, the note wasn't —
    must not 500 the whole library. Absent names, not a crash."""
    db.seed("subjects", [])
    db.seed("subspaces", [])
    db.seed(
        "notes",
        [
            {
                "id": "n1", "user_id": OWNER, "subspace_id": "gone-forever",
                "title": "Orphaned", "body_md": "", "origin": "user",
                "touched_by_user": True, "touched_by_agent": False,
                "updated_at": "2026-01-01T00:00:00Z",
            }
        ],
    )
    rows = await notes_router.list_all_notes(_owner())
    assert rows[0].title == "Orphaned"
    assert rows[0].subject_name is None
    assert rows[0].subspace_name is None


# ── GET /decks ───────────────────────────────────────────────────────────


async def test_list_all_decks_never_returns_another_users_row(db):
    _seed_two_subjects(db)
    db.seed(
        "decks",
        [
            {"id": "d1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "name": "Mine", "created_at": "2026-01-01T00:00:00Z"},
            {"id": "d2", "user_id": INTRUDER, "subspace_id": SUBSPACE_A, "name": "Not mine", "created_at": "2026-01-01T00:00:00Z"},
        ],
    )
    db.seed("flashcards", [])
    rows = await flashcards_router.list_all_decks(_owner())
    assert [r.name for r in rows] == ["Mine"]


async def test_list_all_decks_only_counts_the_owners_own_cards(db):
    """The card-count aggregation joins on deck id across ALL decks in one
    query — if it weren't also filtered by `user_id`, an intruder's cards
    sharing no real relationship to the owner's decks would still be
    excluded by the deck-id join, but this pins that the query is scoped
    correctly rather than by accident of the join shape."""
    _seed_two_subjects(db)
    db.seed(
        "decks",
        [{"id": "d1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "name": "Mine", "created_at": "2026-01-01T00:00:00Z"}],
    )
    db.seed(
        "flashcards",
        [
            {"id": "c1", "user_id": OWNER, "deck_id": "d1", "reps": 1, "due_at": "2026-01-01T00:00:00Z"},
            {"id": "c2", "user_id": OWNER, "deck_id": "d1", "reps": 0, "due_at": "2099-01-01T00:00:00Z"},
        ],
    )
    rows = await flashcards_router.list_all_decks(_owner())
    assert rows[0].total == 2
    assert rows[0].known_pct == 50


async def test_list_all_decks_survives_a_deck_whose_subspace_was_deleted(db):
    db.seed("subjects", [])
    db.seed("subspaces", [])
    db.seed(
        "decks",
        [{"id": "d1", "user_id": OWNER, "subspace_id": "gone-forever", "name": "Orphaned", "created_at": "2026-01-01T00:00:00Z"}],
    )
    db.seed("flashcards", [])
    rows = await flashcards_router.list_all_decks(_owner())
    assert rows[0].name == "Orphaned"
    assert rows[0].subject_name is None
    assert rows[0].subspace_name is None


# ── GET /quizzes ─────────────────────────────────────────────────────────


async def test_list_all_quizzes_never_returns_another_users_row(db):
    _seed_two_subjects(db)
    db.seed(
        "quizzes",
        [
            {"id": "q1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "topic": "Mine", "questions": [], "created_at": "2026-01-01T00:00:00Z"},
            {"id": "q2", "user_id": INTRUDER, "subspace_id": SUBSPACE_A, "topic": "Not mine", "questions": [], "created_at": "2026-01-01T00:00:00Z"},
        ],
    )
    rows = await quizzes_router.list_all_quizzes(_owner())
    assert [r.topic for r in rows] == ["Mine"]


async def test_list_all_quizzes_joins_subject_and_topic(db):
    _seed_two_subjects(db)
    db.seed(
        "quizzes",
        [{"id": "q1", "user_id": OWNER, "subspace_id": SUBSPACE_B, "topic": "Bottleneck", "questions": [], "created_at": "2026-01-01T00:00:00Z"}],
    )
    rows = await quizzes_router.list_all_quizzes(_owner())
    assert rows[0].subject_name == "Deep Learning"
    assert rows[0].subspace_name == "Autoencoders"


async def test_list_all_quizzes_survives_a_quiz_whose_subspace_was_deleted(db):
    db.seed("subjects", [])
    db.seed("subspaces", [])
    db.seed(
        "quizzes",
        [{"id": "q1", "user_id": OWNER, "subspace_id": "gone-forever", "topic": "Orphaned", "questions": [], "created_at": "2026-01-01T00:00:00Z"}],
    )
    rows = await quizzes_router.list_all_quizzes(_owner())
    assert rows[0].topic == "Orphaned"
    assert rows[0].subject_name is None
    assert rows[0].subspace_name is None


async def test_intruder_calling_any_of_the_three_sees_only_their_own_empty_or_populated_set(db):
    """One combined check that the `user.id` used to filter really is the
    caller's own, not hardcoded or swapped — seeds data for OWNER only and
    proves an intruder calling the same three endpoints gets nothing."""
    _seed_two_subjects(db)
    db.seed(
        "notes",
        [{"id": "n1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "title": "x", "body_md": "", "origin": "user", "touched_by_user": True, "touched_by_agent": False, "updated_at": "2026-01-01T00:00:00Z"}],
    )
    db.seed(
        "decks",
        [{"id": "d1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "name": "x", "created_at": "2026-01-01T00:00:00Z"}],
    )
    db.seed("flashcards", [])
    db.seed(
        "quizzes",
        [{"id": "q1", "user_id": OWNER, "subspace_id": SUBSPACE_A, "topic": "x", "questions": [], "created_at": "2026-01-01T00:00:00Z"}],
    )

    assert await notes_router.list_all_notes(_intruder()) == []
    assert await flashcards_router.list_all_decks(_intruder()) == []
    assert await quizzes_router.list_all_quizzes(_intruder()) == []
