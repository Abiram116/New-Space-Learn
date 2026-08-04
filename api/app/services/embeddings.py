"""Chunking + embedding.

Chunking is deterministic and character-based (works for PDFs and plain text
without pulling tokenizer weights). Embeddings default to a zero-vector stub
so the RAG pipeline is exercisable without any AI key — flip
`USE_STUB_EMBEDDINGS=false` in .env once a real embedding provider is wired.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from ..config import settings

log = logging.getLogger("space_learn.embed")


CHUNK_SIZE = 900       # ~200 tokens
CHUNK_OVERLAP = 120    # keeps sentence boundaries surviving splits


@dataclass(slots=True)
class Chunk:
    index: int
    content: str
    locator: str        # human-readable page / slide / offset


def chunk_text(text: str, *, source_label: str = "text") -> list[Chunk]:
    """Split `text` into overlapping windows.

    We look for the nearest paragraph boundary near the chunk edge so answers
    read as full sentences, not mid-word cuts.
    """

    text = text.strip()
    if not text:
        return []

    chunks: list[Chunk] = []
    start = 0
    idx = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_SIZE)
        if end < len(text):
            # Prefer a paragraph break, else a sentence-ish boundary.
            window = text[start:end]
            para = window.rfind("\n\n")
            sent = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
            cut = max(para, sent)
            if cut > CHUNK_SIZE * 0.4:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(
                Chunk(index=idx, content=piece, locator=f"{source_label} · offset {start}")
            )
            idx += 1
        start = end - CHUNK_OVERLAP
    return chunks


def _stub_embedding(text: str) -> list[float]:
    """Deterministic pseudo-embedding — same input → same vector.

    Not semantically meaningful. Its only job is to make the RAG plumbing
    testable end-to-end without a real embedding provider.
    """

    dim = settings.embedding_dim
    seed = hashlib.sha256(text.encode("utf-8")).digest()
    # Cycle the hash bytes across the vector, normalized to a small magnitude.
    vec = [((seed[i % len(seed)] / 255.0) - 0.5) * 0.001 for i in range(dim)]
    return vec


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of strings.

    Today: always stubbed. Tomorrow: check `settings.use_stub_embeddings` and
    fan out to an OpenAI-compatible embeddings endpoint. Every caller already
    treats these as opaque floats, so the swap is one function.
    """

    if not texts:
        return []
    if settings.use_stub_embeddings:
        return [_stub_embedding(t) for t in texts]
    # TODO: real embedding provider — Groq doesn't host one, so this will
    # likely proxy to OpenAI's text-embedding-3-small.
    return [_stub_embedding(t) for t in texts]


def extract_pdf_text(data: bytes) -> str:
    """Pull text out of a PDF's pages, keeping page numbers in the stream."""

    try:
        from pypdf import PdfReader  # imported here to keep cold-start light
    except Exception:  # pragma: no cover
        return ""
    from io import BytesIO

    reader = PdfReader(BytesIO(data))
    parts: list[str] = []
    for page_num, page in enumerate(reader.pages, start=1):
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        parts.append(f"[p.{page_num}]\n{txt}")
    return "\n\n".join(parts)
