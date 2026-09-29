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
from app.services.student_model import ConceptView, TopicView

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
        # Neutral means no evidence, not "average" — `mastery=50, n=0` fails
        # both `is_weak` and `is_strong`, same as a topic nobody has touched.
        mastery=50,
        evidence_n=0.0,
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
    opposite advice. A level alone cannot tell them apart — which is why
    the old model, which had only averages, could not say anything useful."""
    climbing = _topic(
        subspace_id="climb", quiz_average=55, quiz_attempts=4, trend=15,
        mastery=55, evidence_n=4.0,
    )
    sliding = _topic(
        subspace_id="slide", quiz_average=78, quiz_attempts=4, trend=-15,
        mastery=78, evidence_n=4.0,
    )
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


# ── Bayesian mastery ─────────────────────────────────────────────────────


def test_mastery_with_no_evidence_is_the_uninformative_prior():
    """Beta(1,1)'s own mean, not a made-up zero — a topic nobody has
    touched is unknown, not failing."""
    mastery, n = sm._mastery_from_evidence([])
    assert mastery == 50
    assert n == 0


def test_mastery_moves_toward_the_evidence_but_not_all_the_way():
    """Five right answers should read as clearly above average, but the
    Beta(1,1) prior keeps a handful of evidence short of certainty."""
    mastery, n = sm._mastery_from_evidence([(1.0, 1.0)] * 5)
    assert 50 < mastery < 100
    assert n == 5


def test_mastery_all_wrong_reads_low():
    mastery, _ = sm._mastery_from_evidence([(0.0, 1.0)] * 5)
    assert mastery < 50


def test_weak_and_strong_mastery_thresholds_cannot_overlap():
    """The whole point of the rewrite: unlike top-3/bottom-3 by a plain
    number, these two bands cannot both claim the same score."""
    assert sm.WEAK_MASTERY < sm.STRONG_MASTERY


def test_evidence_weight_is_full_for_fresh_evidence():
    at = datetime.now(UTC).isoformat()
    assert sm._evidence_weight(at, date.today()) == pytest.approx(1.0, abs=0.02)


def test_evidence_weight_halves_at_the_half_life():
    at = (datetime.now(UTC) - timedelta(days=sm.MASTERY_HALF_LIFE_DAYS)).isoformat()
    assert sm._evidence_weight(at, date.today()) == pytest.approx(0.5, abs=0.02)


def test_evidence_weight_is_zero_for_unparsable_timestamps():
    assert sm._evidence_weight("not-a-date", date.today()) == 0.0


def test_topic_needs_enough_evidence_to_be_called_weak_or_strong():
    """A low score off one stale data point must not be asserted as weak —
    `n` is the gate, not just the mastery number."""
    thin = _topic(subspace_id="thin", mastery=10, evidence_n=1.0)
    confident = _topic(subspace_id="sure", mastery=95, evidence_n=1.0)
    snap = sm.Snapshot(
        settings={}, concepts=[], topics=[thin, confident], activity_days=[], streak_days=0
    )
    assert snap.weak_areas == []
    assert snap.strong_areas == []


def test_weak_and_strong_areas_never_overlap():
    borderline = _topic(subspace_id="mid", mastery=70, evidence_n=10.0)
    snap = sm.Snapshot(
        settings={}, concepts=[], topics=[borderline], activity_days=[], streak_days=0
    )
    weak_ids = {t.subspace_id for t in snap.weak_areas}
    strong_ids = {t.subspace_id for t in snap.strong_areas}
    assert not (weak_ids & strong_ids)
    # 70 is neither < 60 nor >= 80, so it lands in neither list.
    assert borderline.subspace_id not in weak_ids
    assert borderline.subspace_id not in strong_ids


def test_signal_exposes_mastery_as_average():
    """`TopicSignal.average` keeps its name but now carries mastery, not the
    plain quiz mean — the field consumers (API schema, web Profile) already
    read, now with the number that actually produced the ranking."""
    t = _topic(subspace_id="t1", quiz_average=40, mastery=71, evidence_n=5.0)
    assert sm._signal(t).average == 71


@pytest.mark.asyncio
async def test_topic_mastery_folds_in_card_reviews(db):
    """A topic drilled hard with flashcards but never quizzed still gets real
    evidence behind its score — mastery isn't quiz-only anymore."""
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "Attention",
         "last_activity_at": _days_ago(1)},
    ])
    db.seed("card_reviews", [
        {"user_id": OWNER, "subspace_id": "t1", "grade": 4, "reviewed_at": _days_ago(i)}
        for i in range(1, 5)
    ])
    snap = await sm.snapshot(OWNER)
    topic = snap.topics[0]
    assert topic.quiz_attempts == 0
    assert topic.evidence_n > 0
    assert topic.mastery > 50
    assert topic in snap.strong_areas


