"""Embeds the benchmark's text once and remembers it.

The real model, never the stub: `settings.use_stub_embeddings` is forced off
here, so a benchmark run cannot quietly measure meaningless vectors because a
local `.env` still has the stub on. Vectors are cached on disk by content, so
a re-run embeds only text it has not seen (a new chunker, a new question).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import numpy as np

from app.config import settings

settings.use_stub_embeddings = False  # before anything builds the provider

from app.services import embeddings  # noqa: E402

_CACHE = Path(__file__).resolve().parent / ".cache"


def _key(text: str, kind: str) -> str:
    return hashlib.sha1(f"{settings.embedding_model}|{kind}|{text}".encode()).hexdigest()


class Embedder:
    """`embed(texts, kind)` → one unit vector per text. `kind` separates
    vectors made differently from the same words (a passage, a prefixed query)."""

    def __init__(self) -> None:
        _CACHE.mkdir(exist_ok=True)
        self._path = _CACHE / "vectors.json"
        self._store: dict[str, list[float]] = json.loads(self._path.read_text()) if self._path.exists() else {}
        self._dirty = False

    def embed(self, texts: list[str], kind: str = "passage") -> np.ndarray:
        missing = [t for t in dict.fromkeys(texts) if _key(t, kind) not in self._store]
        if missing:
            vectors = asyncio.run(embeddings.embed_texts(missing))
            for text, vector in zip(missing, vectors, strict=True):
                self._store[_key(text, kind)] = [round(float(x), 6) for x in vector]
            self._dirty = True
        out = np.array([self._store[_key(t, kind)] for t in texts], dtype=np.float32)
        return out / np.clip(np.linalg.norm(out, axis=1, keepdims=True), 1e-12, None)

    async def aembed(self, texts: list[str]) -> list[list[float]]:
        """The same cache, for code that is already inside an event loop (the
        retrieval pipeline). Texts are cached exactly as given, prefix and all."""
        missing = [t for t in dict.fromkeys(texts) if _key(t, "raw") not in self._store]
        if missing:
            for text, vector in zip(missing, await embeddings.embed_texts(missing), strict=True):
                self._store[_key(text, "raw")] = [round(float(x), 6) for x in vector]
            self._dirty = True
        return [self._store[_key(t, "raw")] for t in texts]

    def time_one(self, texts: list[str]) -> float:
        """Median milliseconds to embed one text, bypassing the cache."""
        import time

        timings = []
        for text in texts:
            started = time.perf_counter()
            asyncio.run(embeddings.embed_texts([text]))
            timings.append((time.perf_counter() - started) * 1000)
        return round(sorted(timings)[len(timings) // 2], 1)

    def save(self) -> None:
        if self._dirty:
            self._path.write_text(json.dumps(self._store))
            self._dirty = False
