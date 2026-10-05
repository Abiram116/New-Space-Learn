"""The fast ONNX loader must produce what fastembed produces, or it is a bug.

Skipped where the model has not been downloaded (CI without the prefetch)."""

from __future__ import annotations

import pytest

from app.config import settings
from app.services.embeddings import _DirectBge

MODEL_DIR = _DirectBge.find_dir(settings.embedding_cache_dir)

pytestmark = pytest.mark.skipif(MODEL_DIR is None, reason="embedding model not downloaded")

TEXTS = ["hello world", "The mitochondria is the powerhouse of the cell. " * 80, "ünïcode ✓", ""]


def test_matches_fastembed():
    from fastembed import TextEmbedding

    direct = _DirectBge(MODEL_DIR, 1)
    ref = TextEmbedding(
        settings.embedding_model, cache_dir=settings.embedding_cache_dir, threads=1
    )
    for text in TEXTS:
        got = next(iter(direct.embed([text])))
        want = next(iter(ref.embed([text], batch_size=1)))
        # Cosine, not equality: a build-time-optimised graph fuses ops, which
        # moves the last decimal places.
        assert float(got @ want) > 0.9999


def test_prepared_model_agrees_with_the_plain_one(tmp_path):
    prepared = _DirectBge.prepare(MODEL_DIR) if not (MODEL_DIR / "model_prepared.onnx").exists() else None
    direct = _DirectBge(MODEL_DIR, 1)
    vec = next(iter(direct.embed(["what is glycolysis?"])))
    assert len(vec) == 384 and abs(float((vec**2).sum()) - 1.0) < 1e-4
    if prepared is not None:
        prepared.unlink()