@pytest.mark.asyncio
async def test_topic_can_be_weak_from_card_grades_alone(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "Attention",
         "last_activity_at": _days_ago(1)},
    ])
    db.seed("card_reviews", [
        {"user_id": OWNER, "subspace_id": "t1", "grade": 1, "reviewed_at": _days_ago(i)}
        for i in range(1, 5)
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0] in snap.weak_areas


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


# ── The one-round-trip read, and its fallback ──────────────────────────


@pytest.mark.asyncio
async def test_snapshot_falls_back_to_selects_when_the_rpc_is_missing(db) -> None:
    """`student_snapshot` collapses twelve selects into one round trip, but a
    database that has not taken the migration must still serve rather than 500
    on the most-used read in the app.

    `FakeDb` refuses RPCs, so this is the path every other test in the suite
    runs through — this one states it on purpose rather than relying on it
    accidentally.
    """
    db.seed("response_feedback", [
        {"user_id": OWNER, "kind": "too_long", "created_at": "2026-08-01T00:00:00Z",
         "concept": None},
    ])
    rows = await sm._snapshot_rows(OWNER)

    # Every key the folding code indexes must be present, or the fallback is a
    # different shape from the RPC and only fails once someone is offline.
    for key in sm._SNAPSHOT_KEYS:
        assert key in rows, f"fallback is missing {key!r}"
    assert len(rows["response_feedback"]) == 1


@pytest.mark.asyncio
async def test_the_fallback_returns_the_shape_the_rpc_promises(db) -> None:
    """Lists stay lists and settings stays a mapping even for an empty account.
    A `None` here would crash the folding below it rather than degrade."""
    rows = await sm._snapshot_rows("nobody")
    assert isinstance(rows["settings"], dict)
    for key in sm._SNAPSHOT_KEYS:
        if key != "settings":
            assert isinstance(rows[key], list), f"{key} should be a list"


# ── Difficulty mix (task 2) ──────────────────────────────────────────────


def test_difficulty_mix_sums_to_the_requested_count():
    """Largest-remainder rounding must never drop or invent a question —
    whatever fractional split the mastery band implies, the three bands
    still have to add up to exactly what was asked for."""
    for mastery in (None, 0, 10, 49, 50, 62, 75, 76, 99, 100):
        for count in (1, 3, 5, 7, 12, 20):
            mix = sm.difficulty_mix(mastery, count)
            assert sum(mix.values()) == count
            assert set(mix) == {"easy", "medium", "hard"}


def test_low_mastery_skews_easy():
    mix = sm.difficulty_mix(20, 10)
    assert mix["easy"] > mix["medium"] > mix["hard"]


def test_mid_mastery_skews_medium():
    mix = sm.difficulty_mix(60, 10)
    assert mix["medium"] > mix["easy"]
    assert mix["medium"] > mix["hard"]


def test_high_mastery_skews_hard():
    mix = sm.difficulty_mix(90, 10)
    assert mix["hard"] > mix["medium"] > mix["easy"]


def test_unmeasured_mastery_is_not_treated_as_confident_either_way():
    """No evidence yet should read like the middle band, not like `mastery=0`
    (all easy) or `mastery=100` (all hard) — a topic nobody has touched is
    unknown, not failing or aced."""
    assert sm.difficulty_mix(None, 10) == sm.difficulty_mix(62, 10)


# ── Misconceptions (task 3) ──────────────────────────────────────────────


def test_misconception_kept_once_it_recurs_even_if_each_hit_is_stale():
    """Seen twice clears the bar on its own, regardless of how decayed each
    individual occurrence is — a repeat is a repeat."""
    old = [(0.0, "2020-01-01T00:00:00Z"), (0.0, "2020-01-02T00:00:00Z")]
    out = sm._top_misconceptions({"mixes up A and B": [t for _, t in old]}, date.today())
    assert out and out[0].seen == 2


def test_a_single_fresh_occurrence_is_not_yet_a_pattern():
    """One fresh hit has weight ~1.0 — below `MISCONCEPTION_MIN_WEIGHT`
    (1.5) and below `MIN_SEEN` (2). Neither threshold is cleared by a single
    occurrence no matter how fresh, which is the point: one wrong guess
    isn't a recurring mix-up yet."""
    out = sm._top_misconceptions(
        {"mixes up A and B": [datetime.now(UTC).isoformat()]}, date.today()
    )
    assert out == []


def test_misconception_below_both_thresholds_is_dropped():
    out = sm._top_misconceptions(
        {"a rare slip": [(datetime.now(UTC) - timedelta(days=90)).isoformat()]}, date.today()
    )
    assert out == []


def test_misconceptions_are_ranked_by_weight_and_capped():
    events = {
        f"mix-up {i}": [datetime.now(UTC).isoformat()] * (i + 2) for i in range(5)
    }
    out = sm._top_misconceptions(events, date.today(), limit=3)
    assert len(out) == 3
    assert [m.seen for m in out] == sorted((m.seen for m in out), reverse=True)


@pytest.mark.asyncio
async def test_topic_misconceptions_come_from_the_wrong_choice_actually_picked(db):
    """The misconception surfaced must be the one behind the CHOICE THE
    STUDENT PICKED, not just any tag on the question — picking the right
    answer, or a different wrong answer, must not attribute someone else's
    mix-up to this student."""
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "RL",
         "last_activity_at": _days_ago(1)},
    ])
    question = {
        "q": "What updates first in Q-learning?", "choices": ["a", "b", "c", "d"],
        "answer_index": 0, "subtopic": "Q-learning",
        "misconceptions": [None, "confuses Q-learning with SARSA", "off-policy mixup", None],
    }
    db.seed("quizzes", [{"id": "q1", "user_id": OWNER, "subspace_id": "t1", "questions": [question]}])
    db.seed("quiz_results", [
        {"user_id": OWNER, "score": 0, "submitted_at": _days_ago(i), "quiz_id": "q1", "answers": [1]}
        for i in range(1, 4)
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].misconceptions
    assert snap.topics[0].misconceptions[0].text == "confuses Q-learning with SARSA"
    assert snap.top_misconceptions[0].text == "confuses Q-learning with SARSA"


@pytest.mark.asyncio
async def test_a_correct_answer_never_produces_a_misconception(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "RL",
         "last_activity_at": _days_ago(1)},
    ])
    question = {
        "q": "Q", "choices": ["a", "b"], "answer_index": 0, "subtopic": "Q-learning",
        "misconceptions": [None, "some mix-up"],
    }
    db.seed("quizzes", [{"id": "q1", "user_id": OWNER, "subspace_id": "t1", "questions": [question]}])
    db.seed("quiz_results", [
        {"user_id": OWNER, "score": 100, "submitted_at": _days_ago(1), "quiz_id": "q1", "answers": [0]}
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].misconceptions == ()
    assert snap.top_misconceptions == ()


# ── Prerequisite root causes (task 4) ────────────────────────────────────


def _concept(**kwargs) -> ConceptView:
    base = dict(
        concept="x", label="X", asked=5, correct=1, accuracy=20, mastery=30,
        evidence_n=5.0, trend=None, days_since_seen=1, subspace_ids=("t1",),
    )
    base.update(kwargs)
    return ConceptView(**base)


def test_root_cause_needs_no_edges_to_stay_empty():
    weak = _concept(concept="a", label="A", mastery=30, evidence_n=5.0)
    snap = sm.Snapshot(settings={}, topics=[], concepts=[weak], activity_days=[], streak_days=0)
    assert snap.root_causes == []


def test_a_weak_prerequisite_is_a_root_cause_from_one_dependant():
    weak = _concept(concept="attention", label="Attention", mastery=30, evidence_n=5.0)
    weak_prereq = _concept(
        concept="matrix multiplication", label="Matrix multiplication",
        mastery=25, evidence_n=5.0, subspace_ids=("t1",),
    )
    snap = sm.Snapshot(
        settings={}, topics=[], concepts=[weak, weak_prereq], activity_days=[], streak_days=0,
        prereq_edges={"attention": ("matrix multiplication",)},
        concept_labels={"matrix multiplication": "Matrix multiplication"},
    )
    causes = snap.root_causes
    assert len(causes) == 1
    assert causes[0].concept == "Matrix multiplication"
    assert causes[0].because_of == ("Attention",)


def test_an_unmeasured_prerequisite_needs_two_weak_dependants():
    a = _concept(concept="a", label="A", mastery=30, evidence_n=5.0)
    b = _concept(concept="b", label="B", mastery=35, evidence_n=5.0)
    edges = {"a": ("shared prereq",), "b": ("shared prereq",)}
    labels = {"shared prereq": "Shared prereq"}

    one_dependant = sm.Snapshot(
        settings={}, topics=[], concepts=[a], activity_days=[], streak_days=0,
        prereq_edges={"a": ("shared prereq",)}, concept_labels=labels,
    )
    assert one_dependant.root_causes == []

    two_dependants = sm.Snapshot(
        settings={}, topics=[], concepts=[a, b], activity_days=[], streak_days=0,
        prereq_edges=edges, concept_labels=labels,
    )
    assert len(two_dependants.root_causes) == 1
    assert set(two_dependants.root_causes[0].because_of) == {"A", "B"}


def test_a_strong_prerequisite_is_never_reported_as_a_cause():
    weak = _concept(concept="a", label="A", mastery=30, evidence_n=5.0)
    strong_prereq = _concept(
        concept="strong prereq", label="Strong prereq", mastery=95, evidence_n=5.0,
    )
    snap = sm.Snapshot(
        settings={}, topics=[], concepts=[weak, strong_prereq], activity_days=[], streak_days=0,
        prereq_edges={"a": ("strong prereq",)}, concept_labels={"strong prereq": "Strong prereq"},
    )
    assert snap.root_causes == []


@pytest.mark.asyncio
async def test_prereq_edges_are_built_from_quiz_questions(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "RL",
         "last_activity_at": _days_ago(1)},
    ])
    question = {
        "q": "Q", "choices": ["a", "b"], "answer_index": 0, "subtopic": "Policy iteration",
        "prerequisites": ["Bellman equation"],
    }
    db.seed("quizzes", [{"id": "q1", "user_id": OWNER, "subspace_id": "t1", "questions": [question]}])
    snap = await sm.snapshot(OWNER)
    assert snap.prereq_edges.get("policy iteration") == ("bellman equation",)
    assert snap.concept_labels.get("bellman equation") == "Bellman equation"


