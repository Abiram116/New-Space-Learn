"""Retaking a quiz reworded, adding to a quiz or deck, and choosing what a
quiz or deck is written from (files, notes, chat, or — only when asked —
general knowledge)."""

from __future__ import annotations

import json
import random
from collections import Counter
from types import SimpleNamespace

import pytest

from app.config import settings
from app.deps import CurrentUser
from app.errors import NotFound, NothingIndexed, RateLimited, ValidationFailed
from app.routers import flashcards as flashcards_router
from app.routers import quizzes as quizzes_router
from app.schemas import CardsExtend, QuizExtend, QuizGenerate, QuizQuestion
from app.services import card_writer, coverage, question_checks, quiz_agent
from app.services.coverage import Source

from .conftest import INTRUDER, OWNER

QUIZ = "cccccccc-0000-0000-0000-0000000000c1"
DECK = "dddddddd-0000-0000-0000-0000000000d1"
TOPIC = "aaaaaaaa-0000-0000-0000-0000000000a1"
NOTE = "eeeeeeee-0000-0000-0000-0000000000e1"


def _user(user_id: str = OWNER) -> CurrentUser:
    return CurrentUser(id=user_id, email=None)


def _question(i: int, **extra) -> dict:
    return {
        "q": f"Which statement about momentum term {i} is right?",
        "choices": [f"right answer {i}", f"wrong answer one {i}", f"wrong answer two {i}", f"wrong answer three {i}"],
        "answer_index": 0,
        "subtopic": f"concept {i}",
        "explanation": "Because the source says exactly this.",
        "misconceptions": [None, "m-a", "m-b", "m-c"],
        **extra,
    }


class Script:
    """A fake model: replies in order, and records every call."""

    def __init__(self, *replies) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, str, bool]] = []

    async def __call__(self, messages, model, temperature, json_object=False):
        self.calls.append((model, messages[-1]["content"], json_object))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


# ── The rewording guard ────────────────────────────────────────────────

ORIGINAL = {
    "q": "Which of these is NOT a reason the learning rate of 0.1 diverges?",
    "choices": ["It is too small", "It overshoots the minimum", "Steps grow each update", "The loss climbs"],
    "answer_index": 0,
}


def _reworded(**change) -> dict:
    return {"q": ORIGINAL["q"], "choices": list(ORIGINAL["choices"]), **change}


def test_a_faithful_rewording_passes():
    new = _reworded(
        q="Which option is not a cause of a 0.1 learning rate diverging?",
        choices=["Its value is too low", "It jumps past the minimum", "Each update's step gets larger", "Loss keeps rising"],
    )
    assert question_checks.reword_problems(ORIGINAL, new) == []


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        ({"q": "Which of these is NOT a reason the learning rate of 0.01 diverges?"}, "the question's facts changed"),
        ({"q": "Which of these is a reason the learning rate of 0.1 diverges?"}, "the question's facts changed"),
        ({"choices": ["It overshoots the minimum", "It is too small", "Steps grow each update", "The loss climbs"]}, "reads like"),
        ({"choices": ["It is too small", "It is too small", "Steps grow", "The loss climbs"]}, "an empty or repeated choice"),
        ({"choices": ["It is too small", "It overshoots"]}, "the choices don't line up"),
        ({"choices": ["It is too small " * 6, "It overshoots the minimum", "Steps grow each update", "The loss climbs"]}, "changed size"),
    ],
)
def test_a_rewording_that_changes_a_fact_is_caught(change, problem):
    found = question_checks.reword_problems(ORIGINAL, _reworded(**change))
    assert any(problem in p for p in found), found


def test_math_must_survive_a_rewording():
    original = {"q": "What is the derivative of $x^2$ at a point?", "choices": ["$2x$", "$x$", "$x^2$", "$2$"], "answer_index": 0}
    same = {"q": "At a point, what does $x^2$ differentiate to?", "choices": ["$2x$", "$x$", "$x^2$", "$2$"]}
    changed = {"q": "At a point, what does $x^3$ differentiate to?", "choices": ["$2x$", "$x$", "$x^2$", "$2$"]}
    assert question_checks.reword_problems(original, same) == []
    assert "the question's facts changed" in question_checks.reword_problems(original, changed)


# ── The reworded retake ────────────────────────────────────────────────


def _stored(n: int = 5) -> list[QuizQuestion]:
    return [QuizQuestion(**_question(i)) for i in range(n)]


