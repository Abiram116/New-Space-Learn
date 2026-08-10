"""Feedback → preference learning.

The arithmetic here decides how the app writes to a student, so a wrong sign or
a missing gate is wrong in every generated answer at once and looks like the
tutor being obtuse rather than like a bug. All of it is mutation-checked.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.services import preferences as pf
from app.services import student_model as sm

from .conftest import OWNER


def _at(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()


def _snap(feedback=None, settings=None):
    return sm.Snapshot(
        settings=settings or {},
        topics=[],
        concepts=[],
        activity_days=[],
        streak_days=0,
        feedback=feedback or [],
    )


def _fb(kind: str, days_ago: float = 1) -> dict:
    return {"kind": kind, "created_at": _at(days_ago), "concept": None}


# ── The taxonomy is the gate ───────────────────────────────────────────


def test_every_kind_maps_to_a_whitelisted_key():
    """A kind pointing at a key outside `KEYS` would create evidence nothing
    can interpret, and would route around the privacy whitelist."""
    for kind, spec in pf.FEEDBACK_KINDS.items():
        assert spec.key is None or spec.key in pf.KEYS, kind


def test_unknown_kinds_are_ignored_by_the_fold():
    prefs = pf.resolve(_snap([_fb("vibes"), _fb("hack")]))
    assert prefs == {}


# ── Confidence movement ────────────────────────────────────────────────


def test_one_tap_is_an_opinion_not_a_setting():
    """A single tap must not immediately change how the app writes. It takes a
    second piece of evidence to cross the acting threshold."""
    prefs = pf.resolve(_snap([_fb("too_long")]))
    assert prefs["explanation.length"].value == "concise"
    assert not prefs["explanation.length"].actionable


def test_agreeing_evidence_crosses_the_threshold():
    prefs = pf.resolve(_snap([_fb("too_long", 3), _fb("too_long", 2), _fb("too_long", 1)]))
    assert prefs["explanation.length"].actionable
    assert prefs["explanation.length"].evidence_count == 3


def test_contradiction_costs_more_than_agreement_gains():
    """Being wrong about a student costs more than being unsure about them, so
    a preference is expensive to acquire and cheap to lose.

    Measured as an asymmetry, not just a direction: from the same base, one
    contradicting tap must LOSE more than one agreeing tap GAINS. Merely
    asserting that mixed evidence scores below agreeing evidence would pass
    with no penalty at all, which is how this test read on its first draft.
    """
    base = [_fb("too_long", 3.2), _fb("too_long", 3.1)]
    conf = lambda events: pf.resolve(_snap(events))["explanation.length"].confidence  # noqa: E731

    at_base = conf(base)
    gain = conf([*base, _fb("too_long", 3.0)]) - at_base
    loss = at_base - conf([*base, _fb("want_detail", 3.0)])

    assert loss > gain


def test_sustained_contradiction_flips_the_preference():
    """Preferences must be reversible. A student whose taste changes should be
    followed, not out-voted by their own history."""
    events = [_fb("too_long", 10), _fb("too_long", 9), _fb("too_long", 8)]
    events += [_fb("want_detail", i) for i in range(6, 0, -1)]
    prefs = pf.resolve(_snap(events))
    assert prefs["explanation.length"].value == "detailed"


def test_regenerate_lowers_without_pointing_anywhere():
    """Dissatisfaction with no stated reason is evidence the current settings
    are wrong and no evidence about what would be better."""
    without = pf.resolve(_snap([_fb("too_long", 3), _fb("too_long", 2)]))
    with_regen = pf.resolve(
        _snap([_fb("too_long", 3), _fb("too_long", 2), _fb("regenerate", 1)])
    )
    assert with_regen["explanation.length"].value == "concise"
    assert with_regen["explanation.length"].confidence < without["explanation.length"].confidence


def test_useful_refreshes_recency_without_manufacturing_confidence():
    """"This helped" says the answer landed, not WHICH of five settings made it
    land. Crediting them all is how a system talks itself into certainty."""
    old = [_fb("too_long", 200), _fb("too_long", 199)]
    prefs_stale = pf.resolve(_snap(old))
    prefs_refreshed = pf.resolve(_snap([*old, _fb("useful", 1)]))
    # Recency restored, so decay no longer applies…
    assert prefs_refreshed["explanation.length"].confidence > prefs_stale["explanation.length"].confidence
    # …but never above what the same evidence would give when fresh.
    fresh = pf.resolve(_snap([_fb("too_long", 2), _fb("too_long", 1)]))
    assert (
        prefs_refreshed["explanation.length"].confidence
        <= fresh["explanation.length"].confidence + 1e-9
    )


def test_confidence_decays_when_nothing_confirms_it():
    fresh = pf.resolve(_snap([_fb("too_long", 2), _fb("too_long", 1)]))
    stale = pf.resolve(_snap([_fb("too_long", 400), _fb("too_long", 399)]))
    assert stale["explanation.length"].confidence < fresh["explanation.length"].confidence


# ── Precedence ─────────────────────────────────────────────────────────


def test_explicit_still_outranks_learned_feedback():
    """The student's own words beat anything inferred from taps, however much
    of it has piled up."""
    events = [_fb("too_long", i) for i in range(8, 0, -1)]
    prefs = pf.resolve(
        _snap(events, {"student_model": {"teaching_preference": "go deep, always"}})
    )
    assert prefs["explanation.note"].source == "explicit"


# ── It has to actually reach the prompt ────────────────────────────────


def test_learned_preference_changes_the_chat_block():
    """The whole point of shipping collection and consumption together: a
    student who says "too long" twice should see shorter answers, not a button
    that visibly does nothing."""
    from app.services import personalization

    snap = _snap([_fb("too_long", 3), _fb("too_long", 2), _fb("too_long", 1)])
    block = personalization.render(snap, "chat")
    assert "short" in block.lower()


def test_below_threshold_preferences_stay_out_of_the_prompt():
    from app.services import personalization

    snap = _snap([_fb("too_long", 1)])
    assert personalization.render(snap, "chat") == ""


@pytest.mark.asyncio
async def test_snapshot_reads_feedback(db):
    db.seed("response_feedback", [
        {"user_id": OWNER, "kind": "too_long", "created_at": _at(1), "concept": None},
    ])
    snap = await sm.snapshot(OWNER)
    assert len(snap.feedback) == 1
