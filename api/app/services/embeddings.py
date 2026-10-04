"""Embedding. (Reading and chunking documents live in `extract.py`,
`pdf_layout.py` and `chunking.py`.)

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
import threading
from typing import Protocol

from ..config import settings
from ..errors import UpstreamUnavailable
from .memo import TTLCache

log = logging.getLogger("space_learn.embed")


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
        # Startup warm-up and a resumed ingestion job can both reach this
        # first. Unguarded, both load the model: ~200MB twice on a 512MB box.
        self._load_lock = threading.Lock()

    def _get_model(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            from fastembed import TextEmbedding  # deferred: heavy import

            log.info("loading local embedding model %s (first use this process)", settings.embedding_model)
            # `threads` and `cache_dir` are both production-critical on
            # Render — see their notes in config.py. Unset locally, where
            # cores are real and the default cache is fine.
            self._model = TextEmbedding(
                model_name=settings.embedding_model,
                cache_dir=settings.embedding_cache_dir,
                threads=settings.embedding_threads,
            )
        return self._model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await asyncio.to_thread(self._embed_sync, texts)

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        try:
            model = self._get_model()
            # One sequence per forward pass. fastembed's default batches pad
            # every text to the longest, so attention memory grows with
            # batch x len^2: a batch of 52 real chunks peaked at 827MB — an
            # OOM kill on a 512MB instance. Measured on the same 52 chunks:
            # batch 52 = 20.3s/827MB, 8 = 13.1s/371MB, 1 = 9.0s/287MB.
            # Unbatched is not the memory-safe compromise; it is also fastest,
            # because no compute is spent on padding.
            batch = settings.embedding_infer_batch_size
            vectors = [v.tolist() for v in model.embed(texts, batch_size=batch)]
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


#: Question vectors already computed: a regenerate embeds the same text again.
_QUESTION_VECTORS: TTLCache[list[float]] = TTLCache(maxsize=256, ttl=900)


async def embed_question(texts: list[str]) -> list[list[float]]:
    """`embed_texts` for a student's question: the same text twice costs one embedding.

    Only a single text is cached. A batch is document text being indexed, which
    is neither repeated nor worth holding in memory.
    """
    if len(texts) != 1:
        return await embed_texts(texts)
    key = hashlib.sha256(texts[0].encode()).hexdigest()
    hit = _QUESTION_VECTORS.get(key)
    if hit is not None:
        return [hit]
    out = await embed_texts(texts)
    if out:
        _QUESTION_VECTORS.set(key, out[0])
    return out


def is_warm() -> bool:
    """True once the real model is loaded and an upload won't pay for it."""
    provider = _provider
    return isinstance(provider, LocalBgeEmbeddingProvider) and provider._model is not None  # noqa: SLF001


async def warm_provider() -> None:
    """Load the embedding model at startup, before anything needs it.

    The first embed in a fresh process otherwise pays the model load (~15s of
    `fastembed` import on a cold cache, more on 0.1 vCPU) — on a student's
    first chat query, or at the head of the first ingestion job. Loading here
    pays it once, off the request path, while nobody is waiting. The model
    files themselves are baked into the build (`scripts/prefetch_model.py`),
    so this never downloads in production.

    Deliberately best-effort: this must never stop the API from starting. If
    the model can't load, embedding fails loudly at `_embed_sync` with a real
    cause.
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
