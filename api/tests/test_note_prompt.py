"""What the notes agent is told, and why it changes without documents.

Space Learn is designed to be good with no uploads and excellent with them.
The prompt did not reflect that: with an empty corpus the note agent was told
both "length follows the material — short when there genuinely isn't much to
say" and "do not invent facts not present in either". Together those are an
instruction to write almost nothing, from nothing.

The observed failures were exactly what that predicts. A request for interview
notes came back as four bullets. A request for a note on transformers came back
as a rewrite of whatever the recent chat happened to be about, because the chat
was the only source the model was permitted to draw on.

These tests pin the two rules apart, because the grounded rule is the product's
central promise and must not loosen while fixing the ungrounded one.
"""

from app.routers.notes import _grounding_rule, _length_rule


def test_grounded_notes_stay_strictly_grounded() -> None:
    rule = _grounding_rule(True).lower()
    assert "do not invent" in rule
    assert "ground every claim" in rule


def test_ungrounded_notes_may_use_the_model_s_own_knowledge() -> None:
    rule = _grounding_rule(False).lower()
    assert "your own knowledge" in rule
    # The strict prohibition must NOT be carried over — that is the bug.
    assert "do not invent facts not present" not in rule


def test_ungrounded_notes_still_refuse_to_fake_a_citation() -> None:
    """Loosening the source rule must not loosen the honesty rule. A note with
    no documents behind it may not claim any."""
    rule = _grounding_rule(False).lower()
    assert "do not present anything as coming from the student's own documents" in rule
    assert "fabricated citation" in rule


def test_ungrounded_notes_follow_the_asked_topic_over_the_chat() -> None:
    """The 'asked for transformers, got a rewrite of the last conversation'
    failure: with no material the chat was the only permitted source, so it
    became the subject."""
    rule = _grounding_rule(False).lower()
    assert "ignore it" in rule
    assert "topic the student asked for" in rule


def test_no_material_asks_for_more_not_less() -> None:
    rule = _length_rule(False).lower()
    assert "write more, not less" in rule
    assert "several hundred words" in rule


def test_material_keeps_length_proportional() -> None:
    rule = _length_rule(True).lower()
    assert "length follows the material" in rule


def test_the_two_length_rules_are_actually_different() -> None:
    """Guards against a future edit collapsing the branch back into one string,
    which is the shape the bug had."""
    assert _length_rule(True) != _length_rule(False)
    assert _grounding_rule(True) != _grounding_rule(False)