# ── Slipping (task 5) ─────────────────────────────────────────────────────


def test_topic_needs_old_strong_evidence_to_slip():
    """No evidence older than the cutoff at all — nothing to call
    'previously strong', so it can't be slipping."""
    fresh_only = [(1.0, _days_ago(1))]
    assert not sm._is_slipping(fresh_only, date.today(), mastery_now=90, days_since_last=1)


def test_topic_slips_when_it_regresses_from_a_strong_past():
    old_strong = [(1.0, _days_ago(25))] * 10
    # Strong in the past (mastery_old high), weak now.
    assert sm._is_slipping(old_strong, date.today(), mastery_now=40, days_since_last=1)


def test_topic_does_not_slip_if_still_strong_and_recently_seen():
    old_strong = [(1.0, _days_ago(25))] * 10
    assert not sm._is_slipping(old_strong, date.today(), mastery_now=85, days_since_last=1)


def test_topic_slips_from_staleness_even_without_a_measured_regression():
    old_strong = [(1.0, _days_ago(35))] * 10
    # Nothing since, so mastery_now == the old (still-strong) number — the
    # regression branch alone would miss this; staleness must catch it.
    assert sm._is_slipping(old_strong, date.today(), mastery_now=85, days_since_last=35)


def test_topic_does_not_slip_from_recency_alone_without_ever_being_strong():
    old_weak = [(0.0, _days_ago(25))] * 10
    assert not sm._is_slipping(old_weak, date.today(), mastery_now=20, days_since_last=35)


