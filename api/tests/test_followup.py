"""The suggested follow-up question: held back from the stream, checked, and only asked for with sources."""

from __future__ import annotations

import pytest

from app.services import followup, rag


def run(pieces: list[str]) -> tuple[str, str | None]:
    f = followup.FollowUpFilter()
    shown = "".join(f.feed(p) for p in pieces)
    tail, suggestion = f.finish()
    return shown + tail, suggestion


def test_the_marker_never_reaches_the_student_however_it_is_split():
    text = "Attention weighs tokens.\n[[next: Why scale by the square root of d?]]"
    for size in (1, 2, 3, 5, 7, len(text)):
        pieces = [text[i : i + size] for i in range(0, len(text), size)]
        shown, suggestion = run(pieces)
        assert shown == "Attention weighs tokens.", size
        assert suggestion == "Why scale by the square root of d?", size


def test_an_answer_without_the_marker_passes_through_untouched():
    shown, suggestion = run(["Plain ", "answer [", "with a bracket] and [[1]]."])
    assert shown == "Plain answer [with a bracket] and [[1]]."
    assert suggestion is None


def test_a_half_started_marker_at_the_very_end_is_given_back():
    shown, suggestion = run(["Ends with a bracket pair [["])
    assert shown == "Ends with a bracket pair [["
    assert suggestion is None


@pytest.mark.parametrize(
    "raw",
    [
        "Explain attention",  # not a question
        "x" * 200 + "?",  # too long
        "Why [[1]]?",  # a marker inside it
        "line one?\nline two?",  # not a single line
        "",
    ],
)
def test_a_suggestion_that_is_not_fit_to_show_is_dropped(raw):
    assert followup.clean(raw) is None


def test_the_answer_is_still_whole_when_the_suggestion_is_bad():
    shown, suggestion = run(["The answer.\n[[next: not a question]]"])
    assert shown == "The answer."
    assert suggestion is None


def _prompt(**kw):
    messages, _ = rag.build_prompt(
        subspace_name="t",
        active_skill_instructions=[],
        history=[],
        question="q",
        answer_only_from_docs=True,
        always_show_citations=True,
        **kw,
    )
    return messages[0]["content"]


def _src():
    return [rag.Retrieved(document_id="d", document_name="n.pdf", locator="p. 1", content="c", similarity=0.9)]


def test_the_follow_up_is_only_asked_for_when_there_are_sources_to_ask_about():
    assert followup.OPEN in _prompt(retrieved=_src(), suggest_followup=True)
    assert followup.OPEN not in _prompt(retrieved=[], suggest_followup=True)
    assert followup.OPEN not in _prompt(retrieved=_src())  # off unless the caller asks
