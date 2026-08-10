"""The student model's derived signals.

These are the numbers the brief, every agent prompt and the Home suggestion are
built on, so a wrong one is wrong in four places at once and none of them look
like a bug — they look like the tutor being slightly off. That is exactly the
class of failure worth a test.

Every test here was mutation-checked: the implementation was broken on purpose
and the test confirmed red before being kept.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.services import student_model as sm
from app.services.student_model import TopicView

from .conftest import OWNER


def _days_ago(n: int) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def _topic(**kwargs) -> TopicView:
    """A TopicView with everything neutral, so each test states only the one
    field it is actually about."""
    base = dict(
        subspace_id="s1",
        subject_id="sub1",
        subject="Machine Learning",
        topic="Attention",
        quiz_average=None,
        quiz_attempts=0,
        trend=None,
        days_since_activity=None,
        cards_due=0,
        cards_total=0,
        notes=0,
        docs=0,
    )
    base.update(kwargs)
    return TopicView(**base)


# ── Trend ──────────────────────────────────────────────────────────────


def test_trend_needs_four_attempts():
    """Three points is an average, not a direction."""
    assert sm._trend([90, 70, 50]) is None
    assert sm._trend([90, 80, 70, 60]) is not None


def test_trend_compares_halves_not_endpoints():
    """[80, 40, 80, 80] ends where it started, and a first-vs-last comparison
    would call that flat. The halves say +20, which is the honest read: one bad
    quiz early, two good ones since."""
    assert sm._trend([80, 40, 80, 80]) == 20


def test_trend_is_negative_when_declining():
    assert sm._trend([90, 90, 60, 60]) == -30


# ── The distinction the whole feature exists for ───────────────────────


def test_falling_and_weak_are_different_topics():
    """A topic climbing from 40 to 55 and one sliding from 85 to 70 need
    opposite advice. An average alone cannot tell them apart — which is why
    the old model, which had only averages, could not say anything useful."""
    climbing = _topic(subspace_id="climb", quiz_average=55, quiz_attempts=4, trend=15)
    sliding = _topic(subspace_id="slide", quiz_average=78, quiz_attempts=4, trend=-15)
    snap = sm.Snapshot(settings={}, concepts=[], topics=[climbing, sliding], activity_days=[], streak_days=0)

    assert [t.subspace_id for t in snap.weak_areas][0] == "climb"
    assert [t.subspace_id for t in snap.falling] == ["slide"]


def test_small_moves_are_not_trends():
    """Five-question quizzes move 20 points for one extra right answer, so a
    single-digit drift must not be reported as a slide."""
    assert not _topic(trend=-(sm.TREND_THRESHOLD - 1)).is_falling
    assert _topic(trend=-sm.TREND_THRESHOLD).is_falling


# ── Cold, untouched, and the difference ────────────────────────────────


def test_cold_requires_history_and_silence():
    studied_recently = _topic(notes=1, days_since_activity=2)
    studied_then_dropped = _topic(notes=1, days_since_activity=sm.COLD_AFTER_DAYS)
    never_started = _topic(docs=3, days_since_activity=90)

    assert not studied_recently.is_cold
    assert studied_then_dropped.is_cold
    # Nothing was forgotten here — it was never begun. Calling this "cold"
    # would have the brief say "you've stopped studying X" about something the
    # student never started.
    assert not never_started.is_cold
    assert never_started.is_untouched


def test_untouched_needs_material():
    """An empty topic someone created and abandoned has nothing to say about
    it. Only material sitting unused is worth surfacing."""
    assert not _topic(docs=0, days_since_activity=90).is_untouched


def test_cold_boundary_is_past_a_week():
    """A student who studies on Sundays must not be told on Tuesday that they
    have abandoned something."""
    assert sm.COLD_AFTER_DAYS > 7


# ── Neglected subjects ─────────────────────────────────────────────────


def test_neglected_subject_needs_a_rival():
    """"You haven't studied your only subject" is not an insight. The signal
    only means something when one subject lost the week to another."""
    only = _topic(subject_id="a", subject="Stats", notes=1, days_since_activity=30)
    snap = sm.Snapshot(settings={}, concepts=[], topics=[only], activity_days=[], streak_days=0)
    assert snap.neglected_subjects == []

    active = _topic(subspace_id="s2", subject_id="b", subject="ML", notes=1, days_since_activity=1)
    snap = sm.Snapshot(settings={}, concepts=[], topics=[only, active], activity_days=[], streak_days=0)
    assert snap.neglected_subjects == ["Stats"]


# ── Observed habits ────────────────────────────────────────────────────


def _active_day(n: int, **counts) -> dict:
    row = {"day": (date.today() - timedelta(days=n)).isoformat(), "chat_messages": 0,
           "cards_reviewed": 0, "quizzes_taken": 0, "study_seconds": 0}
    row.update(counts)
    return row


def test_habits_stay_silent_until_there_is_a_habit():
    """Three active days is a start, not a pattern. Describing it as one is
    the invented-metric mistake in prose form."""
    days = [_active_day(i, chat_messages=5) for i in range(3)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    assert snap.observed_habits == []


def test_habits_count_days_not_events():
    """400 cards reviewed against 3 quizzes taken is a comparison of different
    units. Days on which each happened is comparable, so that is what's
    counted — here chat happens on 6 days, cards on 6, so neither dominates
    and no preference is claimed."""
    days = [_active_day(i, chat_messages=1, cards_reviewed=200) for i in range(6)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    habits = " ".join(snap.observed_habits)
    assert "asking questions" not in habits
    assert "Drills with flashcards" not in habits


def test_habit_reports_a_real_dominance():
    days = [_active_day(i, chat_messages=3) for i in range(6)]
    days += [_active_day(i + 6, cards_reviewed=10) for i in range(2)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    assert any("asking questions" in h for h in snap.observed_habits)


def test_untested_knowledge_is_flagged():
    days = [_active_day(i, chat_messages=3) for i in range(8)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    assert any("not taken a quiz" in h for h in snap.observed_habits)


def test_session_length_is_the_median_not_the_mean():
    """One four-hour cram must not become "your typical session is 70
    minutes"."""
    days = [_active_day(i, study_seconds=20 * 60) for i in range(4)]
    days.append(_active_day(9, study_seconds=240 * 60))
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    assert any("about 20 minutes" in h for h in snap.observed_habits)


