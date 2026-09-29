"""`next_action` — task 7's ranking of the Home suggestion.

Pure and synchronous (see its docstring), so every test here builds a
`Snapshot` by hand and asserts on the ranked candidate list directly — no
database, no event loop. `_compute_suggestion`'s own database-resolution
behaviour (falling through when a resolved quiz/deck doesn't exist) is
already covered by `test_brief_cache.py`'s end-to-end mocks; this file is
about whether the RANKING and REASON text are right, which those tests don't
exercise because they stub `_compute_suggestion` out entirely.
"""

from __future__ import annotations

import pytest

from app.routers.me import brief as brief_module
from app.routers.me.brief import next_action
from app.services import student_model as sm


def _topic(**kwargs) -> sm.TopicView:
    base = dict(
        subspace_id="t1", subject_id="subj1", subject="ML", topic="RL",
        quiz_average=None, quiz_attempts=0, trend=None, days_since_activity=None,
        cards_due=0, cards_total=0, notes=0, docs=0, mastery=50, evidence_n=0.0,
    )
    base.update(kwargs)
    return sm.TopicView(**base)


def _snap(topics=(), concepts=(), **kwargs) -> sm.Snapshot:
    return sm.Snapshot(
        settings={}, topics=list(topics), concepts=list(concepts),
        activity_days=[], streak_days=0, **kwargs,
    )


# ── Ordering ───────────────────────────────────────────────────────────


def test_empty_snapshot_has_no_candidates():
    assert next_action(_snap()) == []


def test_a_misconception_outranks_everything_else():
    topic = _topic(
        quiz_average=40, quiz_attempts=4, mastery=55, evidence_n=5.0,
        cards_due=10,
        misconceptions=(
            sm.MisconceptionView(text="confuses A with B", weight=3.0, seen=4, last_seen="x"),
        ),
    )
    cands = next_action(_snap(topics=[topic]))
    assert cands[0].action == "fix_misconception"
    assert "confuses A with B" in cands[0].reason


def test_root_cause_outranks_slipping_and_everything_blunter():
    weak = sm.ConceptView(
        concept="attention", label="Attention", asked=5, correct=1, accuracy=20,
        mastery=30, evidence_n=5.0, trend=None, days_since_seen=1, subspace_ids=("t1",),
    )
    weak_prereq = sm.ConceptView(
        concept="matmul", label="Matrix multiplication", asked=5, correct=1, accuracy=20,
        mastery=25, evidence_n=5.0, trend=None, days_since_seen=1, subspace_ids=("t1",),
    )
    topic = _topic(quiz_average=40, quiz_attempts=4, cards_due=10, is_slipping=True)
    snap = _snap(
        topics=[topic], concepts=[weak, weak_prereq],
        prereq_edges={"attention": ("matmul",)},
        concept_labels={"matmul": "Matrix multiplication"},
    )
    cands = next_action(snap)
    assert cands[0].action == "root_cause"
    assert cands[0].target == "Matrix multiplication"
    assert "Attention" in cands[0].reason


def test_slipping_outranks_due_cards_and_low_average():
    topic = _topic(
        quiz_average=40, quiz_attempts=4, cards_due=10, is_slipping=True,
    )
    cands = next_action(_snap(topics=[topic]))
    assert cands[0].action == "slipping"
    assert cands[0].resolve == "quiz"


def test_due_cards_outranks_a_plain_low_average():
    topic = _topic(quiz_average=40, quiz_attempts=4, cards_due=5)
    cands = next_action(_snap(topics=[topic]))
    assert cands[0].action == "due_cards"
    assert "5 cards" in cands[0].reason


def test_low_average_alone_is_the_weak_topic_branch():
    topic = _topic(quiz_average=40, quiz_attempts=4, cards_due=0)
    cands = next_action(_snap(topics=[topic]))
    assert cands[0].action == "weak_topic"
    assert "40%" in cands[0].reason


def test_falls_through_to_continue_when_nothing_else_applies():
    topic = _topic(quiz_average=90, quiz_attempts=4, cards_due=0, days_since_activity=1)
    cands = next_action(_snap(topics=[topic]))
    assert cands[0].action == "continue"
    assert cands[0].target == "RL"


