"""`extract_title_line` — real titles for quizzes and flashcard decks alike.

Originally written for quizzes alone (they were showing "Untitled topic",
since "Quiz me on this chat" never asks for one). Flashcard decks had the
identical problem from a different cause: the chat "Make cards" agent seeds
`topic` from `firstSentence()` of the last reply — a raw excerpt, `…`
included — and nothing downstream ever replaced it with something written
as a title. Both generation prompts now ask the model for a `TITLE: ...`
line before its JSON payload; this is the shared parser for that line, now
living in `services/llm.py` so quiz and flashcard generation don't carry two
copies of the same non-trivial text parsing.

No route test here: this is pure text parsing with no I/O, so a unit test
against the real function is the direct way to cover it, same discipline as
`test_citations.py`'s coverage of `rag.strip_invalid_citations`.
"""

from __future__ import annotations

from app.services.llm import extract_title_line


def test_extracts_a_title_on_its_own_line_before_the_array():
    raw = 'TITLE: Policy Iteration Basics\n[{"q": "x"}]'
    assert extract_title_line(raw) == "Policy Iteration Basics"


def test_strips_leading_markdown_before_the_label():
    # `strip("*_# ")` trims the line's outer boundary, not text around the
    # "TITLE:" token itself — a leading `**` is stripped (it's the line's
    # first characters), a trailing `**` right after the colon isn't (the
    # colon interrupts the leading run before it gets there). The prompt
    # only asks the model for a plain line, so this is real, sufficient
    # behavior, not a bug — this test pins down what "sufficient" means.
    raw = '**TITLE: Bottleneck Layers\n[{"q": "x"}]'
    assert extract_title_line(raw) == "Bottleneck Layers"


def test_strips_surrounding_quotes():
    raw = 'TITLE: "Self-Attention"\n[{"q": "x"}]'
    assert extract_title_line(raw) == "Self-Attention"


def test_returns_none_when_no_title_line_exists():
    raw = '[{"q": "x"}]'
    assert extract_title_line(raw) is None


def test_ignores_the_word_title_inside_the_payload():
    # A generated question or card could contain the word "title" — only
    # text BEFORE the payload marker counts as the header the model was
    # asked to write.
    raw = 'Some preamble.\n[{"q": "What is the title of this paper?"}]'
    assert extract_title_line(raw) is None


def test_caps_length_at_140_chars():
    long_title = "A" * 200
    raw = f"TITLE: {long_title}\n[]"
    result = extract_title_line(raw)
    assert result is not None
    assert len(result) == 140


def test_before_marker_is_configurable_for_a_non_array_payload():
    # Flashcards' prompt precedes the same kind of JSON array, but a caller
    # with a differently-shaped payload (an object, say) isn't stuck
    # searching for `[` specifically.
    raw = 'TITLE: Custom Marker\n{"front": "x"}'
    assert extract_title_line(raw, before="{") == "Custom Marker"
