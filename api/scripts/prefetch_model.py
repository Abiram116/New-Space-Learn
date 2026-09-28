"""Download the embedding model at BUILD time, into the deployed image.

Render's container disk does not survive a spin-down, so without this the
model is re-downloaded on every cold start — ~9s of network plus the CPU to
unpack it, on a 0.1 vCPU box, on the first request after every idle period.
Run during `buildCommand`, the weights land inside the project directory,
which Render keeps as part of the built image; at runtime the model loads from
local disk and never touches the network.

Also runs one real inference, so a broken or truncated download fails the
BUILD — loudly, before deploy — instead of the first student's upload.

Usage (from api/, with EMBEDDING_CACHE_DIR set):
    uv run python scripts/prefetch_model.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402


def main() -> None:
    if settings.use_stub_embeddings:
        print("stub embeddings enabled; nothing to prefetch")
        return

    from fastembed import TextEmbedding

    started = time.perf_counter()
    model = TextEmbedding(
        model_name=settings.embedding_model,
        cache_dir=settings.embedding_cache_dir,
        threads=settings.embedding_threads,
    )
    vector = next(iter(model.embed(["prefetch check"]))).tolist()
    if len(vector) != settings.embedding_dim:
        raise SystemExit(
            f"model produced {len(vector)} dims, expected {settings.embedding_dim}"
        )
    print(
        f"prefetched {settings.embedding_model} into "
        f"{settings.embedding_cache_dir or 'default cache'} "
        f"({time.perf_counter() - started:.1f}s, {len(vector)} dims)"
    )


if __name__ == "__main__":
    main()