def test_a_retake_maps_every_answer_back_to_the_stored_quiz():
    stored = _stored(6)
    for seed in range(15):
        out = quiz_agent.shuffled(stored, rng=random.Random(seed))
        assert sorted(v.original_index for v in out.questions) == list(range(6))
        for v in out.questions:
            original = stored[v.original_index]
            assert [original.choices[j] for j in v.choice_order] == v.choices
            # The right answer here is the right answer there.
            assert v.choice_order[v.answer_index] == original.answer_index
            assert v.misconceptions == [original.misconceptions[j] for j in v.choice_order]
            assert v.misconceptions[v.answer_index] is None


async def test_rewording_is_one_small_model_call_and_a_bad_rewording_keeps_the_stored_wording():
    stored = _stored(2)
    good = {"n": 1, "q": "For momentum term 0, which claim holds true?", "choices": [
        "correct reply 0", "mistaken reply one 0", "mistaken reply two 0", "mistaken reply three 0"]}
    # Question 2's "right" choice is now what its first wrong one said.
    bad = {"n": 2, "q": "For momentum term 1, which claim holds true?", "choices": [
        "wrong answer one 1", "right answer 1", "wrong answer two 1", "wrong answer three 1"]}
    script = Script(json.dumps({"items": [good, bad]}))
    out = await quiz_agent.reword_quiz(stored, complete=script, rng=random.Random(3))
    assert len(script.calls) == 1
    model, prompt, json_object = script.calls[0]
    assert model == settings.groq_model_fast and json_object
    assert "SAME order" in prompt
    by_origin = {v.original_index: v for v in out.questions}
    assert by_origin[0].reworded and by_origin[0].q.startswith("For momentum term 0")
    assert not by_origin[1].reworded and by_origin[1].q == stored[1].q
    assert out.reworded == 1
    # Whatever was accepted, the right answer still points at the right text.
    assert by_origin[0].choices[by_origin[0].answer_index] == "correct reply 0"
    assert by_origin[1].choices[by_origin[1].answer_index] == "right answer 1"


async def test_a_reply_that_is_not_json_rewords_nothing_and_still_reshuffles():
    out = await quiz_agent.reword_quiz(_stored(3), complete=Script("sorry, I can't"))
    assert out.reworded == 0 and len(out.questions) == 3


# ── Notes as material ──────────────────────────────────────────────────


def test_a_note_loses_its_images_and_markup_but_keeps_its_math():
    body = (
        "# Gradients\n\n![diagram](data:image/png;base64,AAAABBBBCCCC)\n\n"
        "<p>The slope of $f(x)=x^2$ is $2x$ &amp; it grows.</p>\n\n"
        "$$\\int_0^1 x\\,dx = \\tfrac12$$"
    )
    text = quiz_agent.clean_note(body)
    assert "base64" not in text and "<p>" not in text and "diagram" not in text
    assert "$f(x)=x^2$" in text and "$2x$" in text and "& it grows" in text
    assert "$$\\int_0^1 x\\,dx = \\tfrac12$$" in text


def test_a_long_note_is_spread_inside_the_budget_not_read_from_the_top():
    sections = [f"## Part {i}\n\n" + (f"Fact number {i} is explained here in plenty of words. " * 18) for i in range(30)]
    sources = quiz_agent.note_sources([{"title": "Huge", "body_md": "\n\n".join(sections)}])
    assert 1 < len(sources) <= coverage.MAX_SOURCES
    assert sum(len(s.content) for s in sources) <= coverage.BUDGET_CHARS
    parts = [int(s.locator.split()[-1]) for s in sources]
    assert parts[0] == 0 and parts[-1] > 15  # the end of the note is reached too
    assert all(s.label.startswith("Note: Huge") and s.chunk_id == "" for s in sources)


def test_a_focus_picks_the_parts_of_the_note_about_it():
    body = "\n\n".join(
        [f"## Topic {i}\n\n" + ("Plain filler sentence about nothing much. " * 25) for i in range(12)]
        + ["## Krebs\n\nThe Krebs cycle runs in the mitochondrial matrix and makes NADH."]
    )
    sources = quiz_agent.note_sources([{"title": "Bio", "body_md": body}], focus="Krebs cycle")
    assert any("Krebs" in s.content for s in sources)


