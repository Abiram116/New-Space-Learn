"""Preferences mined from the student's own words.

Precision matters far more than recall here. A missed signal costs nothing —
there will be another next week. A false one teaches the app something wrong
about how a person learns, reaches every generated answer, and takes several
contradicting taps to undo.

Mutation-checked.
"""

from __future__ import annotations

from app.services import preferences as pf
from app.services import student_model as sm


def _snap(messages: list[str], settings=None):
    return sm.Snapshot(
        settings=settings or {},
        topics=[],
        concepts=[],
        activity_days=[],
        streak_days=0,
        user_messages=messages,
    )


def test_a_request_to_simplify_is_feedback_nobody_had_to_ask_for():
    """The whole point: this was already in `chat_messages` and the system
    ignored it, then interrupted the student to ask what they had just said."""
    prefs = pf.resolve(_snap(["can you explain that more simply?"]))
    assert prefs["explanation.depth"].value == "simpler"


def test_not_understanding_counts_as_asking_for_simpler():
    prefs = pf.resolve(_snap(["i still don't understand this"]))
    assert prefs["explanation.depth"].value == "simpler"


def test_asking_for_depth_and_brevity_are_opposite_signals():
    assert pf.resolve(_snap(["go deeper on that"]))["explanation.length"].value == "detailed"
    assert pf.resolve(_snap(["tldr please"]))["explanation.length"].value == "concise"


def test_a_request_for_an_example_is_not_a_question_about_examples():
    """The precision case this whole design turns on. "give me an example" is a
    request; "what is an example of a monad" is a question whose subject
    happens to be examples. Treating the second as a style preference would
    have the app rewrite every future answer because of one topic."""
    asked_for = pf.resolve(_snap(["give me an example"]))
    assert asked_for["explanation.opens_with"].value == "example_first"

    about_examples = pf.resolve(_snap(["what is an example of a pure function"]))
    assert "explanation.opens_with" not in about_examples


def test_contradictory_language_yields_no_preference():
    """Pulled both ways on one dimension is context-dependence, not a
    preference. Averaging it into a single global answer would be inventing a
    verdict the evidence doesn't support."""
    prefs = pf.resolve(_snap(["make it simpler", "actually give me way more detail"]))
    assert "explanation.length" in prefs or "explanation.depth" in prefs
    # ...but not a dimension that was pulled in both directions.
    both_ways = pf.resolve(_snap(["shorter please", "no, more detail"]))
    assert "explanation.length" not in both_ways


def test_repetition_raises_confidence():
    once = pf.resolve(_snap(["simpler please"]))
    often = pf.resolve(_snap(["simpler please"] * 5))
    assert often["explanation.depth"].confidence > once["explanation.depth"].confidence
    assert often["explanation.depth"].evidence_count == 5


def test_mined_language_is_observed_not_stated():
    """Filed as `observed`, so it is capped below explicit statement and can
    never overrule a deliberate tap. A regex reading someone's phrasing is not
    the same act as them pressing a button."""
    prefs = pf.resolve(_snap(["simpler please"] * 20))
    assert prefs["explanation.depth"].source == "observed"
    assert prefs["explanation.depth"].confidence <= pf.OBSERVED_CEILING


def test_explicit_settings_still_win():
    prefs = pf.resolve(
        _snap(["simpler please"] * 10, {"student_model": {"teaching_preference": "be technical"}})
    )
    assert prefs["explanation.note"].source == "explicit"


def test_ordinary_conversation_yields_nothing():
    """A false positive is the expensive failure, so the bar for ordinary
    study talk is that it produces no preference at all."""
    prefs = pf.resolve(
        _snap([
            "what is the bellman equation",
            "how does value iteration converge",
            "thanks, that makes sense",
            "can you quiz me on this chapter",
        ])
    )
    assert prefs == {}
