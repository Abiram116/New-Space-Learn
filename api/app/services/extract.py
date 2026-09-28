"""Text extraction for uploaded study material.

One async entry point. Images need a model call (vision); everything else is
CPU-bound parsing, which runs in a worker thread: pypdf is pure Python, and
on 0.1 vCPU an 80-page PDF is ~5s of it — inline on the event loop, that was
~5s during which every other request, chat streams included, stood still.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging

from ..config import settings
from .embeddings import extract_pdf_text
from .llm import get_llm

log = logging.getLogger("space_learn.extract")


async def extract_text(data: bytes, mime_type: str) -> str:
    if "image" in mime_type.lower():
        return await _extract_image_text(data, mime_type)
    return await asyncio.to_thread(_extract_sync, data, mime_type)


def _extract_sync(data: bytes, mime_type: str) -> str:
    if "pdf" in mime_type.lower():
        return extract_pdf_text(data)
    if "csv" in mime_type.lower():
        return _extract_csv_text(data)
    # Everything else: assume UTF-8 text (markdown, plain, source).
    return data.decode("utf-8", errors="ignore")


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
