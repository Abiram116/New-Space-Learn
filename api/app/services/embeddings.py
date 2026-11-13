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
import json
import logging
import tempfile
import threading
from pathlib import Path
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


#: The model `_DirectBge` knows how to run; any other falls back to fastembed.
_DIRECT_MODEL = "BAAI/bge-small-en-v1.5"
#: Build-time graph-optimised copy of the model (see `_DirectBge.prepare`).
PREPARED_MODEL = "model_prepared.onnx"


class _DirectBge:
    """BGE-small ONNX run straight on `onnxruntime` + `tokenizers`.

    Why not just `fastembed.TextEmbedding`: importing `fastembed` pulls in its
    image, sparse, late-interaction and rerank modules plus `huggingface_hub`
    (1.1s here, ~10s on 0.1 vCPU) and constructing it runs a hub lookup (0.75s
    here, ~6s on 0.1 vCPU) — all to do three things: tokenise, run the ONNX
    graph, take the CLS vector and L2-normalise it. This does exactly those,
    from the files `scripts/prefetch_model.py` already put on disk. The output
    is identical to fastembed's (checked in `tests/test_embeddings_direct.py`).
    `load()` raises if anything is missing and the caller falls back to
    fastembed, so this can only ever make a start faster, never break one.
    """

    def __init__(self, model_dir: Path, threads: int | None) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self._np = np
        cfg = json.loads((model_dir / "tokenizer_config.json").read_text())
        max_len = min(cfg.get("model_max_length", 512), cfg.get("max_length", 512))
        tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        tok.enable_truncation(max_length=max_len)
        if not tok.padding:
            tok.enable_padding(
                pad_id=json.loads((model_dir / "config.json").read_text()).get("pad_token_id", 0),
                pad_token=cfg["pad_token"],
            )
        self._tok = tok

        so = ort.SessionOptions()
        if threads is not None:
            so.intra_op_num_threads = threads
            so.inter_op_num_threads = threads
        # The arena keeps every intermediate buffer it ever grew to; with one
        # sequence per pass there is nothing to reuse across calls.
        so.enable_cpu_mem_arena = False
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        prepared = model_dir / PREPARED_MODEL
        if prepared.is_file():
            # Already graph-optimised at build time (`prepare`): skip the
            # optimiser, which at startup costs ~0.2s here (~2s on 0.1 vCPU)
            # and ~80MB of resident memory that is never given back.
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            path = prepared
        else:
            path = model_dir / "model_optimized.onnx"
        self._sess = ort.InferenceSession(str(path), sess_options=so, providers=["CPUExecutionProvider"])
        self._inputs = {n.name for n in self._sess.get_inputs()}

    @staticmethod
    def prepare(model_dir: Path) -> Path:
        """Write the graph-optimised copy of the model next to the original.

        Run once at build time (`scripts/prefetch_model.py`). EXTENDED, not ALL:
        ALL adds hardware-specific layout rewrites, and the build machine need
        not be the one that serves. Same inference speed, ~80MB less resident.
        """
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
        out = model_dir / PREPARED_MODEL
        so.optimized_model_filepath = str(out)
        ort.InferenceSession(
            str(model_dir / "model_optimized.onnx"), sess_options=so, providers=["CPUExecutionProvider"]
        )
        return out

    @staticmethod
    def find_dir(cache_dir: str | None) -> Path | None:
        root = Path(cache_dir) if cache_dir else Path(tempfile.gettempdir()) / "fastembed_cache"
        for model in sorted(root.glob("models--*bge-small-en-v1.5*")):
            for snap in sorted((model / "snapshots").glob("*")):
                if (snap / "model_optimized.onnx").is_file() and (snap / "tokenizer.json").is_file():
                    return snap
        return None

    def embed(self, texts: list[str], batch_size: int = 1):
        np = self._np
        for start in range(0, len(texts), batch_size):
            enc = self._tok.encode_batch(texts[start : start + batch_size])
            feed = {"input_ids": np.array([e.ids for e in enc], dtype=np.int64)}
            if "attention_mask" in self._inputs:
                feed["attention_mask"] = np.array([e.attention_mask for e in enc], dtype=np.int64)
            if "token_type_ids" in self._inputs:
                feed["token_type_ids"] = np.zeros_like(feed["input_ids"])
            hidden = self._sess.run(None, feed)[0]
            cls = hidden[:, 0] if hidden.ndim == 3 else hidden
            norm = np.maximum(np.linalg.norm(cls, axis=1, keepdims=True), 1e-12)
            yield from cls / norm


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
            log.info("loading local embedding model %s (first use this process)", settings.embedding_model)
            self._model = self._load()
        return self._model

    @staticmethod
    def _load():
        # Fast path first (see `_DirectBge`); fastembed is the safety net.
        if settings.embedding_model == _DIRECT_MODEL:
            try:
                model_dir = _DirectBge.find_dir(settings.embedding_cache_dir)
                if model_dir is not None:
                    model = _DirectBge(model_dir, settings.embedding_threads)
                    next(iter(model.embed(["warm up"])))
                    return model
            except Exception:
                log.warning("direct ONNX load failed; falling back to fastembed", exc_info=True)
        from fastembed import TextEmbedding  # deferred: heavy import

        # `threads` and `cache_dir` are both production-critical on Render —
        # see their notes in config.py.
        return TextEmbedding(
            model_name=settings.embedding_model,
            cache_dir=settings.embedding_cache_dir,
            threads=settings.embedding_threads,
            enable_cpu_mem_arena=False,
        )

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


async def warm_provider(delay: float = 0.0) -> None:
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

    if delay:
        # Let the first request (the one that woke the instance) finish before
        # the load takes the CPU: on 0.1 vCPU the load and a request run at
        # half speed each, and the student is waiting on the request.
        await asyncio.sleep(delay)

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