def test_an_empty_or_image_only_note_has_nothing_to_write_from():
    assert quiz_agent.note_sources([{"title": "x", "body_md": "![a](data:image/png;base64,AAAA)"}]) == []
    assert quiz_agent.note_sources([]) == []


# ── Choosing the source ────────────────────────────────────────────────


@pytest.fixture
def no_files(monkeypatch: pytest.MonkeyPatch):
    async def plan(**_):
        return []

    monkeypatch.setattr(coverage, "plan", plan)


@pytest.fixture
def some_files(monkeypatch: pytest.MonkeyPatch):
    async def plan(**_):
        return [Source(1, "chunk-a", "notes.pdf", "p. 1", "Momentum adds a fraction of the last update.")]

    monkeypatch.setattr(coverage, "plan", plan)


async def gather(source, *, note_id=None, conversation="", topic=None):
    return await quiz_agent.gather_material(
        user_id=OWNER, subspace_id=TOPIC, source=source, note_id=note_id, topic=topic, count=5,
        used=Counter(), weak_concepts=[], linked_ids=[], conversation=conversation,
    )


async def test_files_with_none_ready_says_what_to_add(db, no_files):
    with pytest.raises(NothingIndexed) as e:
        await gather("files", conversation="user: hi")
    assert "no files" in e.value.message and "notes or the chat" in e.value.message


async def test_files_does_not_quietly_mix_in_the_chat(db, some_files):
    m = await gather("files", conversation="user: something else")
    assert m.conversation == "" and len(m.sources) == 1


async def test_no_source_picked_is_the_old_behaviour(db, no_files):
    m = await gather(None, conversation="user: talk")
    assert m.conversation == "user: talk"
    with pytest.raises(NothingIndexed):
        await gather(None)


async def test_chat_with_no_conversation_says_so(db, some_files):
    with pytest.raises(NothingIndexed) as e:
        await gather("chat")
    assert "no chat" in e.value.message
    m = await gather("chat", conversation="assistant: " + "x" * 9000)
    assert m.sources == [] and len(m.conversation) <= coverage.BUDGET_CHARS + 1


async def test_one_note_must_be_the_callers_and_still_exist(db):
    db.seed("notes", [{"id": NOTE, "user_id": INTRUDER, "subspace_id": TOPIC, "title": "Theirs", "body_md": "A" * 200}])
    with pytest.raises(NotFound):
        await gather("notes", note_id=NOTE)
    db.seed("notes", [{"id": NOTE, "user_id": OWNER, "subspace_id": TOPIC, "title": "Mine", "body_md": "   "}])
    with pytest.raises(NothingIndexed) as e:
        await gather("notes", note_id=NOTE)
    assert "empty" in e.value.message
    db.seed("notes", [{"id": NOTE, "user_id": OWNER, "subspace_id": TOPIC, "title": "Mine", "body_md": "Mitochondria make ATP from glucose and oxygen."}])
    m = await gather("notes", note_id=NOTE)
    assert m.sources[0].label == "Note: Mine" and m.kind == "note"


async def test_every_note_in_the_topic_or_a_message_when_there_are_none(db):
    with pytest.raises(NothingIndexed) as e:
        await gather("notes")
    assert "no notes" in e.value.message
    db.seed("notes", [
        {"id": "n1", "user_id": OWNER, "subspace_id": TOPIC, "title": "One", "body_md": "Osmosis moves water across a membrane by itself."},
        {"id": "n2", "user_id": OWNER, "subspace_id": TOPIC, "title": "Two", "body_md": "Diffusion moves solutes down a concentration gradient."},
    ])
    m = await gather("notes")
    assert {s.label for s in m.sources} == {"Note: One", "Note: Two"}


async def test_general_knowledge_only_when_asked_and_every_question_says_so(db):
    m = await gather("general")
    assert m.general and m.sources == []
    item = {**_question(1), "source": 0}
    script = Script("TITLE: Momentum\n" + json.dumps([item]), json.dumps({"verdicts": [{"n": 1, "supported": True, "correct": True}]}))

    async def no_embed(texts):
        return [[1.0, 0.0] for _ in texts]

    draft = await quiz_agent.write_quiz(
        count=1, topic="momentum", label="Optimisation", mix={"easy": 1, "medium": 0, "hard": 0}, sources=[],
        conversation="", earlier=[], general=True, complete=script, embed=no_embed,
    )
    assert "no source material" in script.calls[0][1] and "Sources:" not in script.calls[0][1]
    assert "general knowledge" in script.calls[1][1]
    assert draft.questions[0].source == quiz_agent.GENERAL_LABEL

    cards = await card_writer.write_deck(
        count=1, topic="momentum", label="Optimisation", sources=[], conversation="", earlier=[], general=True,
        complete=lambda *a, **k: _reply("TITLE: Momentum\n" + json.dumps([{"front": "What does momentum add?", "back": "A fraction of the last update."}])),
    )
    assert cards.cards[0].source == quiz_agent.GENERAL_LABEL


