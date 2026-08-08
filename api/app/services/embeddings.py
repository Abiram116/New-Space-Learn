"""Chunking + embedding.

Chunking is deterministic and character-based (works for PDFs and plain text
without pulling tokenizer weights).

Embeddings run against any OpenAI-compatible `/embeddings` endpoint, or fall
back to a deterministic stub when no key is configured. **The stub is not
semantically meaningful** — it exists so the RAG plumbing is exercisable
without a provider account, and retrieval under it returns chunks in an
arbitrary-but-consistent order rather than by relevance. Set
`EMBEDDING_API_KEY` and `USE_STUB_EMBEDDINGS=false` to switch to real
retrieval; both are required (see `Settings.real_embeddings_enabled`).
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

import httpx

from ..config import settings
from ..errors import UpstreamUnavailable

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


# Module-level singleton, same pattern as `llm.py` — one connection pool per
# process, reused across requests so we don't pay a TLS handshake per upload.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.embedding_base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {settings.embedding_api_key}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(settings.embedding_timeout_s, connect=5.0),
        )
    return _client


async def close_client() -> None:
    """Called from the app's lifespan so the process exits promptly."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# Logged once per process, not per call — a warning on every upload would be
# noise, but silence would hide a misconfiguration that quietly degrades every
# search result in the product.
_warned_stub_fallback = False


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of strings.

    Returns one vector per input, in order. Callers treat these as opaque
    floats, so switching providers never reaches beyond this function.
    """

    if not texts:
        return []

    if not settings.real_embeddings_enabled:
        global _warned_stub_fallback
        if not settings.use_stub_embeddings and not _warned_stub_fallback:
            # The operator asked for real embeddings but gave us no key. Say so
            # loudly once: silently serving stubs would look like working
            # retrieval while returning arbitrary passages.
            log.warning(
                "USE_STUB_EMBEDDINGS=false but EMBEDDING_API_KEY is empty — "
                "falling back to stub embeddings. Retrieval will NOT be "
                "semantically meaningful until a key is set."
            )
            _warned_stub_fallback = True
        return [_stub_embedding(t) for t in texts]

    out: list[list[float]] = []
    for start in range(0, len(texts), settings.embedding_batch_size):
        batch = texts[start : start + settings.embedding_batch_size]
        out.extend(await _embed_batch(batch))
    return out


async def _embed_batch(batch: list[str]) -> list[list[float]]:
    # The provider rejects empty strings; chunking shouldn't produce them, but
    # a defensive placeholder is cheaper than a failed document ingest.
    payload = {
        "model": settings.embedding_model,
        "input": [t if t.strip() else " " for t in batch],
    }
    try:
        r = await _get_client().post("/embeddings", json=payload)
    except httpx.TimeoutException as e:
        raise UpstreamUnavailable("Embedding the document timed out.") from e
    except httpx.HTTPError as e:
        raise UpstreamUnavailable("Couldn't reach the embedding service.") from e

    if r.status_code >= 400:
        # Provider text goes to the log, never to the user — it can carry
        # account and quota details (same rule as `llm.py`).
        log.warning("embeddings %s: %s", r.status_code, r.text[:300])
        raise UpstreamUnavailable("The embedding service rejected the request.")

    data = r.json().get("data") or []
    if len(data) != len(batch):
        raise UpstreamUnavailable("The embedding service returned an unexpected response.")

    # Sort by index rather than trusting response order — the API documents
    # that it may not match the input order.
    ordered = sorted(data, key=lambda d: d.get("index", 0))
    vectors = [d["embedding"] for d in ordered]

    for v in vectors:
        if len(v) != settings.embedding_dim:
            # A dimension mismatch would be silently accepted by Postgres only
            # to fail at insert, or worse, poison the index. Fail loudly here
            # with the actual cause.
            raise UpstreamUnavailable(
                f"Embedding model returned {len(v)} dimensions, but the database "
                f"column expects {settings.embedding_dim}. Check EMBEDDING_MODEL."
            )
    return vectors


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
