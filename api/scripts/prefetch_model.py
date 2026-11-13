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


def _prepare_direct_model(reference: list[float]) -> None:
    """Pre-optimise the ONNX graph for the fast loader in `app.services.embeddings`.

    Checked against fastembed's own vector for the same text; if the prepared
    model disagrees at all it is deleted and the runtime uses the plain model.
    """
    from app.services.embeddings import _DIRECT_MODEL, _DirectBge

    if settings.embedding_model != _DIRECT_MODEL:
        return
    model_dir = _DirectBge.find_dir(settings.embedding_cache_dir)
    if model_dir is None:
        print("no model directory found for the fast loader; runtime will use fastembed")
        return
    prepared = _DirectBge.prepare(model_dir)
    got = next(iter(_DirectBge(model_dir, settings.embedding_threads).embed(["prefetch check"])))
    cosine = sum(a * float(b) for a, b in zip(reference, got, strict=True))
    if cosine < 0.999:
        prepared.unlink(missing_ok=True)
        print(f"prepared model disagreed with fastembed (cosine {cosine:.5f}); removed it")
    else:
        print(f"prepared {prepared.name} (cosine vs fastembed {cosine:.6f})")


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
    _prepare_direct_model(vector)
    print(
        f"prefetched {settings.embedding_model} into "
        f"{settings.embedding_cache_dir or 'default cache'} "
        f"({time.perf_counter() - started:.1f}s, {len(vector)} dims)"
    )


if __name__ == "__main__":
    main()