async def _reply(text: str) -> str:
    return text


# ── Adding to a quiz ───────────────────────────────────────────────────


def _quiz_row(n: int = 3, user: str = OWNER) -> dict:
    return {
        "id": QUIZ, "user_id": user, "subspace_id": TOPIC, "topic": "Momentum",
        "created_at": "2026-09-01T00:00:00+00:00", "questions": [_question(i) for i in range(n)],
    }


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "groq_api_key", "test-key")


@pytest.fixture
def quiet_reads(monkeypatch: pytest.MonkeyPatch):
    """Everything around the writer that is not under test."""
    from app.services import personalization, rag, student_model

    snap = SimpleNamespace(topics=[], concepts_in=lambda _sid: [])

    async def linked(*_):
        return []

    async def ledger(*_):
        return Counter(), [{"q": "An earlier quiz's question?", "choices": ["a", "b", "c", "d"], "answer_index": 0}]

    async def history(*_a, **_k):
        return []

    async def snapshot(*_):
        return snap

    monkeypatch.setattr(rag, "linked_subspace_ids", linked)
    monkeypatch.setattr(coverage, "ledger", ledger)
    monkeypatch.setattr(card_writer, "ledger", ledger)
    monkeypatch.setattr(quizzes_router, "recent_history", history)
    monkeypatch.setattr(flashcards_router, "recent_history", history)
    monkeypatch.setattr(student_model, "snapshot", snapshot)
    monkeypatch.setattr(personalization, "render", lambda *a, **k: "")


async def test_more_questions_go_at_the_end_and_the_quiz_is_the_writers_avoid_list(
    db, configured, quiet_reads, some_files, monkeypatch
):
    db.seed("quizzes", [_quiz_row(3)])
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])
    seen = {}

    async def write_quiz(**kw):
        seen.update(kw)
        return quiz_agent.Draft([QuizQuestion(**_question(10)), QuizQuestion(**_question(11))], "x")

    monkeypatch.setattr(quiz_agent, "write_quiz", write_quiz)
    out = await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=2, source="files"), _user())
    assert [q.subtopic for q in out.questions[:3]] == ["concept 0", "concept 1", "concept 2"]
    assert {q.subtopic for q in out.questions[3:]} == {"concept 10", "concept 11"}
    assert seen["count"] == 2 and seen["topic"] == "Momentum"
    assert [q["subtopic"] for q in seen["earlier"][:3]] == ["concept 0", "concept 1", "concept 2"]
    assert seen["earlier"][3]["q"] == "An earlier quiz's question?"
    patch = db.updates[-1]
    assert patch["filters"] == {"user_id": f"eq.{OWNER}", "id": f"eq.{QUIZ}"} and len(patch["patch"]["questions"]) == 5


async def test_a_quiz_is_not_grown_past_its_cap_and_a_full_one_says_so(db, configured, quiet_reads, some_files, monkeypatch):
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])
    asked = {}

    async def write_quiz(**kw):
        asked["count"] = kw["count"]
        return quiz_agent.Draft([QuizQuestion(**_question(99))], "x")

    monkeypatch.setattr(quiz_agent, "write_quiz", write_quiz)
    db.seed("quizzes", [_quiz_row(quizzes_router.MAX_QUIZ_QUESTIONS - 1)])
    await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=5), _user())
    assert asked["count"] == 1
    db.seed("quizzes", [_quiz_row(quizzes_router.MAX_QUIZ_QUESTIONS)])
    with pytest.raises(ValidationFailed):
        await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=5), _user())


async def test_someone_elses_quiz_cannot_be_added_to(db, configured):
    db.seed("quizzes", [_quiz_row(3, user=INTRUDER)])
    with pytest.raises(NotFound):
        await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=2), _user())