# ── Gating ─────────────────────────────────────────────────────────────


def test_due_cards_needs_a_real_backlog_not_one_or_two_stray_cards():
    topic = _topic(quiz_average=90, quiz_attempts=4, cards_due=2, days_since_activity=1)
    cands = next_action(_snap(topics=[topic]))
    assert all(c.action != "due_cards" for c in cands)


def test_weak_topic_needs_enough_attempts_to_trust_the_average():
    """A one-attempt average of 0% is not a low average yet — `snap.rated`
    already gates this at `MIN_ATTEMPTS_FOR_AVERAGE`, and `next_action` must
    respect that gate rather than reading raw `quiz_average`."""
    topic = _topic(quiz_average=None, quiz_attempts=0, cards_due=0, days_since_activity=1)
    cands = next_action(_snap(topics=[topic]))
    assert all(c.action != "weak_topic" for c in cands)


def test_root_cause_is_skipped_without_a_resolvable_subspace():
    """A `RootCause` whose `subspace_id` doesn't map to any topic's subject
    (shouldn't happen from a real snapshot, but the ranking must not crash
    or emit a route with a missing subject) is simply skipped."""
    weak = sm.ConceptView(
        concept="a", label="A", asked=5, correct=1, accuracy=20, mastery=30,
        evidence_n=5.0, trend=None, days_since_seen=1, subspace_ids=("ghost",),
    )
    snap = _snap(
        topics=[], concepts=[weak],
        prereq_edges={"a": ("prereq",)}, concept_labels={"prereq": "Prereq"},
    )
    assert all(c.action != "root_cause" for c in next_action(snap))


# ── Reasons are grounded in real data ───────────────────────────────────


def test_weak_topic_reason_names_the_real_topic_and_its_real_average():
    topic = _topic(topic="Bayesian Inference", quiz_average=42, quiz_attempts=4, cards_due=0)
    cands = next_action(_snap(topics=[topic]))
    weak = next(c for c in cands if c.action == "weak_topic")
    assert "Bayesian Inference" in weak.reason
    assert "42%" in weak.reason


def test_due_cards_reason_uses_the_real_due_count():
    topic = _topic(topic="Bayesian Inference", cards_due=7)
    cands = next_action(_snap(topics=[topic]))
    due = next(c for c in cands if c.action == "due_cards")
    assert "7 cards" in due.reason


# ── `_compute_suggestion` carries reason/action onto `BriefSuggestion` ───
#
# `next_action` is pure and covered above without a database; this is the
# one seam where its `reason`/`action` actually have to survive the async
# resolution step and reach the schema Home renders from.


@pytest.mark.asyncio
async def test_compute_suggestion_carries_reason_and_action_for_a_none_resolve(db):
    """`fix_misconception` resolves to `resolve="none"` — the base route,
    nothing to look up — so this is the simplest path through
    `_compute_suggestion` and the one most likely to have dropped the new
    fields entirely (no per-branch code touches them)."""
    topic = _topic(
        quiz_average=40, quiz_attempts=4, mastery=55, evidence_n=5.0,
        misconceptions=(
            sm.MisconceptionView(text="confuses A with B", weight=3.0, seen=4, last_seen="x"),
        ),
    )
    suggestion = await brief_module._compute_suggestion(_snap(topics=[topic]))
    assert suggestion is not None
    assert suggestion.action == "fix_misconception"
    assert "confuses A with B" in suggestion.reason


@pytest.mark.asyncio
async def test_compute_suggestion_carries_reason_and_action_for_a_deck_resolve(db):
    topic = _topic(topic="Bayesian Inference", cards_due=7)
    db.seed("decks", [{"id": "d1", "user_id": "owner", "subspace_id": "t1", "name": "Deck"}])
    db.seed("flashcards", [
        {"id": "c1", "deck_id": "d1", "due_at": "2020-01-01T00:00:00Z"},
    ])
    suggestion = await brief_module._compute_suggestion(_snap(topics=[topic]))
    assert suggestion is not None
    assert suggestion.action == "due_cards"
    assert "7 cards" in suggestion.reason
