"""Reading a scanned PDF: one picture per page, transcribed by the vision model.

A scan has no text layer, so `pdf_layout` finds nothing to read. But a scan is
almost always just one image per page, stored as it was captured. Those images
are taken straight out of the PDF (no renderer, no new dependency: `pypdf`
extracts them and Pillow, already installed, shrinks them) and each page is
sent to the vision model to transcribe.

It is the most expensive thing ingestion does — a model call per page — so:

- **A page cap.** Only the first `MAX_PAGES` pages are read; the document says
  so when there were more.
- **Charged to the student, per page.** Each page takes one unit of the same
  quota chat uses, waiting for it to refill rather than failing, so a pile of
  scans cannot spend everyone's model budget.
- **Small images.** Pages are scaled to at most `MAX_SIDE` pixels and sent as
  JPEG: enough to read print, a fraction of a full-resolution scan.
- **Partial is fine.** A page that cannot be read (an unusual image format, a
  failed call) is skipped; the rest are kept.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from io import BytesIO

from ..config import settings
from ..errors import RateLimited
from . import usage
from .chunking import Line, read_text
from .llm import get_llm
from .ratelimit import consume_llm_quota

log = logging.getLogger("space_learn.ocr")

MAX_PAGES = 12
MAX_SIDE = 1280
#: An image larger than this is never decoded. A PDF can hold a tiny, highly
#: compressed image that decodes to gigabytes — on a 512 MB server, a crash.
#: 40 megapixels is an A4 page scanned at 600 dpi with room to spare.
MAX_PIXELS = 40_000_000
JPEG_QUALITY = 80
#: The longest a page waits for the student's quota to refill.
QUOTA_WAIT_S = 120.0
#: The vision model allows ~7,000 input tokens a minute on the free tier and a
#: page is ~1,500-2,100 of them, so a scan hits the limit every few pages. A
#: limited page waits and tries again rather than being skipped.
RATE_RETRIES = 4
RATE_WAIT_S = 15.0

_PROMPT = (
    "Transcribe all the text on this page exactly, in reading order. Put '# ' in front of each heading. "
    "If there is a diagram, chart or table, describe what it shows in one or two sentences. "
    "Plain text only. If the page has no text, reply with nothing."
)


def page_images(data: bytes, limit: int = MAX_PAGES) -> tuple[list[tuple[int, bytes | None]], int]:
    """(page number, JPEG bytes or None) for the first `limit` pages, and the
    page count — read in a separate, limited process (see `pdf_worker`)."""
    from .pdf_worker import read_page_images

    return read_page_images(data, limit, MAX_PIXELS)


def extract_page_images(data: bytes, limit: int, max_pixels: int) -> tuple[list[tuple[int, bytes | None]], int]:
    """The work behind `page_images`, run inside the worker process. Each
    page's largest image is taken to be the scan of it."""
    from PIL import Image
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    out: list[tuple[int, bytes | None]] = []
    for number, page in enumerate(reader.pages[:limit], start=1):
        try:
            if _largest_pixels(page) > max_pixels:
                log.info("scanned page %d skipped: image too large to decode safely", number)
                out.append((number, None))
                continue
            images = list(page.images)
            if not images:
                out.append((number, None))
                continue
            largest = max(images, key=lambda im: len(im.data))
            picture: Image.Image = largest.image.convert("RGB")
            picture.thumbnail((MAX_SIDE, MAX_SIDE))
            buffer = BytesIO()
            picture.save(buffer, format="JPEG", quality=JPEG_QUALITY)
            out.append((number, buffer.getvalue()))
        except Exception:  # an image format pypdf cannot decode, a broken page
            log.info("scanned page %d could not be read", number)
            out.append((number, None))
    return out, len(reader.pages)


def _largest_pixels(page) -> int:  # noqa: ANN001 - pypdf's PageObject
    """The pixel count of the page's biggest image, read from its declared size
    — without decoding anything."""
    try:
        xobjects = page["/Resources"]["/XObject"].get_object()
    except (KeyError, TypeError, AttributeError):
        return 0
    largest = 0
    for ref in xobjects.values():
        obj = ref.get_object()
        if obj.get("/Subtype") == "/Image":
            largest = max(largest, int(obj.get("/Width", 0)) * int(obj.get("/Height", 0)))
    return largest


@usage.tagged("ocr.page")
async def _transcribe_page(jpeg: bytes) -> str:
    url = f"data:image/jpeg;base64,{base64.b64encode(jpeg).decode()}"
    parts: list[str] = []
    async for delta in get_llm().stream_chat(
        [
            {"role": "system", "content": "You transcribe scanned pages for a student's study index."},
            {"role": "user", "content": [{"type": "text", "text": _PROMPT}, {"type": "image_url", "image_url": {"url": url}}]},
        ],
        model=settings.groq_model_vision,
        temperature=0.0,
    ):
        parts.append(delta)
    return "".join(parts).strip()


async def _pay(user_id: str) -> bool:
    """One unit of the student's quota, waiting for it if need be."""
    waited = 0.0
    while True:
        try:
            await consume_llm_quota(user_id, cost=1)
            return True
        except RateLimited:
            if waited >= QUOTA_WAIT_S:
                return False
            await asyncio.sleep(5)
            waited += 5


async def transcribe(data: bytes, *, user_id: str) -> tuple[list[Line], int, int]:
    """The scan's text as lines with their pages, how many pages were read,
    and how many the document has."""
    if not settings.llm_configured:
        return [], 0, 0
    pages, total = await asyncio.to_thread(page_images, data)
    lines: list[Line] = []
    read = 0
    for number, jpeg in pages:
        if jpeg is None:
            continue
        if not await _pay(user_id):
            log.info("scan stopped at page %d: quota", number)
            break
        text = None
        for attempt in range(RATE_RETRIES + 1):
            try:
                text = await _transcribe_page(jpeg)
                break
            except RateLimited:
                if attempt == RATE_RETRIES:
                    break
                await asyncio.sleep(RATE_WAIT_S)
            except Exception:  # one failed page must not lose the others
                log.warning("scanned page %d: transcription failed", number, exc_info=True)
                break
        if text is None:
            continue
        read += 1
        lines += [Line(line.text, page=number, level=line.level) for line in read_text(text)]
    return lines, read, total
