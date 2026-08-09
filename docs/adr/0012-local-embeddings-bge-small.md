# ADR-0012 — Local embeddings (BGE-small-en-v1.5, quantized ONNX), not a hosted API

- **Status:** Accepted
- **Date:** 2026-08-10
- **Supersedes:** the embedding-provider half of [ADR-0005](0005-groq-single-provider.md) (which accepted a hosted OpenAI-compatible provider as a one-time exception to single-provider). That exception is now closed — there is no second provider account at all.
- **Related:** `docs/AI_ENGINE.md §4`, `docs/COST_MODEL.md`, `api/scripts/bench_embeddings.py`, `api/scripts/bench_eval_set.py`

## Context

Phase 0 wired a hosted, OpenAI-compatible embedding provider
(`text-embedding-3-small`) behind `embed_texts()`, priced at roughly
$0.0002/document. The product owner rejected that direction outright:
**zero recurring API cost, and an actually local, open model** — specifically
asking that BGE-small-en-v1.5 (quantized ONNX) be investigated as the
production candidate, with BGE-M3 evaluated only as a quality ceiling.

## Investigation

Measured, not assumed, in this order:

1. **Real app baseline.** Started the actual `uvicorn app.main:app` worker
   (not a launcher shim — the process tree has several; found the real one
   via `Win32_Process` parent-chain inspection) and read its working
   set/private bytes via `Get-Process`, idle and after warm-up requests:
   **~57–60 MB**. Windows, not Render's Linux container — a proxy, stated as
   one, not claimed as verified.
2. **Docling claim checked and found false.** The brief for this
   investigation assumed Docling was part of the stack; `pyproject.toml` has
   no such dependency — PDF extraction is plain `pypdf`. Corrected before
   using it in any memory budget.
3. **BGE-small-en-v1.5 via `fastembed`** (ONNX Runtime, not PyTorch — no
   CUDA, no multi-GB framework), installed ephemerally via
   `uv run --with fastembed` so nothing touched the real dependency manifest
   until justified. Measured inside one process, importing the app's real
   `config`/`embeddings` modules first so "baseline" means what it means in
   production:
   - Model marginal footprint, loaded and ready: **~170–200 MB** (two runs,
     real variance — ONNX Runtime's memory arena sizing isn't perfectly
     deterministic).
   - Peak marginal during embedding: **~230 MB** (worst observed run).
   - **Estimated combined (baseline + model, same worker): ~250–290 MB of
     512 MB — roughly 40–50% headroom.**
   - Latency: ~10 ms/chunk batched, ~3 ms/query. Not a bottleneck at any
     scale this product has, or is likely to have.
   - Import/load time: **~15s import + ~9s model download on a cold
     cache** (first-ever run, e.g. after a fresh deploy) vs. **~2.8s import
     + ~0.6s load once the model is cached on disk** (subsequent cold-start
     wake-ups within the same container). Both measured directly, not
     inferred from the ONNX Runtime docs.
4. **Retrieval quality**, on a synthetic 24-query/8-subject evaluation set
   (`bench_eval_set.py`) built specifically because the real corpus wasn't
   usable — see the honest gap below: Recall@5 = 1.0, Recall@10 = 1.0,
   MRR = 1.0. **Read this as "the model isn't broken," not "the model is
   perfect"** — the set was deliberately cross-subject and low-lexical-
   overlap, which is an easy retrieval task for any competent embedding
   model. BGE-small-en-v1.5's general standing (recalled, not re-verified
   live, from BAAI's published MTEB benchmarks — check their model card for
   current numbers rather than trusting this document's memory of them) is
   respectable for a 33M-parameter model: competitive with, and on some
   retrieval slices ahead of, OpenAI's older `text-embedding-ada-002`.
5. **BGE-M3 assessed as a production candidate and rejected — not close.**
   Per its published model card: ~568M parameters, ~2.2GB as fp32 weights
   (~1.1GB at fp16), dense output at **1024 dimensions**. The model's own
   weights alone are 4–8x the *entire* 512MB Render free-tier ceiling,
   before the app or the ONNX/PyTorch runtime is counted. This isn't a
   close call requiring quantization tricks — it structurally cannot run
   in-process here. Kept as a **local, offline quality benchmark only**:
   useful for periodically sanity-checking whether BGE-small's rankings
   roughly agree with a stronger model's on harder queries, never a
   deployment candidate on this infrastructure.

### The honest gap: no real-corpus benchmark

The live database has **zero rows in `document_chunks`** — the one uploaded
document (`Session3_Variables.pdf`) never finished processing, and the two
existing quizzes' `source` fields hold topic labels ("General Knowledge"),
not real page locators, because they were generated without retrieval
grounding. There was no usable real corpus or real evaluation-query set to
benchmark against. Recovering the one real document's text (to at least
spot-check against actual product content) was attempted three times —
`storage_download` hung every time despite plain `/rest/v1/` queries against
the same project working fine seconds earlier — and abandoned as an
environment-specific issue not worth further session time, not silently
dropped. **This ADR's quality evidence rests on the synthetic set plus
BGE-small's public benchmark standing, not on SpaceLearn's own content.**
Re-running `bench_embeddings.py` against real chunks once real documents
exist would strengthen this evidence and is worth doing then.

## Decision

**Adopt BGE-small-en-v1.5 (quantized ONNX, via `fastembed`) as the
production embedding provider.** Runs in-process, no API key, no external
network dependency, $0 marginal cost. `fastembed>=0.8,<0.9` added as a real
dependency in `pyproject.toml`.

**BGE-M3 is not a production path on this infrastructure and isn't being
kept as one.** It remains available for offline benchmarking only.