async def test_a_second_click_while_the_first_is_writing_is_refused(db, configured):
    db.seed("quizzes", [_quiz_row(3)])
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])
    quizzes_router._extending.add(f"{OWNER}:{QUIZ}")
    try:
        with pytest.raises(RateLimited):
            await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=2), _user())
    finally:
        quizzes_router._extending.clear()


async def test_nothing_new_to_add_is_said_not_appended(db, configured, quiet_reads, some_files, monkeypatch):
    from app.errors import UpstreamUnavailable

    db.seed("quizzes", [_quiz_row(3)])
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])

    async def write_quiz(**_):
        return quiz_agent.Draft([], None)

    monkeypatch.setattr(quiz_agent, "write_quiz", write_quiz)
    with pytest.raises(UpstreamUnavailable, match="already in the quiz"):
        await quizzes_router.extend_quiz(QUIZ, QuizExtend(count=2), _user())
    assert db.updates == []
    assert quizzes_router._extending == set()


async def test_a_new_quiz_from_an_empty_source_costs_no_model_call(db, configured, quiet_reads, no_files, monkeypatch):
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])

    async def write_quiz(**_):
        raise AssertionError("the model must not be asked")

    monkeypatch.setattr(quiz_agent, "write_quiz", write_quiz)
    with pytest.raises(NothingIndexed, match="no files"):
        await quizzes_router.generate_quiz(TOPIC, QuizGenerate(count=5, source="files"), _user())


# ── Rewording endpoint ─────────────────────────────────────────────────


async def test_a_failed_rewording_is_still_a_reshuffled_retake_with_a_note(db, configured, monkeypatch):
    db.seed("quizzes", [_quiz_row(4)])

    async def broken(*_a, **_k):
        raise TimeoutError

    monkeypatch.setattr(quiz_agent, "reword_quiz", broken)
    out = await quizzes_router.reword_quiz(QUIZ, _user())
    assert len(out.questions) == 4 and out.reworded == 0
    assert "reshuffled" in (out.note or "")
    assert db.inserts == [] and db.updates == []  # nothing is stored


async def test_rewording_someone_elses_quiz_is_not_found(db, configured):
    db.seed("quizzes", [_quiz_row(3, user=INTRUDER)])
    with pytest.raises(NotFound):
        await quizzes_router.reword_quiz(QUIZ, _user())


# ── Adding to a deck ───────────────────────────────────────────────────


async def test_more_cards_skip_what_the_deck_has_and_land_in_that_deck(db, configured, quiet_reads, some_files, monkeypatch):
    db.seed("decks", [{"id": DECK, "user_id": OWNER, "subspace_id": TOPIC, "name": "Missed: Momentum"}])
    db.seed("subspaces", [{"id": TOPIC, "user_id": OWNER, "name": "Optimisation"}])
    db.seed("flashcards", [{"id": "c1", "user_id": OWNER, "deck_id": DECK, "front": "What does momentum add?", "back": "A fraction."}])
    seen = {}

    async def write_deck(**kw):
        seen.update(kw)
        return card_writer.Deck([card_writer.Card("Why can a big learning rate diverge?", "It overshoots.", "notes.pdf", "chunk-a")])

    monkeypatch.setattr(card_writer, "write_deck", write_deck)
    from app.services import supabase as supabase_module

    async def insert(table, rows):
        db.inserts.append({"table": table, "rows": rows})
        defaults = {"ease": 2.5, "interval_days": 0, "reps": 0, "due_at": "2026-10-01T00:00:00+00:00"}
        return [{"id": f"new-{i}", **defaults, **r} for i, r in enumerate(rows)]

    monkeypatch.setattr(supabase_module, "db_insert", insert)
    out = await flashcards_router.extend_deck(DECK, CardsExtend(count=3, source="files"), _user())
    assert seen["topic"] == "Momentum"
    assert seen["earlier"][0]["front"] == "What does momentum add?"
    assert [c.front for c in out] == ["Why can a big learning rate diverge?"]
    assert db.inserts[-1]["rows"][0]["deck_id"] == DECK


async def test_someone_elses_deck_cannot_be_added_to(db, configured):
    db.seed("decks", [{"id": DECK, "user_id": INTRUDER, "subspace_id": TOPIC, "name": "Theirs"}])
    with pytest.raises(NotFound):
        await flashcards_router.extend_deck(DECK, CardsExtend(count=3), _user())
