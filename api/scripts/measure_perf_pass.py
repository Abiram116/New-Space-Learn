"""N4b — the real measured performance pass.

Calls the real, unmodified handlers directly against the live database and
the live Groq API — same technique as `measure_me_stats.py`: skip only the
HTTP/JWT layer, which isn't what's being measured. Requires real data, which
now exists (real embedded documents, real subjects/subspaces).

Usage (from api/):
    uv run python scripts/measure_perf_pass.py
"""

from __future__ import annotations

import asyncio
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.deps import CurrentUser  # noqa: E402
from app.routers.me.brief import brief  # noqa: E402
from app.routers.me.stats import stats  # noqa: E402
from app.services import rag, supabase  # noqa: E402
from app.services.llm import close_llm, get_llm  # noqa: E402

USER_ID = "a13b9ec8-73e3-4a2e-9b89-008069ffa4cb"
# "transformer" subspace — 52 real chunks, real embeddings, real content.
SUBSPACE_ID = "2744284b-b452-4ad0-be30-1f9df6ba2f73"
N = 10


def _stats(label: str, timings: list[float]) -> None:
    print(f"\n{label} (n={len(timings)})")
    for i, t in enumerate(timings, 1):
        print(f"  run {i:2d}: {t:7.1f} ms")
    print(f"  median: {statistics.median(timings):.1f} ms")
    print(f"  mean:   {statistics.mean(timings):.1f} ms")
    print(f"  min/max: {min(timings):.1f} / {max(timings):.1f} ms")


async def measure_handler(label: str, fn, n: int = N) -> list[float]:
    user = CurrentUser(id=USER_ID, email=None)
    timings = []
    for _ in range(n):
        t0 = time.perf_counter()
        await fn(user=user)
        timings.append((time.perf_counter() - t0) * 1000)
    _stats(label, timings)
    return timings


async def measure_retrieval(n: int = N) -> list[float]:
    questions = [
        "What is self-attention?",
        "How does multi-head attention work?",
        "What is positional encoding?",
        "Why does the transformer avoid recurrence?",
        "What is the computational complexity of self-attention?",
    ]
    timings = []
    for i in range(n):
        q = questions[i % len(questions)]
        t0 = time.perf_counter()
        results = await rag.retrieve(SUBSPACE_ID, q, k=4)
        dt = (time.perf_counter() - t0) * 1000
        timings.append(dt)
        if i == 0:
            print(f"  (sanity check: {len(results)} chunks retrieved for {q!r})")
            if results:
                print(f"   top hit similarity={results[0].similarity:.3f} "
                      f"locator={results[0].locator!r}")
    _stats("GET rag.retrieve() — real retrieval against 52 real embedded chunks", timings)
    return timings


async def measure_llm_ttft(n: int = 5) -> list[float]:
    """Time-to-first-token for a real Groq call, isolated from retrieval."""
    if not settings.llm_configured:
        print("\nGROQ_API_KEY not set — skipping LLM TTFT measurement.")
        return []
    timings = []
    messages = [
        {"role": "system", "content": "You are a concise study assistant."},
        {"role": "user", "content": "In one sentence, what is self-attention in a transformer?"},
    ]
    for _ in range(n):
        t0 = time.perf_counter()
        first = None
        async for _delta in get_llm().stream_chat(messages, model=settings.groq_model):
            first = time.perf_counter()
            break
        if first:
            timings.append((first - t0) * 1000)
    _stats(f"Groq TTFT — real call, {settings.groq_model} (large tier)", timings)
    return timings


async def measure_reprocess(n: int = 3) -> list[float]:
    """Real extract->chunk->embed->insert, on an already-uploaded document —
    exercises the exact code path a fresh upload would, without needing to
    upload a new file."""
    from app.routers.documents import _process_inline

    docs = await supabase.db_select(
        "documents",
        filters={"subspace_id": f"eq.{SUBSPACE_ID}", "status": "eq.ready"},
        select="id,user_id,subspace_id,name,mime_type,storage_path",
        limit=1,
    )
    if not docs or not docs[0].get("storage_path"):
        print("\nNo re-processable document found — skipping.")
        return []
    doc = docs[0]
    timings = []
    for _ in range(n):
        data = bytearray()
        async for chunk in supabase.storage_download(doc["storage_path"]):
            data.extend(chunk)
        t0 = time.perf_counter()
        result = await _process_inline(doc, bytes(data), doc.get("mime_type") or "")
        dt = (time.perf_counter() - t0) * 1000
        timings.append(dt)
        if result.get("status") != "ready":
            print(f"  WARNING: reprocess did not end 'ready': {result.get('status')}")
    _stats(f"Document reprocess (extract+chunk+embed+insert), {doc['name']!r}", timings)
    return timings


async def main() -> None:
    print("=" * 70)
    print("N4b — real measured performance pass")
    print(f"user={USER_ID} subspace={SUBSPACE_ID}")
    print("=" * 70)

    brief_t = await measure_handler("GET /me/brief", brief)
    stats_t = await measure_handler("GET /me/stats", stats)
    retrieval_t = await measure_retrieval()
    ttft_t = await measure_llm_ttft()
    reprocess_t = await measure_reprocess()

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    if brief_t:
        print(f"/me/brief          median {statistics.median(brief_t):7.1f} ms")
    if stats_t:
        print(f"/me/stats          median {statistics.median(stats_t):7.1f} ms")
    if retrieval_t:
        print(f"retrieval (k=4)    median {statistics.median(retrieval_t):7.1f} ms")
    if ttft_t:
        print(f"Groq TTFT          median {statistics.median(ttft_t):7.1f} ms")
    if retrieval_t and ttft_t:
        combined = statistics.median(retrieval_t) + statistics.median(ttft_t)
        print(f"retrieval + TTFT (est. real chat TTFT): {combined:7.1f} ms")
    if reprocess_t:
        print(f"document reprocess median {statistics.median(reprocess_t):7.1f} ms")

    await supabase.close_client()
    from app.services import embeddings
    await embeddings.close_client()
    await close_llm()


if __name__ == "__main__":
    asyncio.run(main())