**A real correctness detail, not optional:** `fastembed`'s inference is
synchronous CPU work, unlike the async HTTP call it replaces. Calling it
directly inside an `async def` handler would block this single-worker
process's event loop for the duration — stalling every other concurrent
request (a chat stream, an auth check) for tens to hundreds of ms per
batch. `LocalBgeEmbeddingProvider.embed()` runs the blocking call via
`asyncio.to_thread()` specifically to avoid this.

**The provider stays behind a `Protocol`**
(`services/embeddings.py::EmbeddingProvider`), the same pattern `llm.py`
already uses for `LLM`/`GroqLLM`/`StubLLM`. `embed_texts()` — the one
function every caller (`documents.py`, `rag.py`) actually imports — hasn't
changed its signature across three different providers now (stub, hosted
HTTP, local ONNX). This is what "swappable later" means concretely: not
keeping unused provider code around "just in case," but keeping the seam
narrow enough that adding one back is small, contained work when there's an
actual reason to.

**The prior hosted-HTTP provider code was deleted, not kept as a dormant
option.** Per this project's own repeated "prefer delete over add" /
"treat sunk cost as a bug" discipline: an unused code path is a maintenance
cost with no current payoff. If a hosted provider is ever wanted again, the
pattern to follow is this ADR plus the git history of the deleted
`_embed_batch`/`_get_client` functions — reconstructing it behind the same
`EmbeddingProvider` Protocol is maybe 40 lines, not a redesign.

## Alternatives considered

1. **Keep the hosted OpenAI provider** (Phase 0's design). Rejected outright
   by explicit product decision — $0 recurring cost and no external API
   dependency were non-negotiable, not a preference to weigh against
   convenience.
2. **BGE-M3 in production**, possibly with aggressive quantization. Rejected
   — see above. No realistic quantization closes a 4–8x gap on the model
   weights alone.
3. **A smaller local model still, e.g. all-MiniLM-L6-v2.** Not benchmarked
   this round — BGE-small already fits with real headroom (~40–50%) and has
   a stronger public quality standing than MiniLM on most retrieval
   benchmarks. Revisit only if BGE-small's measured footprint is ever found
   to be a real problem in production, which today's numbers don't suggest.
4. **A separate embedding microservice**, moving the model out of the
   FastAPI worker entirely. Rejected — directly contradicts this project's
   monolith-first, minimal-operational-complexity principles (`SYSTEM_ARCHITECTURE.md`),
   and would add a second cold start on the exact request path (document
   upload) that already has one to manage.
5. **Offline/batch embedding**, moving the work out of the live upload
   request. Not needed — BGE-small's measured latency (~10ms/chunk) is
   comfortably inside the existing 25s inline processing budget
   (`documents.py::PROCESSING_BUDGET_S`), so the real-time "upload → ready"
   experience is unaffected. This alternative would have been the fallback
   if BGE-small hadn't fit in memory; it did, so it wasn't needed.

## Trade-offs

**Cost:** $0 marginal, permanently — the real win. Trades away: a
theoretical quality ceiling above what a 33M-parameter model can reach
(BGE-M3 or a larger hosted model would likely retrieve marginally better on
genuinely hard, closely-related-concept queries — the exact case this
product's confusion-pair feature cares about most). Not measured directly
against real hard cases this round, because the real corpus doesn't exist
yet to test on.

**Cold start:** adds a real, one-time cost. First-ever run after a deploy:
~15–24s (import + model download). Steady-state cold-start wake-ups within
the same container: ~3.4s. This stacks on top of Render's existing ~30s
cold start — worth tracking as a real UX cost, not zero, even though it's
smaller than the worst-case number suggests.

**Deploy size:** `fastembed`/`onnxruntime` add real installed size (tens of
MB) to the build, where the prior dependency set was intentionally minimal.
Not measured precisely against Render's free-tier build limits this round —
worth a real deploy to confirm build time/slug size stay acceptable, flagged
here rather than assumed.

**Consequence for the schema:** `document_chunks.embedding` must become
`vector(384)`, not `vector(1536)`. Migration written
(`supabase/migrations/20260810090000_embedding_dim_384.sql`) but **not
applied** — this repo's standing convention, and this ADR's explicit
instruction: no migration until the model choice was empirically justified,
which the measurements above are. Genuinely low-risk migration in this
specific case, because `document_chunks` currently holds zero rows — there
is no real embedding data to lose or reinterpret, confirmed before writing
the migration file.

## Consequences

- `config.py::Settings.real_embeddings_enabled` simplified — a hosted
  provider needed "flag off AND key present"; a local model needs only the
  flag, since there's no key to be missing. One less failure mode to reason
  about.
- `api/scripts/reembed_documents.py` needed no changes — it calls the same
  `_process_inline` → `embed_texts()` path, which is exactly what the
  provider abstraction was for.
- `AI_ENGINE.md §4`, `COST_MODEL.md`, and `CHECKPOINT.md`'s embedding
  sections describe the now-superseded hosted-provider plan and need
  correcting to this decision.
- The real-corpus benchmark gap (above) is real, outstanding work — not
  urgent (the memory/latency case is solid on its own), but worth closing
  once real documents exist in the database, so quality claims rest on
  SpaceLearn's own content rather than a synthetic stand-in.

## Future migration path

If BGE-small's retrieval quality is ever measured (on a real corpus, once
one exists) as insufficient for confusion-pair or citation quality, the
next step is **not** reaching for BGE-M3 in-process — that path is closed
structurally, not just today. The options in order: (a) a better small/
quantized model that still fits the memory budget (re-run
`bench_embeddings.py` against candidates), (b) a paid Render tier with more
RAM, evaluated against its actual cost, or (c) a genuinely free-tier hosted
API if one still exists with acceptable terms at that time. Each is a real
decision with its own trade-offs — none should be adopted without the same
measure-first discipline this ADR used.
