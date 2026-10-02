"""Reading structure out of a real PDF: headings from the type they are set
in, put back above the text they head, with their pages.

Uses one of the benchmark's documents — a PDF printed from a web page, which
draws each page's headings after its body text. Read naively, "Satisfying 2NF"
comes out at the bottom of its page, below the text it introduces.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services import chunking, extract
from app.services.pdf_layout import read_pdf

PDF = Path(__file__).resolve().parents[1] / "eval" / "corpus" / "database_normalization.pdf"


@pytest.fixture(scope="module")
def lines():
    out, pages = read_pdf(PDF.read_bytes())
    assert pages == 11
    return out


def test_headings_are_found_with_their_levels(lines):
    headings = [(x.level, x.text) for x in lines if x.level]
    assert (1, "Database normalization") in headings
    assert (2, "Objectives") in headings and (2, "Normal forms") in headings
    assert (3, "Satisfying 2NF") in headings and (3, "Satisfying 6NF") in headings
    # Body text is not mistaken for headings.
    assert len(headings) < 40 < len(lines)


def test_a_heading_sits_above_its_own_text_not_at_the_foot_of_the_page(lines):
    texts = [x.text for x in lines]
    heading = texts.index("Satisfying 2NF")
    body = next(i for i, t in enumerate(texts) if "which will not satisfy 2NF" in t)
    following = texts.index("Satisfying 3NF")
    assert heading < body < following


def test_chunks_carry_pages_and_the_heading_path(lines):
    chunks = chunking.chunk(lines)
    hit = next(c for c in chunks if "only Price also depends on Format" in c.content)
    assert hit.section == "Database normalization › Example › Satisfying 2NF"
    assert hit.page_start == 4 and hit.locator.startswith("p. 4")
    assert all(c.page_start is not None and c.page_start <= c.page_end for c in chunks)


def test_a_text_pdf_is_not_called_a_scan():
    doc = extract._read_sync(PDF.read_bytes(), "application/pdf")  # noqa: SLF001
    assert doc.scanned is False and not doc.empty


def test_a_pdf_with_pages_but_no_text_is_a_scan(monkeypatch):
    monkeypatch.setattr(extract, "read_pdf", lambda data: ([], 12))
    doc = extract._read_sync(b"%PDF", "application/pdf")  # noqa: SLF001
    assert doc.scanned is True and doc.empty
