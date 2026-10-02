"""Turns an uploaded file into lines of text that know their structure.

One async entry point, `read_document`. Each kind of file has a reader that
returns `chunking.Line`s — text with its page and whether it is a heading —
and nothing after this module knows or cares what the file was:

- PDF: `pdf_layout.read_pdf`, which works headings out from the type they are
  set in.
- Markdown, plain text: `chunking.read_text`.
- CSV: one line per row.
- Images: a vision model transcribes and describes them; the result is text.

Images need a model call; everything else is CPU-bound parsing, which runs in
a worker thread: on 0.1 vCPU an 80-page PDF is several seconds of pure Python,
and inline on the event loop that is several seconds during which every other
request, chat streams included, stands still.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging
from dataclasses import dataclass

from ..config import settings
from .chunking import Line, read_text
from .llm import get_llm
from .pdf_layout import read_pdf

log = logging.getLogger("space_learn.extract")

#: Fewer characters than this per page, on average, and the PDF is pictures of
#: pages rather than text.
SCAN_CHARS_PER_PAGE = 25


@dataclass(slots=True)
class Document:
    lines: list[Line]
    #: True for a PDF with pages but (almost) no text layer.
    scanned: bool = False

    @property
    def empty(self) -> bool:
        return not any(line.text.strip() for line in self.lines)


async def read_document(data: bytes, mime_type: str) -> Document:
    mime = mime_type.lower()
    if "image" in mime:
        return Document(read_text(await _extract_image_text(data, mime_type)))
    return await asyncio.to_thread(_read_sync, data, mime)


def _read_sync(data: bytes, mime: str) -> Document:
    if "pdf" in mime:
        lines, pages = read_pdf(data)
        chars = sum(len(line.text.strip()) for line in lines)
        return Document(lines, scanned=pages > 0 and chars < pages * SCAN_CHARS_PER_PAGE)
    if "csv" in mime:
        return Document([Line(row) for row in _extract_csv_text(data).split("\n")])
    # Everything else: assume UTF-8 text (markdown, plain, source).
    return Document(read_text(data.decode("utf-8", errors="ignore")))


def _extract_csv_text(data: bytes) -> str:
    """Pipe-joined rows read fine as chunked text and still cite a row
    range — no need for a separate tabular chunking strategy."""
    rows = list(csv.reader(io.StringIO(data.decode("utf-8", errors="ignore"))))
    if not rows:
        return ""
    # Cap so one huge export can't monopolise the ingestion queue.
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows[:2000])


async def _extract_image_text(data: bytes, mime_type: str) -> str:
    if not settings.llm_configured:
        return ""
    b64 = base64.b64encode(data).decode()
    prompt = (
        "Extract any visible text verbatim, then describe diagrams, charts, "
        "or photos in enough detail to be useful as study material. Plain "
        "text only, no markdown."
    )
    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {
                    "role": "system",
                    "content": "You transcribe and describe images for a study document index.",
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                        },
                    ],
                },
            ],
            model=settings.groq_model_vision,
            temperature=0.2,
        ):
            parts.append(delta)
        return "".join(parts).strip()
    except Exception:
        log.warning("image extraction failed", exc_info=True)
        return ""