# ── Observations are never asserted as preferences ─────────────────────


def test_observations_do_not_leak_into_explicit_fields():
    """The explicit fields are the student's own words, shown back to them in
    Settings. An inference written into `learning_style` would make the app
    display a sentence they never wrote as if they had."""
    days = [_active_day(i, chat_messages=3) for i in range(8)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    model = snap.to_model()

    assert model.observed_habits  # something WAS observed
    assert model.learning_style is None
    assert model.teaching_preference is None


def test_prompt_block_labels_observations_as_observations():
    days = [_active_day(i, chat_messages=3) for i in range(8)]
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=days, streak_days=0)
    block = sm.format_for_prompt(snap.to_model())
    assert "not something they told you" in block


def test_prompt_block_is_empty_when_nothing_is_known():
    """Never pads with generic filler — an empty block is honest, a vague one
    tells the model to invent a student."""
    snap = sm.Snapshot(settings={}, concepts=[], topics=[], activity_days=[], streak_days=0)
    assert sm.format_for_prompt(snap.to_model()) == ""


# ── The read pass ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_aggregates_across_every_subject(db):
    """The headline claim of the rewrite: one pass, every subject and topic,
    with per-topic counts folded in from four different tables."""
    db.seed("user_settings", [{"user_id": OWNER, "streak_freeze_enabled": True}])
    db.seed("subjects", [
        {"id": "subj-ml", "user_id": OWNER, "name": "Machine Learning"},
        {"id": "subj-st", "user_id": OWNER, "name": "Statistics"},
    ])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj-ml", "name": "Attention",
         "last_activity_at": _days_ago(1)},
        {"id": "t2", "user_id": OWNER, "subject_id": "subj-st", "name": "Bayes",
         "last_activity_at": _days_ago(40)},
    ])
    db.seed("quizzes", [{"id": "q-bayes", "user_id": OWNER, "subspace_id": "t2", "questions": []}])
    db.seed("quiz_results", [
        {"user_id": OWNER, "score": 90, "submitted_at": _days_ago(9), "quiz_id": "q-bayes"},
        {"user_id": OWNER, "score": 88, "submitted_at": _days_ago(8), "quiz_id": "q-bayes"},
        {"user_id": OWNER, "score": 55, "submitted_at": _days_ago(2), "quiz_id": "q-bayes"},
        {"user_id": OWNER, "score": 51, "submitted_at": _days_ago(1), "quiz_id": "q-bayes"},
    ])
    db.seed("decks", [{"id": "d1", "user_id": OWNER, "subspace_id": "t1"}])
    db.seed("flashcards", [
        {"user_id": OWNER, "deck_id": "d1", "due_at": _days_ago(1)},   # due
        {"user_id": OWNER, "deck_id": "d1", "due_at": _days_ago(-5)},  # not yet
    ])
    db.seed("notes", [{"user_id": OWNER, "subspace_id": "t1"}])
    db.seed("documents", [
        {"user_id": OWNER, "subspace_id": "t1", "status": "ready"},
        {"user_id": OWNER, "subspace_id": "t1", "status": "processing"},
    ])

    snap = await sm.snapshot(OWNER)
    by_id = {t.subspace_id: t for t in snap.topics}

    assert set(by_id) == {"t1", "t2"}
    assert by_id["t1"].subject == "Machine Learning"
    assert by_id["t1"].cards_due == 1
    assert by_id["t1"].cards_total == 2
    assert by_id["t1"].notes == 1
    # A document still processing is not material the student can use yet.
    assert by_id["t1"].docs == 1

    bayes = by_id["t2"]
    assert bayes.quiz_average == 71  # (90+88+55+51)/4
    assert bayes.trend == -36        # (55+51)/2 − (90+88)/2
    assert bayes.is_falling
    assert snap.cards_due_total == 1
    assert [t.subspace_id for t in snap.falling] == ["t2"]


