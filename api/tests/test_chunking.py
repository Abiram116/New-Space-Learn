"""chunk_text must terminate for every input, and every non-empty input must
produce at least one non-empty chunk.

This exists because of a real bug: once a document's final window landed
exactly at `len(text)`, the boundary-truncation branch stopped firing, so
`start` recomputed to the same value forever and the loop never terminated —
appending the same trailing chunk until the process ran out of memory. That
was the actual cause of documents hanging at "embedding chunks"; it had
nothing to do with the embedding provider. See embeddings.py's chunk_text.
"""

from __future__ import annotations

import pytest

from app.services.embeddings import CHUNK_OVERLAP, CHUNK_SIZE, chunk_text


def test_empty_text_produces_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_short_text_is_one_chunk():
    chunks = chunk_text("A short document.")
    assert len(chunks) == 1
    assert chunks[0].content == "A short document."


def test_the_exact_length_that_used_to_hang_forever():
    # 2062 characters is the real extracted length of the PDF that triggered
    # this bug during manual verification — three windows in, the remaining
    # tail landed inside CHUNK_OVERLAP of the text's end.
    text = ("word " * 500)[:2062]
    chunks = chunk_text(text)
    assert len(chunks) > 0
    assert all(c.content for c in chunks)


@pytest.mark.parametrize("n", list(range(0, 2000, 37)))
def test_every_length_near_the_chunk_boundary_terminates(n: int):
    # Sweeps lengths across and just past CHUNK_SIZE / CHUNK_OVERLAP
    # boundaries, since the bug only manifested for specific remainders.
    text = ("sentence. " * (n // 10 + 1))[:n]
    chunks = chunk_text(text)
    if text.strip():
        assert len(chunks) > 0
    assert all(c.content for c in chunks)


def test_locator_is_position_only_never_the_document_name():
    """Regression: `locator` used to be built as `f"{source_label} · offset
    {start}"`, baking the document's filename into the position string.
    Every consumer (ChatMessage's citation cards, notes' `sourceLine`,
    DocsView) already pairs `document_name` with `locator` on the assumption
    the two are complementary — with the filename inside `locator` too, two
    citations to the same document rendered as "file.pdf · file.pdf ·
    offset 5306". `chunk_text` no longer takes a document name at all, so
    there is nothing left for it to bake in."""
    chunks = chunk_text("word " * 500)
    for c in chunks:
        assert c.locator.startswith("offset ")
        assert c.locator == f"offset {c.locator.split(' ')[1]}"


def test_start_always_advances():
    # A direct assertion on the invariant that broke: every emitted chunk's
    # start offset must be strictly greater than the previous one, so the
    # loop provably cannot repeat the same window forever.
    text = "Paragraph one is here.\n\n" * 5 + "x" * (CHUNK_SIZE + CHUNK_OVERLAP + 5)
    chunks = chunk_text(text)
    offsets = [int(c.locator.rsplit(" ", 1)[-1]) for c in chunks]
    assert offsets == sorted(set(offsets))
    assert all(b > a for a, b in zip(offsets, offsets[1:], strict=False))