def test_slipping_lists_topics_before_concepts():
    slipping_topic = _topic(subspace_id="t1", mastery=40, evidence_n=5.0, is_slipping=True)
    slipping_concept = _concept(concept="c", label="C", is_slipping=True)
    snap = sm.Snapshot(
        settings={}, topics=[slipping_topic], concepts=[slipping_concept],
        activity_days=[], streak_days=0,
    )
    assert [item.kind for item in snap.slipping] == ["topic", "concept"]


# ── Recall vs application (task 6) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_recall_and_application_split_needs_two_of_each(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "RL",
         "last_activity_at": _days_ago(1)},
    ])
    recall_q = {"q": "define X", "choices": ["a", "b"], "answer_index": 0, "kind": "recall"}
    apply_q = {"q": "use X here", "choices": ["a", "b"], "answer_index": 0, "kind": "apply"}
    db.seed("quizzes", [
        {"id": "q1", "user_id": OWNER, "subspace_id": "t1", "questions": [recall_q]},
        {"id": "q2", "user_id": OWNER, "subspace_id": "t1", "questions": [apply_q]},
    ])
    # Only one attempt each — below RECALL_SPLIT_MIN_N (2), so both must
    # read None rather than a coin-flip number.
    db.seed("quiz_results", [
        {"user_id": OWNER, "score": 100, "submitted_at": _days_ago(1), "quiz_id": "q1", "answers": [0]},
        {"user_id": OWNER, "score": 100, "submitted_at": _days_ago(1), "quiz_id": "q2", "answers": [0]},
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].recall_mastery is None
    assert snap.topics[0].application_mastery is None


@pytest.mark.asyncio
async def test_card_reviews_count_toward_recall_not_application(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [
        {"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "RL",
         "last_activity_at": _days_ago(1)},
    ])
    db.seed("card_reviews", [
        {"user_id": OWNER, "subspace_id": "t1", "grade": 4, "reviewed_at": _days_ago(i)}
        for i in range(1, 4)
    ])
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].recall_mastery is not None
    assert snap.topics[0].recall_mastery > 50
    assert snap.topics[0].application_mastery is None