@pytest.mark.asyncio
async def test_snapshot_orders_attempts_before_computing_trend(db):
    """`quiz_results` is read newest-first for the limit to cut the right end.
    Feeding that order straight into the trend would invert every direction —
    a topic improving would be reported as sliding."""
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "s", "user_id": OWNER, "name": "S"}])
    db.seed("subspaces", [
        {"id": "t", "user_id": OWNER, "subject_id": "s", "name": "T", "last_activity_at": _days_ago(1)},
    ])
    db.seed("quizzes", [{"id": "q", "user_id": OWNER, "subspace_id": "t", "questions": []}])
    # Newest first, as PostgREST returns them: the student has IMPROVED.
    db.seed("quiz_results", [
        {"user_id": OWNER, "score": 95, "submitted_at": _days_ago(1), "quiz_id": "q"},
        {"user_id": OWNER, "score": 90, "submitted_at": _days_ago(2), "quiz_id": "q"},
        {"user_id": OWNER, "score": 50, "submitted_at": _days_ago(8), "quiz_id": "q"},
        {"user_id": OWNER, "score": 45, "submitted_at": _days_ago(9), "quiz_id": "q"},
    ])

    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].trend == 45
    assert snap.falling == []


@pytest.mark.asyncio
async def test_snapshot_survives_a_brand_new_account(db):
    """A fresh account is the state most likely to be shipped broken."""
    snap = await sm.snapshot(OWNER)
    assert snap.topics == []
    assert snap.cards_due_total == 0
    assert snap.most_recent is None
    assert snap.days_away == 0
    assert sm.format_for_prompt(snap.to_model()) == ""
