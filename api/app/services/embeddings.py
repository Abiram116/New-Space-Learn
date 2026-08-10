"""Chunking + embedding.

Chunking is deterministic and character-based (works for PDFs and plain text
without pulling tokenizer weights).

Embeddings run **locally** — BGE-small-en-v1.5, quantized ONNX, via
`fastembed` — or fall back to a deterministic stub when disabled. No API key,
no external network dependency, no recurring cost. See
`docs/decisions.md` for the full investigation: a
hosted OpenAI-compatible provider was built, benchmarked, and replaced;
BGE-M3 was evaluated and rejected for production (its own weights alone are
~2.2GB, several times Render free tier's entire 512MB ceiling) and kept only
as an offline quality reference.

**The stub is not semantically meaningful** — it exists so the RAG plumbing
is exercisable with zero setup, and retrieval under it returns chunks in an
arbitrary-but-consistent order rather than by relevance. Set
`USE_STUB_EMBEDDINGS=false` to switch to the real local model — but only
after applying `supabase/migrations/20260810090000_embedding_dim_384.sql`
(BGE-small outputs 384 dims; the column is 1536 until that migration runs).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from typing import Protocol

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
        # This was an infinite loop for any document whose final chunk is
        # <= CHUNK_OVERLAP characters short of a full window: once `end`
        # hits `len(text)` the truncation branch above stops firing, so
        # `end` never changes again, and `start = end - CHUNK_OVERLAP`
        # recomputes to the exact same value forever — the same trailing
        # chunk gets appended without bound until memory runs out. This is
        # what "documents stuck at EMBEDDING CHUNKS" actually was; it had
        # nothing to do with embedding-provider timing. Breaking the moment
        # the window reaches the end of the text is the real fix; the
        # `max(..., start + 1)` on the other branch is a second guard so no
        # future change to the boundary-detection heuristic above can
        # reintroduce the same failure mode for a non-final chunk.
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
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


class EmbeddingProvider(Protocol):
    """One method, swappable. `llm.py`'s `LLM` Protocol is the precedent —
    same shape, same reason: the call site (`embed_texts`, below) never
    needs to know or care which concrete provider is behind it."""

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class StubEmbeddingProvider:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [_stub_embedding(t) for t in texts]


class LocalBgeEmbeddingProvider:
    """BGE-small-en-v1.5, quantized ONNX, via `fastembed`. Runs in-process —
    no network call, no API key.

    Two things this class exists specifically to get right:

    1. **Lazy load.** The model isn't built in `__init__` — building it costs
       real time (≈0.6s warm, longer on a cold cache) and ≈170-200MB RSS, and
       most requests (chat, auth, everything that isn't a document upload)
       never touch embeddings at all. Paying that cost at import time would
       tax every cold start, including ones that never need it.
    2. **Runs off the event loop.** `fastembed`'s `.embed()` is synchronous,
       CPU-bound inference — unlike the async HTTP call this replaced. Calling
       it directly inside an `async def` handler would block this
       single-worker process's *entire* event loop for the duration (tens to
       hundreds of ms per batch): every other concurrent request — a chat
       stream, an auth check, anything — would stall until it returned.
       `asyncio.to_thread` moves the blocking call to a worker thread so the
       loop stays responsive. This is the same class of constraint that
       already governs `ratelimit.py` and the sequential-vs-gather choices in
       `spaces.py` — one worker, so what blocks it matters.
    """

    def __init__(self) -> None:
        self._model = None  # type: ignore[var-annotated]

    def _get_model(self):
        if self._model is None:
            from fastembed import TextEmbedding  # deferred: heavy import

            log.info("loading local embedding model %s (first use this process)", settings.embedding_model)
            self._model = TextEmbedding(model_name=settings.embedding_model)
        return self._model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await asyncio.to_thread(self._embed_sync, texts)

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        try:
            model = self._get_model()
            vectors = [v.tolist() for v in model.embed(texts)]
        except Exception as e:
            # Model load or inference failed (corrupt cache, blocked network
            # on a first-ever download, OOM). Surface it — a silent fallback
            # to meaningless vectors is exactly the failure mode this
            # project has already spent a phase eliminating once.
            log.exception("local embedding inference failed")
            raise UpstreamUnavailable("Couldn't embed the document locally.") from e

        for v in vectors:
            if len(v) != settings.embedding_dim:
                # Would otherwise fail later at the Postgres insert, or worse,
                # silently poison the index if the check weren't here. Fail
                # loudly with the actual cause instead.
                raise UpstreamUnavailable(
                    f"Embedding model returned {len(v)} dimensions, but the "
                    f"database column expects {settings.embedding_dim}. Has "
                    f"the vector(384) migration been applied?"
                )
        return vectors


_provider: EmbeddingProvider | None = None


def _get_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        _provider = StubEmbeddingProvider() if settings.use_stub_embeddings else LocalBgeEmbeddingProvider()
    return _provider


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of strings.

    Returns one vector per input, in order. Callers treat these as opaque
    floats, so switching providers never reaches beyond this function —
    `documents.py` and `rag.py` haven't changed at all across three different
    providers now (stub, hosted HTTP, local ONNX).
    """

    if not texts:
        return []

    provider = _get_provider()
    out: list[list[float]] = []
    for start in range(0, len(texts), settings.embedding_batch_size):
        batch = texts[start : start + settings.embedding_batch_size]
        out.extend(await provider.embed(batch))
    return out


async def warm_provider() -> None:
    """Load the embedding model before the first upload needs it.

    Why this exists: `documents.py` caps inline processing at
    `PROCESSING_BUDGET_S` (25s) via `asyncio.wait_for`. On the first embed call
    in a fresh process, `LocalBgeEmbeddingProvider._get_model()` pays ~15s of
    `fastembed` import plus ~9s of model download on a cold cache (measured in
    docs/decisions.md) *inside* that budget, before a single vector exists. It blows the
    cap, `documents.py` catches `TimeoutError`, and the row is left at
    `status: "processing"` — the "stuck at embedding chunks" symptom.

    It's confusing to diagnose because `asyncio.wait_for` cannot cancel an OS
    thread: the load finishes in the background anyway and populates
    `self._model`, so a retry succeeds instantly and the failure looks
    intermittent. On Render the container spins down and takes the disk cache
    with it, so production pays the full cost on every cold start and fails far
    more consistently than local does.

    Raising the budget would only move where it hurts — the student would wait
    40s on an upload instead of failing at 25. Loading here means the cost is
    paid once, off the request path, while nobody is waiting.

    Deliberately best-effort: this must never stop the API from starting. If
    the model can't load, uploads fail loudly at `_embed_sync` with a real
    cause, which is the behaviour that already exists.
    """

    if settings.use_stub_embeddings:
        return

    provider = _get_provider()
    get_model = getattr(provider, "_get_model", None)
    if get_model is None:
        return

    try:
        await asyncio.to_thread(get_model)
        log.info("embedding model warm and ready")
    except Exception:
        log.exception("embedding model warm-up failed; uploads will retry on demand")


async def close_client() -> None:
    """Kept so `main.py`'s lifespan doesn't need to change per provider.
    The local model holds no network connection — nothing to close — but a
    future hosted provider would need this hook again, which is the point of
    keeping it a stable no-op rather than deleting it."""


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
