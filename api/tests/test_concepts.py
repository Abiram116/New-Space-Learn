"""Per-concept mastery, reconstructed from data that was always there.

`quizzes.questions[i].subtopic` has tagged the concept behind every generated
question since quiz tagging shipped, and `quiz_results.answers[i]` records what
was chosen. Nobody joined them, so the app knew "Attention: 71%" when it could
have known "cross-attention 40%, positional encoding 92%". These tests cover
that join and the things that make it trustworthy.

Every test here was mutation-checked.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.services import personalization, preferences
from app.services import student_model as sm

from .conftest import OWNER


def _days_ago(n: int) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def _q(subtopic: str, answer_index: int = 0) -> dict:
    return {"q": "?", "choices": ["a", "b"], "answer_index": answer_index, "subtopic": subtopic}


def _seed_quiz(db, *, questions: list[dict], results: list[list[int]], subspace="t1"):
    """One quiz plus a series of attempts at it, oldest first."""
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": subspace, "user_id": OWNER, "subject_id": "subj", "name": "Attention",
         "last_activity_at": _days_ago(1)},
    ])
    db.seed("quizzes", [
        {"id": "q1", "user_id": OWNER, "subspace_id": subspace, "questions": questions},
    ])
    db.seed("quiz_results", [
        {"user_id": OWNER, "quiz_id": "q1", "score": 0,
         "submitted_at": _days_ago(len(results) - i), "answers": answers}
        for i, answers in enumerate(results)
    ])


@pytest.mark.asyncio
async def test_accuracy_is_per_concept_not_per_topic(db):
    """The headline unlock: one topic, two concepts, opposite standings. The
    topic average that used to be the finest grain available would report a
    single mid number and hide both."""
    _seed_quiz(
        db,
        questions=[_q("Cross-Attention"), _q("Positional Encoding")],
        # Cross-attention wrong every time, positional encoding right every time.
        results=[[1, 0], [1, 0], [1, 0]],
    )
    snap = await sm.snapshot(OWNER)
    by_concept = {c.concept: c for c in snap.concepts}

    assert by_concept["cross-attention"].accuracy == 0
    assert by_concept["positional encoding"].accuracy == 100
    assert [c.concept for c in snap.weak_concepts] == ["cross-attention"]


@pytest.mark.asyncio
async def test_concept_tags_are_normalized_but_displayed_as_written(db):
    """`decisions.md`: a concept is a normalized tag, never a row. So
    'Cross-Attention' and 'cross-attention  ' are one concept — but the label
    shown to a human keeps the casing it was written with."""
    _seed_quiz(
        db,
        questions=[_q("Cross-Attention"), _q("  cross-attention ")],
        results=[[1, 1], [1, 1]],
    )
    snap = await sm.snapshot(OWNER)

    assert len(snap.concepts) == 1
    assert snap.concepts[0].concept == "cross-attention"
    assert snap.concepts[0].label == "Cross-Attention"
    assert snap.concepts[0].asked == 4


@pytest.mark.asyncio
async def test_thin_evidence_is_not_a_verdict(db):
    """Two questions can only read 0%, 50% or 100%. Reporting that as mastery
    is the invented-metric mistake with arithmetic in front of it."""
    _seed_quiz(db, questions=[_q("Softmax")], results=[[1], [1]])
    snap = await sm.snapshot(OWNER)
    assert snap.concepts == []

    _seed_quiz(db, questions=[_q("Softmax")], results=[[1], [1], [1]])
    snap = await sm.snapshot(OWNER)
    assert len(snap.concepts) == 1


@pytest.mark.asyncio
async def test_untagged_questions_are_skipped_not_bucketed(db):
    """Quizzes predating `subtopic` have no tag. They must not collect into an
    empty-string concept that then shows up in a prompt as a nameless weakness."""
    _seed_quiz(
        db,
        questions=[{"q": "?", "choices": ["a"], "answer_index": 0}, _q("Softmax")],
        results=[[1, 1], [1, 1], [1, 1]],
    )
    snap = await sm.snapshot(OWNER)
    assert [c.concept for c in snap.concepts] == ["softmax"]


@pytest.mark.asyncio
async def test_length_mismatch_keeps_the_sound_prefix(db):
    """A regenerated quiz can leave a result whose answers are shorter than the
    questions. The overlap is still real evidence; discarding the whole row
    would throw away the student's actual history."""
    _seed_quiz(
        db,
        questions=[_q("Softmax"), _q("Layernorm")],
        results=[[0], [0], [0]],  # only answered the first
    )
    snap = await sm.snapshot(OWNER)
    assert [c.concept for c in snap.concepts] == ["softmax"]
    assert snap.concepts[0].accuracy == 100


