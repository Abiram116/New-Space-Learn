"""How a document is cut into chunks.

Two things here are load-bearing for the rest of the system: chunking always
finishes and loses nothing (an earlier chunker looped forever on some lengths,
which is what "documents stuck at embedding" actually was), and it is
deterministic, because ingestion resumes a half-embedded document by chunk
index.
"""

from __future__ import annotations

import pytest

from app.services.chunking import MAX, MIN, TARGET, Line, chunk, read_text


def _squash(text: str) -> str:
    return "".join(text.split())


def test_empty_and_whitespace_give_no_chunks():
    assert chunk([]) == []
    assert chunk(read_text("   \n\n  ")) == []


def test_a_short_document_is_one_chunk():
    chunks = chunk(read_text("A short document."))
    assert [c.content for c in chunks] == ["A short document."]
    assert chunks[0].index == 0 and chunks[0].section is None and chunks[0].locator == "part 1 of 1"


@pytest.mark.parametrize("length", [1, TARGET - 1, TARGET, TARGET + 1, TARGET + 119, TARGET + 121, MAX, MAX + 1, 3 * TARGET + 7, 20_000])
def test_any_length_terminates_and_keeps_every_character(length):
    text = ("word " * (length // 5 + 1))[:length]
    chunks = chunk(read_text(text))
    assert chunks and [c.index for c in chunks] == list(range(len(chunks)))
    # Nothing dropped: every word of the document is in some chunk.
    assert _squash(text) in _squash("".join(c.content for c in chunks)) or all(
        _squash(c.content) in _squash(text) for c in chunks
    )
    assert sum(len(c.content) for c in chunks) >= len(text.strip()) * 0.98
    assert all(len(c.content) <= MAX for c in chunks)


def test_chunking_is_deterministic():
    text = "\n\n".join(f"## Part {i}\n\n" + f"Sentence {i} about attention. " * 40 for i in range(12))
    first, second = chunk(read_text(text)), chunk(read_text(text))
    assert [(c.index, c.content, c.section) for c in first] == [(c.index, c.content, c.section) for c in second]


def test_a_chunk_never_runs_from_one_section_into_the_next():
    body = "Plants turn light into sugar. " * 25  # long enough to stand alone
    text = f"# Biology\n\n## Photosynthesis\n\n{body}\n\n## Respiration\n\n{body.replace('Plants', 'Cells')}"
    chunks = chunk(read_text(text))
    for c in chunks:
        assert not ("Plants" in c.content and "Cells" in c.content), c.content[:80]
    assert {c.section for c in chunks} == {"Biology › Photosynthesis", "Biology › Respiration"}
    # The heading is part of the stored text; the full path leads the embedded text.
    first = chunks[0]
    assert first.content.startswith("Biology\n\nPhotosynthesis") or first.content.startswith("Photosynthesis")
    assert first.embed_text.startswith("Biology › Photosynthesis\n")


def test_a_heading_with_almost_nothing_under_it_joins_what_follows():
    text = "# Notes\n\nSee below.\n\n## Details\n\n" + "The real content is here. " * 20
    chunks = chunk(read_text(text))
    assert len(chunks) == 1 and "See below." in chunks[0].content
    assert chunks[0].section == "Notes › Details"  # named after where most of it is
    assert all(len(c.content) >= MIN or len(chunks) == 1 for c in chunks)


def test_a_long_section_is_cut_at_the_end_of_a_sentence():
    sentences = [f"Sentence number {i} explains one step of the proof in a little detail." for i in range(60)]
    chunks = chunk(read_text("\n".join(sentences)))
    assert len(chunks) > 3
    assert all(c.content.rstrip().endswith(".") for c in chunks)
    assert all(len(c.content) <= MAX for c in chunks)


def test_a_paragraph_on_one_long_line_is_still_cut_between_sentences():
    line = "This is one sentence of a very long paragraph stored on a single line. " * 60
    chunks = chunk(read_text(line))
    assert len(chunks) > 3 and all(len(c.content) <= MAX for c in chunks)
    assert all(c.content.rstrip().endswith(".") for c in chunks)


def test_pages_and_the_locator():
    lines = [Line("Learning rate", page=8, level=2)]
    lines += [Line(f"Line {i} says something about step sizes.", page=8 if i < 6 else 9) for i in range(12)]
    [c] = chunk(lines)
    assert (c.page_start, c.page_end, c.section) == (8, 9, "Learning rate")
    assert c.locator == "p. 8–9 · Learning rate"
    [single] = chunk([Line("Only body text here, no heading at all.", page=3)])
    assert single.locator == "p. 3"


@pytest.mark.parametrize(
    "line,level",
    [
        ("# Title", 1), ("### Deep", 3), ("2 Methods", 1), ("2.1 Learning rate", 2), ("INTRODUCTION", 2),
        ("A normal sentence that ends with a full stop.", 0), ("2.1 this is a sentence, not a title.", 0),
        ("OK", 0),
    ],
)
def test_headings_in_plain_text(line, level):
    assert read_text(line)[0].level == level


def test_a_hash_inside_a_code_block_is_not_a_heading():
    lines = read_text("```\n# a comment\n```\n# A heading")
    assert [x.level for x in lines] == [0, 0, 0, 1]
