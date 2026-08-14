"""Real-corpus retrieval evaluation — Recall@5, Recall@10, MRR.

`bench_eval_set.py`'s own docstring recorded why it exists: at the time it
was written, the live database had one uploaded document stuck mid-processing
and zero real chunks, so a real-corpus eval wasn't possible and a labeled
synthetic set was built instead. `bench_embeddings.py` already has a slot for
a real-corpus result (`bench_real_eval.json`, step 5) — it was just never
filled in, because there was nothing real to fill it with.

That's no longer true. As of the 2026-08 hardening pass the live database has
3 real, fully-processed documents (Java variables lecture slides, a
reinforcement-learning lecture, and the "Attention Is All You Need" paper) —
80 real chunks with real BGE-small-en-v1.5 embeddings. This script is the
real-corpus eval `bench_embeddings.py` was waiting for.

Two things distinguish this from `bench_embeddings.py`'s methodology, on
purpose:
  1. It calls the actual production path — `app.services.rag.retrieve()`,
     which goes through the real `match_document_chunks` RPC scoped to a real
     `subspace_id` — not an offline brute-force cosine similarity over
     in-memory vectors. This is what a student's chat/quiz/notes request
     actually runs, not a proxy for it.
  2. Ground truth is 18 questions written by hand from the real chunk text
     (see the `CASES` below — each `expect_idx` is a `document_chunks.
     chunk_index` a human confirmed contains the answer), not synthesized.

Small-N caveat, stated plainly: 18 questions over 80 chunks is a smoke-eval,
not a statistically powered benchmark. It answers "does retrieval work at
all, on real content, through the real path" — not "how does retrieval
degrade at scale." Re-run this (or extend `CASES`) as the real corpus grows.

Usage (from api/, needs real Supabase credentials — reads the live DB):
    uv run python scripts/bench_real_corpus.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import rag, supabase  # noqa: E402

# (subspace label -> subspace_id) for the 3 real documents present when this
# was written. Re-derive from `documents`/`subspaces` if the corpus changes.
SUBSPACE = {
    "java": "7c56957e-454d-44db-b865-9428c96457b0",
    "rl": "b26fa6ee-21ec-4fdb-a3af-7eb23806a8be",
    "attn": "2744284b-b452-4ad0-be30-1f9df6ba2f73",
}

# Hand-verified against the real, stored `document_chunks` content — each
# `expect_idx` is the `chunk_index` a human read and confirmed contains the
# answer. Not fabricated, not sampled from a template.
CASES: list[tuple[str, str, int]] = [
    ("java", "What are Java's eight primitive data types?", 2),
    ("java", "How many keywords does the Java language have?", 1),
    ("java", "What is the range of a char in Java?", 5),
    ("java", "What does a cast do in Java type conversion?", 11),
    ("java", "If you cast the int value 257 to a byte in Java, what value do you get?", 11),
    ("java", "What is a scope in Java and when is a new one created?", 6),
    ("rl", "What are the five main elements of the reinforcement learning decision process?", 0),
    ("rl", "What is the difference between online and offline reinforcement learning?", 4),
    ("rl", "What is a Q-value in reinforcement learning?", 8),
    ("rl", "What is the difference between transient and recurrent states in a Markov chain?", 13),
    ("rl", "What makes a Markov chain ergodic?", 14),
    ("rl", "What is a Markov Decision Process?", 3),
    ("attn", "What BLEU score did the Transformer achieve on WMT 2014 English-to-German translation?", 1),
    ("attn", "How many parallel attention heads does the Transformer use?", 17),
    ("attn", "What is the formula for scaled dot-product attention?", 14),
    ("attn", "How many identical layers are in the Transformer's encoder stack?", 10),
    ("attn", "What formula does the Transformer use for positional encoding?", 23),
    ("attn", "Why does the Transformer need positional encoding at all?", 22),
]


async def main() -> None:
    docs = await supabase.db_select("documents", filters={"status": "eq.ready"}, select="id,name,subspace_id")
    if len(docs) < 3:
        print(f"WARNING: expected 3 ready documents, found {len(docs)} — SUBSPACE/CASES above may be stale.")

    # locator -> chunk_index per document, read straight from the DB so this
    # never trusts a stale offset assumption.
    locator_map: dict[str, dict[str, int]] = {}
    total_chunks = 0
    for d in docs:
        chunks = await supabase.db_select(
            "document_chunks", filters={"document_id": f"eq.{d['id']}"}, select="chunk_index,locator"
        )
        locator_map[d["id"]] = {c["locator"]: c["chunk_index"] for c in chunks}
        total_chunks += len(chunks)

    results = []
    for domain, question, expect_idx in CASES:
        subspace_id = SUBSPACE[domain]
        hits = await rag.retrieve(subspace_id, question, k=10)
        returned_idx = [locator_map.get(h.document_id, {}).get(h.locator) for h in hits]
        rank = next((i for i, idx in enumerate(returned_idx, start=1) if idx == expect_idx), None)
        results.append(
            {
                "domain": domain,
                "question": question,
                "expect_idx": expect_idx,
                "returned_idx": returned_idx,
                "rank": rank,
                "top_similarity": hits[0].similarity if hits else None,
            }
        )

    n = len(results)
    recall5 = sum(1 for r in results if r["rank"] and r["rank"] <= 5) / n
    recall10 = sum(1 for r in results if r["rank"] and r["rank"] <= 10) / n
    mrr = sum((1 / r["rank"]) if r["rank"] else 0 for r in results) / n

    print("=" * 70)
    print(f"REAL-CORPUS RETRIEVAL EVAL — {len(docs)} documents, {total_chunks} real chunks, "
          f"BGE-small-en-v1.5, 384-dim")
    print("Small-N smoke-eval, not a statistically powered benchmark — see module docstring.")
    print("=" * 70)
    print(f"n={n}  Recall@5={recall5:.3f}  Recall@10={recall10:.3f}  MRR={mrr:.3f}\n")
    for r in results:
        status = f"rank={r['rank']}" if r["rank"] else "MISS (not in top 10)"
        print(f"[{status:>21}] ({r['domain']}) {r['question']}")

    out = {
        "n": n,
        "documents": len(docs),
        "total_chunks": total_chunks,
        "recall_at_5": recall5,
        "recall_at_10": recall10,
        "mrr": mrr,
        "results": results,
    }
    out_path = Path(__file__).parent / "bench_real_corpus_results.json"
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
