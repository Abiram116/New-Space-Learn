"""Citation marker validation.

Product Principle 3 ("every claim is traceable") is what lets this product
claim a lecturer could trust it. `build_prompt` tells the model to cite only
the numbered sources it was handed — but an instruction is not a guarantee,
and a marker pointing at a source that doesn't exist renders as a citation the
student can't click. That reads as a broken promise, which is worse than no
citation at all.

See `docs/AI_ENGINE.md §10`.
"""

from __future__ import annotations

from app.services.rag import cited_markers, strip_invalid_citations


def test_valid_markers_survive_untouched():
    text = "Attention weights are normalised [[1]] and then applied [[2]]."
    cleaned, dropped = strip_invalid_citations(text, 2)
    assert cleaned == text
    assert dropped == []


def test_out_of_range_marker_is_removed():
    text = "Self-attention scales with sequence length [[7]]."
    cleaned, dropped = strip_invalid_citations(text, 4)
    assert "[[7]]" not in cleaned
    assert dropped == [7]


def test_removal_does_not_leave_a_space_before_punctuation():
    """A naive strip yields 'length .' — visibly broken prose."""
    cleaned, _ = strip_invalid_citations("Scales with length [[7]].", 4)
    assert cleaned == "Scales with length."


def test_mixed_valid_and_invalid_keeps_only_the_real_ones():
    text = "First [[1]], second [[9]], third [[2]]."
    cleaned, dropped = strip_invalid_citations(text, 2)
    assert "[[1]]" in cleaned and "[[2]]" in cleaned
    assert "[[9]]" not in cleaned
    assert dropped == [9]


def test_zero_is_out_of_range():
    """Markers are 1-indexed; [[0]] points at nothing."""
    cleaned, dropped = strip_invalid_citations("Claim [[0]].", 3)
    assert "[[0]]" not in cleaned
    assert dropped == [0]


def test_all_markers_dropped_when_there_were_no_sources():
    """The model sometimes cites even when retrieval returned nothing."""
    cleaned, dropped = strip_invalid_citations("Grounded, apparently [[1]].", 0)
    assert "[[1]]" not in cleaned
    assert dropped == [1]
    assert cleaned == "Grounded, apparently."


def test_duplicate_invalid_markers_reported_once():
    _, dropped = strip_invalid_citations("A [[5]] and again [[5]].", 1)
    assert dropped == [5]


def test_text_without_markers_is_unchanged():
    text = "No citations here at all."
    cleaned, dropped = strip_invalid_citations(text, 3)
    assert cleaned == text
    assert dropped == []


def test_bracketed_text_that_is_not_a_marker_is_left_alone():
    """`[[n]]` is the marker syntax; ordinary brackets must survive."""
    text = "The array [1] and the set [[a]] are unaffected."
    cleaned, dropped = strip_invalid_citations(text, 1)
    assert cleaned == text
    assert dropped == []


def test_cited_markers_lists_every_marker_present():
    assert cited_markers("A [[1]] and B [[2]], also A again [[1]].") == [1, 2, 1]


def test_cited_markers_empty_when_none_present():
    assert cited_markers("No sources needed here.") == []