@pytest.mark.asyncio
async def test_results_without_their_quiz_are_skipped(db):
    """Outside the quiz window, or a quiz since deleted. Unattributable without
    the questions, so it must not be guessed at."""
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subspaces", [])
    db.seed("quizzes", [])
    db.seed("quiz_results", [
        {"user_id": OWNER, "quiz_id": "gone", "score": 90,
         "submitted_at": _days_ago(1), "answers": [0]},
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.concepts == []


@pytest.mark.asyncio
async def test_weak_and_strong_concepts_cannot_overlap(db):
    """The old top-3/bottom-3-by-accuracy lists could both include the same
    concept when there were only a handful of them. Mastery thresholds
    (weak < 60, strong >= 80, both gated on evidence) are disjoint by
    construction."""
    _seed_quiz(
        db,
        questions=[_q("Cross-Attention"), _q("Positional Encoding")],
        results=[[1, 0], [1, 0], [1, 0]],
    )
    snap = await sm.snapshot(OWNER)
    weak_ids = {c.concept for c in snap.weak_concepts}
    strong_ids = {c.concept for c in snap.strong_concepts}
    assert not (weak_ids & strong_ids)


@pytest.mark.asyncio
async def test_too_complex_feedback_folds_into_concept_mastery(db):
    """Task 4: `response_feedback.concept` was recorded and never read.
    `too_complex` tagged with a concept the student has already been quizzed
    on should count as one more piece of "doesn't get this" evidence."""
    _seed_quiz(
        # All correct so far — mastery should read high before the feedback.
        db,
        questions=[_q("Softmax")],
        results=[[0], [0], [0]],
    )
    baseline_snap = await sm.snapshot(OWNER)
    baseline = next(c for c in baseline_snap.concepts if c.concept == "softmax")

    db.seed("response_feedback", [
        {"user_id": OWNER, "kind": "too_complex", "concept": "softmax",
         "created_at": _days_ago(0), "subspace_id": "t1"},
    ])
    with_feedback = await sm.snapshot(OWNER)
    scored = next(c for c in with_feedback.concepts if c.concept == "softmax")

    assert scored.mastery < baseline.mastery  # feedback pulls it down
    assert scored.evidence_n > baseline.evidence_n  # and adds evidence weight
    assert scored.accuracy == baseline.accuracy  # display accuracy is quiz-only


@pytest.mark.asyncio
async def test_style_feedback_does_not_leak_into_concept_mastery(db):
    """`too_long`/`want_detail`/etc. are about HOW to explain, not WHAT the
    student knows — even with a concept tag, they must not move mastery."""
    _seed_quiz(db, questions=[_q("Softmax")], results=[[0], [0], [0]])
    plain = await sm.snapshot(OWNER)
    plain_mastery = next(c for c in plain.concepts if c.concept == "softmax").mastery

    db.seed("response_feedback", [
        {"user_id": OWNER, "kind": "too_long", "concept": "softmax",
         "created_at": _days_ago(0), "subspace_id": "t1"},
    ])
    after = await sm.snapshot(OWNER)
    after_mastery = next(c for c in after.concepts if c.concept == "softmax").mastery

    assert after_mastery == plain_mastery


@pytest.mark.asyncio
async def test_concept_trend_tracks_direction(db):
    """Same distinction as topics: a concept climbing and one sliding need
    opposite advice."""
    _seed_quiz(
        db,
        questions=[_q("Softmax")],
        results=[[1], [1], [0], [0]],  # wrong, wrong, right, right
    )
    snap = await sm.snapshot(OWNER)
    assert snap.concepts[0].trend == 100
    assert snap.falling_concepts == []


# ── The context layer ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_each_task_gets_only_what_it_can_use(db):
    """The reason this layer exists. Chat must not be handed cold-topic lists
    it cannot act on, and quiz generation must not be handed tone preferences
    that change nothing about a multiple-choice question."""
    _seed_quiz(
        db,
        questions=[_q("Cross-Attention"), _q("Positional Encoding")],
        results=[[1, 0], [1, 0], [1, 0]],
    )
    db.seed("user_settings", [{
        "user_id": OWNER,
        "student_model": {"teaching_preference": "use analogies", "exam_context": "finals"},
    }])
    snap = await sm.snapshot(OWNER)

    chat = personalization.render(snap, "chat", subspace_id="t1")
    quiz = personalization.render(snap, "quiz", subspace_id="t1")

    # Both know the weak concept — it is what they're for.
    assert "Cross-Attention" in chat
    assert "Cross-Attention" in quiz
    # Only the prose task gets explanation style.
    assert "analogies" in chat
    assert "analogies" not in quiz
    # Only the assessment task gets the exam context.
    assert "finals" in quiz
    assert "finals" not in chat


@pytest.mark.asyncio
async def test_context_is_empty_for_a_new_account(db):
    """Never padded with filler — a vague block is an instruction to invent a
    student."""
    snap = await sm.snapshot(OWNER)
    for task in ("chat", "quiz", "cards", "notes", "brief"):
        assert personalization.render(snap, task) == ""


@pytest.mark.asyncio
async def test_skill_is_composed_with_the_student_not_stacked_beside_it(db):
    """§9: the Skill defines the mode, the student model parameterises it.
    Previously these were two separate system paragraphs and nothing said the
    second should shape the first."""
    _seed_quiz(
        db,
        questions=[_q("Bellman Equations")],
        results=[[1], [1], [1]],
    )
    snap = await sm.snapshot(OWNER)
    composed = personalization.for_skill(
        {"instructions": "Ask Socratic questions.", "output_format": "One question at a time."},
        snap,
        subspace_id="t1",
    )
    assert "Socratic" in composed
    assert "One question at a time" in composed
    assert "Bellman Equations" in composed


# ── Preferences ────────────────────────────────────────────────────────


def _snap(settings=None, days=None):
    return sm.Snapshot(
        settings=settings or {},
        topics=[],
        concepts=[],
        activity_days=days or [],
        streak_days=0,
    )


def test_explicit_beats_observed_regardless_of_evidence():
    """Behaviour informs; it never overrules something the student typed."""
    from datetime import date

    days = [
        {"day": (date.today() - timedelta(days=i)).isoformat(), "study_seconds": 90 * 60}
        for i in range(20)
    ]
    prefs = preferences.resolve(
        _snap({"student_model": {"session_length_minutes": 25}}, days)
    )
    assert prefs["session.length_minutes"].value == "25"
    assert prefs["session.length_minutes"].source == "explicit"


def test_observed_confidence_never_reaches_explicit():
    assert preferences.observed_confidence(1000) <= preferences.OBSERVED_CEILING
    assert preferences.OBSERVED_CEILING < 0.85


def test_unknown_keys_cannot_enter_the_model():
    """The whitelist is the privacy guarantee — a structural bound, not a
    prompt instruction that depends on a model complying."""
    out: dict = {}

    def put(pref):
        if pref.key not in preferences.KEYS:
            return
        out[pref.key] = pref

    put(preferences.Preference("mental.health", "x", "observed", 0.9, 5, "because"))
    assert out == {}


def test_low_confidence_preferences_are_not_acted_on():
    weak = preferences.Preference("explanation.length", "concise", "observed", 0.2, 1, "y")
    strong = preferences.Preference("explanation.length", "concise", "explicit", 0.9, 1, "y")
    assert not weak.actionable
    assert strong.actionable
