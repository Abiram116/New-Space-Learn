"""Scanned PDFs: the page pictures are found, shrunk, capped, paid for, and
read; a page that cannot be read does not lose the rest."""

from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from app.errors import RateLimited
from app.services import ocr


def scan(pages: int, size=(2480, 3508)) -> bytes:
    """A PDF that is nothing but pictures of pages — what a scanner makes."""
    images = []
    for i in range(pages):
        page = Image.new("RGB", size, "white")
        ImageDraw.Draw(page).text((200, 200), f"Page {i + 1}", fill="black")
        images.append(page)
    buffer = BytesIO()
    images[0].save(buffer, format="PDF", save_all=True, append_images=images[1:])
    return buffer.getvalue()


def test_each_page_picture_is_found_and_shrunk_and_the_cap_holds():
    pages, total = ocr.page_images(scan(4), limit=3)
    assert total == 4 and [n for n, _ in pages] == [1, 2, 3]
    picture = Image.open(BytesIO(pages[0][1]))
    assert picture.format == "JPEG" and max(picture.size) <= ocr.MAX_SIDE


async def test_pages_are_transcribed_with_their_numbers_and_headings(monkeypatch):
    monkeypatch.setattr(ocr.settings, "groq_api_key", "test-key")
    seen = []

    async def transcribe_page(jpeg):
        seen.append(len(jpeg))
        return f"# Heading {len(seen)}\nBody text on page {len(seen)}."

    async def pay(user_id, *, cost):
        assert cost == 1

    monkeypatch.setattr(ocr, "_transcribe_page", transcribe_page)
    monkeypatch.setattr(ocr, "consume_llm_quota", pay)
    lines, read, total = await ocr.transcribe(scan(2, size=(600, 800)), user_id="u")
    assert (read, total) == (2, 2)
    assert [(x.text, x.page, x.level) for x in lines if x.text] == [
        ("Heading 1", 1, 1), ("Body text on page 1.", 1, 0), ("Heading 2", 2, 1), ("Body text on page 2.", 2, 0),
    ]


async def test_a_failed_page_is_skipped_and_running_out_of_quota_stops_the_scan(monkeypatch):
    monkeypatch.setattr(ocr.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ocr, "QUOTA_WAIT_S", 0)
    calls = {"n": 0}

    async def transcribe_page(jpeg):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("vision model failed")
        return "Readable page."

    paid = {"n": 0}

    async def pay(user_id, *, cost):
        paid["n"] += 1
        if paid["n"] > 2:
            raise RateLimited("slow down")

    monkeypatch.setattr(ocr, "_transcribe_page", transcribe_page)
    monkeypatch.setattr(ocr, "consume_llm_quota", pay)
    lines, read, total = await ocr.transcribe(scan(4, size=(600, 800)), user_id="u")
    assert (read, total) == (1, 4)  # page 1 failed, page 2 read, page 3 had no quota
    assert [x.page for x in lines if x.text] == [2]


@pytest.mark.parametrize("configured", [False])
async def test_without_a_model_nothing_is_attempted(monkeypatch, configured):
    monkeypatch.setattr(ocr.settings, "groq_api_key", "")
    assert await ocr.transcribe(scan(1, size=(300, 300)), user_id="u") == ([], 0, 0)


async def test_a_rate_limited_page_waits_and_tries_again(monkeypatch):
    monkeypatch.setattr(ocr.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ocr, "RATE_WAIT_S", 0)
    tries = {"n": 0}

    async def transcribe_page(jpeg):
        tries["n"] += 1
        if tries["n"] < 3:
            raise RateLimited("at capacity")
        return "Read on the third try."

    async def pay(user_id, *, cost):
        return None

    monkeypatch.setattr(ocr, "_transcribe_page", transcribe_page)
    monkeypatch.setattr(ocr, "consume_llm_quota", pay)
    lines, read, _ = await ocr.transcribe(scan(1, size=(600, 800)), user_id="u")
    assert read == 1 and lines[0].text == "Read on the third try."


def test_an_image_too_big_to_decode_safely_is_skipped_without_decoding(monkeypatch):
    monkeypatch.setattr(ocr, "MAX_PIXELS", 1000)  # stands in for a decompression bomb
    pages, total = ocr.page_images(scan(1, size=(600, 800)))
    assert total == 1 and pages == [(1, None)]
