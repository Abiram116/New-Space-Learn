"""The first chunker and PDF reader, frozen.

Production has moved on (`app/services/chunking.py`); the `baseline` pipeline
has to stay exactly what was measured, or the before/after table compares two
moving things. This is that code as it was, kept here and nowhere else.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

CHUNK_SIZE = 900
CHUNK_OVERLAP = 120


@dataclass(slots=True)
class Chunk:
    index: int
    content: str
    locator: str


def chunk_text(text: str) -> list[Chunk]:
    text = text.strip()
    if not text:
        return []
    chunks: list[Chunk] = []
    start = 0
    idx = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_SIZE)
        if end < len(text):
            window = text[start:end]
            para = window.rfind("\n\n")
            sent = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
            cut = max(para, sent)
            if cut > CHUNK_SIZE * 0.4:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(Chunk(index=idx, content=piece, locator=f"offset {start}"))
            idx += 1
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    parts: list[str] = []
    for page_num, page in enumerate(PdfReader(BytesIO(data)).pages, start=1):
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        parts.append(f"[p.{page_num}]\n{txt}")
    return "\n\n".join(parts)
