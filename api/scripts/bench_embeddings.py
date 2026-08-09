"""BGE-small-en-v1.5 (quantized ONNX, via fastembed) benchmark.

Deliberately run with `uv run --with fastembed --with psutil` rather than
added to pyproject.toml — this is an investigation, not yet a decision.
Nothing here becomes a real dependency unless the numbers justify it.

Measures, in this order, inside ONE process (matching how it would actually
run in production — inline, in the same worker as the rest of the API):
  1. Baseline RSS after importing the app's real modules (config, embeddings,
     chunk_text) — i.e. what's already loaded before a model is added.
  2. RSS delta from importing fastembed + loading the quantized BGE-small
     model — the model's actual marginal cost.
  3. Peak RSS while embedding the evaluation corpus.
  4. Latency: per-chunk embedding time (batch) and per-query time (single).
  5. Retrieval quality: Recall@5, Recall@10, MRR over the synthetic set
     (scripts/bench_eval_set.py) and, if present, a real-document set
     (scripts/bench_real_eval.json, produced separately from the one real
     document in the live database) — reported SEPARATELY, never averaged
     together, because they have very different statistical weight.

Usage (from api/):
    uv run --with fastembed --with psutil python scripts/bench_embeddings.py
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252, which can't encode the delta glyph used
# throughout this report's output — force utf-8 rather than dodge the glyph.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import psutil  # noqa: E402

_proc = psutil.Process()


def rss_mb() -> float:
    return _proc.memory_info().rss / (1024 * 1024)


def report(label: str, before: float, after: float) -> None:
    print(f"{label:42s} {before:7.1f} MB -> {after:7.1f} MB   (Δ {after - before:+7.1f} MB)")


def main() -> None:
    print("=" * 70)
    print("BGE-small-en-v1.5 (quantized ONNX / fastembed) — Render-fit benchmark")
    print("=" * 70)

    m0 = rss_mb()
    print(f"\nProcess RSS at interpreter start: {m0:.1f} MB")

    # Step 1 — load the same modules the real FastAPI worker loads at
    # startup, so "baseline" here means the same thing it means in prod.
    from app.config import settings  # noqa: F401
    from app.services.embeddings import chunk_text  # noqa: F401

    m1 = rss_mb()
    report("After importing app.config + embeddings", m0, m1)

    # Step 2 — the model itself.
    t_import0 = time.perf_counter()
    from fastembed import TextEmbedding

    t_import1 = time.perf_counter()
    m2 = rss_mb()
    report("After `import fastembed`", m1, m2)
    print(f"  import time: {(t_import1 - t_import0) * 1000:.0f} ms")

    t_load0 = time.perf_counter()
    model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    t_load1 = time.perf_counter()
    m3 = rss_mb()
    report("After loading BAAI/bge-small-en-v1.5 (quantized)", m2, m3)
    print(f"  model load time (incl. first-run download if needed): {(t_load1 - t_load0):.2f} s")

    print("\n--- Marginal cost of the model, on top of the real app baseline ---")
    print(f"App baseline (config+embeddings module loaded): {m1:.1f} MB")
    print(f"Model fully loaded, ready to embed:              {m3:.1f} MB")
    print(f"Model's own marginal footprint:                  {m3 - m1:+.1f} MB")

    # Step 3 — embed the synthetic evaluation corpus + queries, tracking peak RSS.
    from bench_eval_set import EVAL_SET, PASSAGES

    peak = m3

    def embed_batch(texts: list[str]) -> list[list[float]]:
        nonlocal peak
        t0 = time.perf_counter()
        vecs = list(model.embed(texts))
        dt = time.perf_counter() - t0
        peak = max(peak, rss_mb())
        return vecs, dt

    passage_vecs, passage_dt = embed_batch(PASSAGES)
    print(f"\nEmbedded {len(PASSAGES)} synthetic passages in {passage_dt * 1000:.0f} ms "
          f"({passage_dt / len(PASSAGES) * 1000:.1f} ms/passage)")

    query_texts = [e.query for e in EVAL_SET]
    query_vecs, query_dt = embed_batch(query_texts)
    print(f"Embedded {len(query_texts)} synthetic queries in {query_dt * 1000:.0f} ms "
          f"({query_dt / len(query_texts) * 1000:.1f} ms/query, single-query latency proxy)")

    peak = max(peak, rss_mb())
    print(f"\nPeak RSS during embedding: {peak:.1f} MB "
          f"(peak marginal over app baseline: {peak - m1:+.1f} MB)")

    # Step 4 — retrieval quality on the synthetic set.
    import numpy as np

    def to_matrix(vecs) -> np.ndarray:
        arr = np.array(vecs, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1e-9
        return arr / norms

    P = to_matrix(passage_vecs)
    Q = to_matrix(query_vecs)
    sims = Q @ P.T  # cosine similarity, since both are L2-normalized

    def evaluate(sims: np.ndarray, gold: list[int], k_values=(5, 10)) -> dict:
        n = sims.shape[0]
        ranks = np.argsort(-sims, axis=1)
        recall_at = {k: 0 for k in k_values}
        rr_sum = 0.0
        per_query = []
        for i in range(n):
            order = ranks[i]
            pos = int(np.where(order == gold[i])[0][0]) + 1  # 1-indexed rank
            rr_sum += 1.0 / pos
            per_query.append(pos)
            for k in k_values:
                if pos <= k:
                    recall_at[k] += 1
        return {
            "n": n,
            "recall": {k: v / n for k, v in recall_at.items()},
            "mrr": rr_sum / n,
            "ranks": per_query,
        }

    gold = [e.gold_index for e in EVAL_SET]
    result = evaluate(sims, gold)

    print("\n" + "=" * 70)
    print(f"RETRIEVAL QUALITY — synthetic set (N={result['n']} queries, "
          f"{len(PASSAGES)} candidate passages)")
    print("=" * 70)
    print(f"Recall@5:  {result['recall'][5]:.3f}")
    print(f"Recall@10: {result['recall'][10]:.3f}")
    print(f"MRR:       {result['mrr']:.3f}")
    misses = [(EVAL_SET[i].query, r) for i, r in enumerate(result["ranks"]) if r > 5]
    if misses:
        print("\nQueries that missed top-5 (rank shown):")
        for q, r in misses:
            print(f"  rank {r:2d}: {q}")

    # Step 5 — real document, if it's been extracted (see bench_real_corpus.py).
    real_path = Path(__file__).parent / "bench_real_eval.json"
    if real_path.exists():
        data = json.loads(real_path.read_text(encoding="utf-8"))
        real_chunks = data["chunks"]
        real_queries = data["queries"]  # [{"query": str, "gold_index": int}, ...]

        rc_vecs, rc_dt = embed_batch(real_chunks)
        rq_vecs, rq_dt = embed_batch([q["query"] for q in real_queries])
        RC = to_matrix(rc_vecs)
        RQ = to_matrix(rq_vecs)
        real_sims = RQ @ RC.T
        real_gold = [q["gold_index"] for q in real_queries]
        real_result = evaluate(real_sims, real_gold, k_values=(5,))

        print("\n" + "=" * 70)
        print(f"RETRIEVAL QUALITY — REAL document ({data.get('document_name', '?')}), "
              f"N={real_result['n']} queries, {len(real_chunks)} real chunks")
        print("(Small N — read as a real-content spot-check, not a statistically")
        print(" powered benchmark. See the synthetic set above for that.)")
        print("=" * 70)
        print(f"Recall@5:  {real_result['recall'][5]:.3f}")
        print(f"MRR:       {real_result['mrr']:.3f}")
    else:
        print(f"\n(No real-document eval set found at {real_path.name} — "
              f"run bench_real_corpus.py first if it's ready.)")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print("App baseline RSS (measured earlier via live uvicorn, Windows): ~57-60 MB")
    print(f"Model marginal RSS (this process, config+embeddings already loaded): "
          f"{m3 - m1:+.1f} MB")
    print(f"Peak marginal RSS during embedding: {peak - m1:+.1f} MB")
    print(f"Estimated combined footprint (baseline + model, same worker): "
          f"~{60 + (peak - m1):.0f} MB")
    print("Render free tier ceiling: 512 MB")


if __name__ == "__main__":
    main()
