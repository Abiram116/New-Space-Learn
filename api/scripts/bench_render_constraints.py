"""Profile the upload + query pipeline stage by stage, under Render-free limits.

Every earlier number in docs/operations/performance-and-cost.md was measured on
a 16-core dev machine. Render free is 0.1 vCPU and 512MB, and for CPU-bound
work that is not a rounding difference — it is roughly 10x. This script puts a
number on each stage separately, so an optimisation targets where the time
actually goes rather than where it is assumed to go.

Run it inside a real CPU/memory cap (cgroup v2, no root needed):

    systemd-run --user --scope -q -p CPUQuota=10% -p MemoryMax=512M -- \\
        .venv/bin/python scripts/bench_render_constraints.py doc1.pdf doc2.pdf

Without the cap it still runs, and reports the dev-machine baseline to compare.
"""

from __future__ import annotations

import json
import resource
import sys
import time
from pathlib import Path

T0 = time.perf_counter()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.services.embeddings import chunk_text, extract_pdf_text  # noqa: E402

APP_IMPORT_S = time.perf_counter() - T0


def _rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def main(paths: list[str]) -> None:
    report: dict = {"app_import_s": round(APP_IMPORT_S, 2)}

    t = time.perf_counter()
    from fastembed import TextEmbedding

    report["fastembed_import_s"] = round(time.perf_counter() - t, 2)

    t = time.perf_counter()
    model = TextEmbedding(
        model_name=settings.embedding_model,
        cache_dir=settings.embedding_cache_dir,
        threads=settings.embedding_threads,
    )
    list(model.embed(["warm"]))
    report["model_load_s"] = round(time.perf_counter() - t, 2)

    # Query embedding = what every chat message pays before retrieval can run.
    q = "What is the difference between online and offline reinforcement learning?"
    samples = []
    for _ in range(5):
        t = time.perf_counter()
        list(model.embed([q]))
        samples.append(time.perf_counter() - t)
    report["query_embed_ms_median"] = round(sorted(samples)[2] * 1000)

    docs = []
    for p in paths:
        data = Path(p).read_bytes()
        t = time.perf_counter()
        text = extract_pdf_text(data)
        parse_s = time.perf_counter() - t

        t = time.perf_counter()
        chunks = chunk_text(text)
        chunk_s = time.perf_counter() - t

        t = time.perf_counter()
        list(model.embed([c.content for c in chunks], batch_size=settings.embedding_infer_batch_size))
        embed_s = time.perf_counter() - t

        total = parse_s + chunk_s + embed_s
        docs.append(
            {
                "doc": Path(p).name,
                "kb": len(data) // 1024,
                "pages": text.count("[p."),
                "chunks": len(chunks),
                "parse_s": round(parse_s, 2),
                "chunk_s": round(chunk_s, 3),
                "embed_s": round(embed_s, 2),
                "total_s": round(total, 2),
                "parse_pct": round(100 * parse_s / total),
                "embed_pct": round(100 * embed_s / total),
                "fits_25s_budget": total < 25,
            }
        )
    report["documents"] = docs
    report["peak_rss_mb"] = round(_rss_mb())
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
