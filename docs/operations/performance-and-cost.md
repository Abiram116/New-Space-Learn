# Performance and cost

Two sides of the same free-tier constraint: how fast it feels, and what it
costs to run. Kept together because nearly every decision here trades one
against the other.

---

## Part 1 — Performance

---

### 1. Latency budgets

| Interaction | Budget | Current reality |
|---|---|---|
| Landing page first paint | <1s | Static on Vercel, no backend dependency — should already meet this |
| App shell interactive, backend warm | <500ms | Not independently measured; depends on auth verify + first data fetch |
| App shell interactive, backend cold | Best-effort — Render free tier costs ~30s here, not a target to hit | Mitigated for landing visitors (health-ping warm-up per `docs/product/vision.md §10`); **not mitigated for a student who bookmarks the app directly and lands past the landing page** — see §6 |
| Simple list/get API call, warm | <300ms | One measured warm round trip to remote Supabase is ~150–257ms (`docs/plan.md`); most list endpoints are 1–2 round trips deep after the responsiveness pass |
| Chat time-to-first-token, warm | <1.5s | Retrieval (2–3 round trips) + Groq TTFT (estimated 300–600ms) — not independently measured end-to-end |
| Quiz/flashcard generation (full artifact) | <6s | One 70B call generating N structured items — the slowest routine user-facing wait in the product; must always show a real loading state, never a bare spinner with no explanation |
| Document processing (upload → ready) | Hard cap 25s (`PROCESSING_BUDGET_S`); target median <8s for a typical lecture PDF | Not independently measured; falls back to "still processing, tap reprocess" on timeout rather than hanging |
| First-load JS bundle (gzipped) | ≤250KB | **Measured 2026-08-09: 147KB** entry (app), **~209KB** for a landing visit (entry + the lazy `Landing` chunk). The 245KB previously recorded here predates the landing rebuild and further splitting. |
| Any in-app animation | ≤320ms (`docs/plan.md`'s existing rule) | Enforced by convention (`components/ui/motion.tsx`), not a runtime check |

These are planning targets, not SLAs verified by a monitoring system —
this product has no APM. Treat every "not independently measured" note
above as a to-do, not a claim.

---

### 2. Frontend

- **Bundle:** route-level code splitting already moved Tiptap, Landing,
  Flashcards, and Quizzes out of the main chunk, cutting first load from
  451KB to 245KB gzipped (`docs/plan.md`'s Responsiveness work). Split
  chunks prefetch on idle so opening Notes/Cards/Quizzes for the first time
  doesn't cost a cold fetch on top of the click.
- **Headroom is thin.** 245KB against a 250KB self-imposed ceiling leaves
  ~5KB. The Gap Map (`docs/plan.md`) will need a rendering approach
  — **budget it as its own lazy-loaded route chunk from the start**, the
  same way Tiptap is isolated today. Do not import a charting/graph library
  into a shared module that the main chunk pulls in.
- **Motion:** governed by `docs/plan.md`'s six rules (nothing over
  ~320ms, stagger capped at ~240ms total, `prefers-reduced-motion` renders
  the final state, etc.) — not repeated here, just the pointer. Any new
  epic that adds motion (confusion-pair reveal, exam countdown) inherits
  these rules by default, not by re-deciding them.
- **Session cache** (`docs/engineering/ai-pipeline.md §2`) is the main lever against
  redundant refetching — 60s TTL for stats, 30min for the brief, explicit
  invalidation on grading/quiz-submit. This is a caching strategy, not a
  raw-speed one: it makes the *second* visit to a page free, not the first.

---

### 3. Backend

- **Round-trip discipline:** the standing rule is "independent awaits in one
  handler are a latency bug" (`docs/plan.md`) — reach for
  `asyncio.gather` when two reads don't depend on each other. This is
  correctly applied throughout the routers reviewed for this document
  (`notes.py`, `documents.py`, `flashcards.py`, `quizzes.py` all gather the
  ownership guard with the first independent read).
- **Except when it measurably isn't** — see §5. There is one place in this
  codebase (`spaces.py::_bulk_counts`) that measured `asyncio.gather` as
  *slower* than sequential for four independent reads against this specific
  remote Postgres (1566ms vs. 1114ms), because concurrency forces new TLS
  handshakes that compete for bandwidth rather than overlapping for free.
  That finding is real and should stand. What needs scrutiny is whether the
  *other* gather-based optimization in this codebase (`/me/stats`, §5) was
  verified the same way or only reasoned about.
- **In-process rate limiting** (`ratelimit.py`) costs nothing and is correct
  for exactly one worker — see `docs/engineering/architecture.md` for when this
  stops being true.
- **Inline document processing**, capped at 25s, is the direct performance
  consequence of "no background workers" — a document that can't finish in
  the budget hands back a resumable `processing` state instead of hanging
  the request until Render's own timeout kills the connection.

---

### 4. Database

- **`ivfflat` index on `document_chunks.embedding`** needs "a few thousand
  rows" per the migration's own comment to beat a sequential scan. Correct
  and cheap at today's per-subspace volumes (typically dozens to low
  hundreds of chunks) — costs nothing to have even when unnecessary, so
  there's no reason to remove it while waiting to need it.
- **Storage shape:** each `document_chunks` row carries a `vector(1536)` —
  roughly 6KB per chunk just for the embedding, before the chunk's own text.
  At the 500MB free-tier ceiling, the embedding vector is the dominant
  per-row cost, not the text — worth knowing before assuming a storage
  problem is a text-chunking problem.
- **Stubbed embeddings mean this entire section is currently measuring the
  wrong thing.** Query latency for a meaningless-vector search is the same
  as for a real one — the performance characteristics documented here don't
  change once real embeddings ship, but retrieval *quality* does, and
  that's a correctness fix (`docs/engineering/ai-pipeline.md §4`), not a performance one.

---

### 5. Streaming

Chat's SSE stream emits `citation` events before the first `token` —
deliberately, so the frontend can render source cards while generation is
still running rather than waiting for the full reply. This is the one place
in the product where perceived latency was reduced by *reordering* work, not
by making anything faster. Quiz/flashcard generation can't use the same
trick (§ `docs/engineering/ai-pipeline.md`'s note on why those aren't streamed) — the
mitigation there has to be a good loading state, not a streaming response.

---

### 6. Cold starts

Render's free tier spins down after 15 minutes idle; the next request pays
~30s.

**Corrected 2026-08-09.** This section previously said `docs/product/vision.md §10`'s
landing-page warm-up was "already mitigated." It wasn't — no ping existed
anywhere except `OfflineBanner`, which lives inside `AppShell`, behind auth.
The design response had been written down but never built.

**Now implemented** (`web/src/lib/warmApi.ts`, Phase 0.5), at the two points
where the wake-up actually overlaps with something the user is already doing:

- **Landing** — a visitor reads the pitch for 10–30s before clicking through.
- **Sign-in / sign-up** (`AuthShell`) — typing credentials is another
  10–20s, and the data fetch straight after login is what would otherwise
  hit a cold server.

Verified live: `GET /api/v1/health → 200` fires on both.

**Updated 2026-08-09 (D6).** The direct-bookmark gap above is closed, in the
one place that actually reaches it: `AuthProvider` (`main.tsx` wraps it above
the router, so it mounts on every load, signed in or not). Moved the single
`useEffect(warmApi, [])` there and removed the now-redundant copies in
`Landing.tsx` and `AuthShell.tsx` — `warmApi()` de-dupes internally, so
leaving all three would have cost nothing extra, but three call sites with
one doing all the work is exactly the kind of duplication worth deleting.

Still true, and still the reason `AppShell` itself is not the fix: by the time
`AppShell` mounts, its own children's data-fetching effects (`Home`'s
`/me/stats`) are already firing in the same tick — a ping there races the real
request instead of preceding it. `AuthProvider` mounts strictly earlier, in
parallel with `getSession()`'s own async resolution, so the backend gets
whatever head start that takes — genuine for a cold/uncached session, closer
to zero for an already-cached one, never negative.

**What this does not fix:** the actual ~30s cold-start cost. No client-side
trick removes it; this only decides whether the student watches it happen or
it happens invisibly during something they were already doing (reading,
typing, or now: auth resolving).

---

### 7. A real discrepancy worth resolving, not just noting

Two performance write-ups in this codebase reach opposite conclusions about
concurrent Supabase calls, and it's worth naming plainly rather than letting
both stand unreconciled:

- `spaces.py::_bulk_counts` — **measured**, explicitly, with real
  wall-clock numbers: 4 gathered calls (1566ms) lost to 4 sequential calls
  (1114ms) against this remote Postgres, because of TLS handshake overhead.
  Kept sequential.
- `/me/stats` (`docs/plan.md`'s Responsiveness section) — went from 8
  sequential round trips to `asyncio.gather`, reporting "8 deep (~1200ms) →
  1 deep (~150ms)." But that section's own header states the numbers are
  from "a 150ms *simulated* round trip, counting round-trip depth" — an
  idealized model, not a wall-clock measurement of the real gather call the
  way `_bulk_counts` was.

**Resolved 2026-08-09.** Measured for real: `api/scripts/measure_me_stats.py`
calls the actual, unmodified `stats()` handler directly against the real
remote Supabase (a real account with settings, activity, subjects, quiz
results and flashcards — not an empty one), 20 runs.

| | ms |
|---|---|
| Run 1 (cold connection pool) | 2758.0 |
| Runs 2–20 (individual) | 718.2, 752.4, 695.6, 717.5, 719.6, 676.7, 450.6, 686.0, 434.4, 562.1, 440.3, 720.1, 463.6, 427.4, 455.2, 430.7, 475.6, 453.4, 439.7 |
| Median, all 20 | 518.8 |
| Median, excluding run 1 | 475.6 |
| Mean, all 20 | 673.8 (skewed by run 1) |
| Min / max | 427.4 / 2758.0 |

**"~150ms" was wrong — steady-state is ~430–750ms, roughly 3–4x higher.**
It was never a measurement (the section's own header said so: "a 150ms
*simulated* round trip"), and this replaces it with one. The first-run
spike (2758ms) is a one-time `httpx.AsyncClient` connection-pool/TLS cost
that every request after it stops paying — consistent with the same
mechanism `_bulk_counts` documents, not a sign anything is wrong.

**Does the implementation need to change? No.** `asyncio.gather` is already
correctly applied to all 8 independent reads (confirmed in code before
measuring, then consistent with the numbers: a sequential baseline at
~200–300ms/round-trip × 8 would land in the 1600–2400ms range every call,
not 430–750ms). The measured latency is what 8 genuinely concurrent reads
against a remote Postgres cost on this connection — there's no un-gathered
read left to fix, and nothing here demonstrates a real problem worth a code
change. If this specific number ever needs to come down further, the next
lever is reducing *how many* reads `/me/stats` makes (e.g. a single
PostgREST call with embedded `select`s across a few of the eight), not the
concurrency strategy — but that's a real problem to solve when it's
observed as one, not pre-emptively.

---

### 8. Recommendations, ranked by effort ÷ impact

1. ~~**Warm the app shell, not just the landing page**~~ (§6) — **done,
   2026-08-09 (D6).** Moved to `AuthProvider`, the one mount point that
   actually covers a direct-bookmark visitor.
2. ~~**Measure `/me/stats` for real**~~ (§7) — **done, 2026-08-09.** 20 real
   runs against the live database: median 518.8ms (475.6ms excluding a
   one-time connection warm-up on run 1), not the ~150ms simulated estimate.
   `asyncio.gather` already covers all 8 reads; no code change is justified
   by these numbers.
3. **Budget the Gap Map's rendering approach as its own lazy chunk from day
   one** (§2) — costs nothing extra if done from the start; costly to
   retrofit if a graphing library quietly lands in the main bundle first.
4. **Fix real embeddings before optimizing retrieval further** (§4) — any
   retrieval-latency work done before this is optimizing the wrong metric.

---

## Part 2 — Cost

> **Pricing caveat, stated up front:** Groq's free tier is rate-limited
> rather than metered, and published per-token prices for hosted Llama models
> shift. Every dollar figure below is an **order-of-magnitude planning
> estimate** derived from token counts this codebase actually produces, not a
> quote. The token counts are the durable, useful part; re-check unit prices
> against the provider's current pricing page before making a spend decision.

---

### 1. Embeddings — now $0 permanently, not just cheap

**Updated 2026-08-10 — superseded the hosted-provider plan below (kept
struck through for the reasoning trail, since the "cents is nothing" analysis
is still correct — it just wasn't the deciding factor).** Per
[docs/decisions.md](../decisions.md), embeddings run locally —
BGE-small-en-v1.5, quantized ONNX, in-process, no API key, no external
provider account of any kind. **This isn't a cost optimization on top of the
plan below; it replaces the plan below.** No line item, no per-token rate,
no dollar figure to track here at all.

What it costs instead: ~200MB of RAM in the same worker (measured in
docs/decisions.md, comfortably inside Render's 512MB free-tier ceiling) and a few
seconds of added cold-start time. Real trade-offs — just not financial ones,
which is the entire point of this section existing.

<details>
<summary>Original analysis (hosted OpenAI provider) — superseded, kept for the reasoning trail</summary>

~~**Today: $0.** `USE_STUB_EMBEDDINGS=true` in `render.yaml` means no embedding
provider is called at all (`docs/engineering/ai-pipeline.md §4`). This is not a cost saving —
it's the reason retrieval doesn't actually work semantically.~~

~~**Once real.** Groq doesn't host an embedding endpoint on this account, so
this means a second provider (`text-embedding-3-small`, cheapest credible
option, 1536 dimensions matching the existing `vector(1536)` column exactly
— no migration needed).~~

| Scenario | Chunks | Tokens to embed | Est. cost @ ~$0.02/1M tokens |
|---|---|---|---|
| One 20-page lecture PDF (~40k chars) | ~50 | ~10k | ~$0.0002 |
| A semester's material, one subject (20 such PDFs) | ~1,000 | ~200k | ~$0.004 |
| Heavy user, 5 subjects, a full semester | ~5,000 | ~1M | ~$0.02 |
| Every question asked (query-side embedding) | 1 short string each | ~20 tokens | negligible — ~$0.0000004/question |

~~**Conclusion: embedding is effectively free at this product's scale.**~~
Correct as analysis, but the product owner's actual requirement was $0 and
no external dependency, not "cheap enough" — cents-per-semester doesn't
satisfy "don't default to a paid API" regardless of how small the cents are.
That's a legitimate requirement a cost analysis alone can't override; see
docs/decisions.md for how it was actually resolved.

</details>

Note the asymmetry that makes this cheap: documents are embedded **once, at
upload**. Questions embed one short string per ask. Nothing re-embeds on a
retry, a page reload, or a new chat turn.

---

### 2. LLM inference — the real recurring cost

Model tiering (`config.py`) is the primary cost control already in place:

| Tier | Model | Used for | Why this tier |
|---|---|---|---|
| Large | `llama-3.3-70b-versatile` | RAG chat, quiz/flashcard/note generation | Reasoning over real retrieved context and producing structured output — quality-sensitive work |
| Fast | `llama-3.1-8b-instant` | Home brief, subspace-name suggestion | Short, low-stakes, template-shaped output. Explicitly *not* used for artifact generation without quality-checking first (`docs/plan.md`) |
| Vision | `qwen/qwen3.6-27b` | Image document ingestion only | The only image-capable model on the account |

Per-request token estimates, from the actual prompt construction in
`rag.py::build_prompt` and the generation prompts:

| Operation | Input tokens | Output tokens | Notes |
|---|---|---|---|
| Chat turn | ~1,200–2,500 | ~200–600 | Voice fragment + up to 4 retrieved chunks (~200 tok each) + up to 8 history turns + student context |
| Chat turn, Skill with `memory_scope: all` | ~3,000–5,000 | ~200–600 | History window widens to 40 turns — **the single largest prompt this product builds** |
| Quiz generation (5 questions) | ~1,500–2,000 | ~600–1,000 | 6 retrieved chunks + history + structured-output instructions |
| Flashcard generation (10 cards) | ~1,500–2,000 | ~500–800 | Same shape as quiz |
| Note generation | ~1,500–2,000 | ~400–900 | Same shape |
| Inline `/ai` in a note | ~1,500–2,000 | ~100–400 | Uses the large tier — arguably shouldn't always; see §6 |
| Home brief | ~300–600 | ~50–100 | Fast tier, deliberately |
| Subspace-name suggestion | ~1,000 | ~10 | Fast tier; input is capped at 4,000 chars of document text |
| Image ingestion | ~1,000 + image | ~200–800 | Vision tier, once per image upload |

**Monthly projection, one active student** (a realistic study pattern: 20
study sessions/month, 10 chat turns each, 8 quizzes, 8 decks, 10 notes):

| Line item | Volume | Est. tokens | Est. cost @ ~$0.60/1M in, ~$0.80/1M out |
|---|---|---|---|
| Chat | 200 turns | ~400k in, ~80k out | ~$0.30 |
| Quiz generation | 8 | ~14k in, ~6k out | ~$0.01 |
| Flashcard generation | 8 | ~14k in, ~5k out | ~$0.01 |
| Note generation + inline AI | ~30 calls | ~50k in, ~12k out | ~$0.04 |
| Home brief | 20 | ~10k in, ~2k out | ~$0.01 (fast tier, cheaper still) |
| Embeddings | a semester's docs | ~200k (irrelevant now — local, $0) | **$0** |
| **Total** | | | **well under $1/student/month** |

**The headline:** at single-digit user counts this product costs cents per
month, and Groq's free tier likely absorbs all of it. The cost model only
becomes interesting at ~1,000 users, where the same pattern projects to
roughly **$300–500/month** — dominated almost entirely by chat, which is
exactly where §6's optimizations should be aimed if that day comes.

---

### 3. Storage and bandwidth

| Resource | Free-tier limit | What consumes it | Projection |
|---|---|---|---|
| Supabase Postgres | 500MB | `document_chunks` dominates — each row is a `vector(384)` (~1.5KB, since docs/decisions.md — was `vector(1536)`/~6KB) plus its ~900 chars of text | ~2.4KB/chunk → **~210,000 chunks before the ceiling**, roughly 4,200 lecture-sized PDFs total across all users. **A real, unplanned side-benefit of the local-embedding decision:** the smaller vector is ~3x more storage-efficient than the OpenAI-sized one would have been — not why BGE-small was chosen, but worth knowing |
| Supabase Storage | 1GB | Original uploaded files, kept so `reprocess` works without re-upload | ~50 × 20MB files, or many more typical-sized ones |
| Vercel bandwidth | 100GB/mo | Static assets, 245KB gzipped per cold visit | Effectively unreachable at this scale |
| Render | 750 instance-hours/mo | One service, spins down when idle | Sufficient for one always-warm-ish service |

**The binding constraint is Postgres at 500MB, and the embedding vector — not
the text — is what fills it.** Worth knowing before "optimizing" chunk sizes
to save space: halving chunk text saves ~1KB/row while doubling row count and
therefore doubling the ~6KB vector cost. Larger chunks are *cheaper* per
document in storage terms, which cuts against retrieval precision — a real
trade-off, currently settled at 900 chars, and one that shouldn't be adjusted
for storage reasons without acknowledging the retrieval cost.

---

### 4. Cost per feature, ranked

| Feature | Marginal cost per use | Assessment |
|---|---|---|
| Reading notes/cards/decks/quiz history | $0 | Pure DB reads |
| Grading a card | $0 | Arithmetic + one write |
| Submitting a quiz | $0 | Server-side comparison, no LLM |
| Streak/heatmap/stats | $0 | SQL aggregation |
| **Confusion pairs (`docs/plan.md`)** | **$0** | `GROUP BY` over existing rows, no LLM call — worth restating, since this is the product's flagship differentiator and it costs *nothing* per use |
| **Exam-aware scheduling (§12)** | **$0** | Arithmetic |
| **Gap Map (§13)** | **$0** | Aggregation over existing rows |
| Home brief | ~$0.0005 | Fast tier |
| Chat turn | ~$0.0015 | The volume driver |
| Artifact generation | ~$0.002 each | Infrequent per student |
| Image ingestion | ~$0.002 | Infrequent |

**The strategically important row:** all three ../product/vision.md-derived flagship
features cost $0 per use. The redesign that replaced the concept graph with
tag aggregation didn't just avoid schema complexity — it kept the product's
most differentiating features entirely off the metered path. A graph that
needed an LLM call to derive `co-cited` edges during retrieval would have
added recurring cost to *every single chat turn*, which is precisely the
highest-volume operation in the product. That's a cost argument for the
approved architecture that `docs/product/vision.md §6` only made implicitly.

---

### 5. Rate limiting as cost control

`ratelimit.py`'s token bucket (20 burst, 20/min refill, chat=1,
generation=2) is a **spend cap, not just an abuse guard** — its docstring
names the real risk: "one stuck retry loop or an open tab hammering chat can
burn the daily token budget." Worth noting that the one previously-unmetered
LLM endpoint (subspace-name suggestion) was found and closed during an
earlier audit — the lesson being that **every new LLM-backed endpoint must
call `consume_llm_quota`**, and reviewing for that should be part of adding
one. There is no automated check enforcing this today.

---

### 6. Optimization recommendations, ranked by value

1. ~~**Wire real embeddings (~2¢/semester/user).**~~ **Superseded —
   `docs/engineering/ai-pipeline.md §4`, docs/decisions.md.** Local BGE-small, not a hosted provider:
   $0 rather than 2¢, at the cost of ~200MB RAM (measured, fits) and a few
   seconds of cold start. What remains is applying one migration
   (`vector(1536)`→`vector(384)`) — still the highest-priority open item,
   now for "flip the switch," not "find a provider."
2. **Reconsider the large tier for inline `/ai` in notes.** It currently uses
   `groq_model` (70B) for what is often a short continuation or a
   reformatting request. The fast tier may be sufficient for a large share of
   these. **Test output quality before switching** — the same caution
   `docs/plan.md` applies to agents applies here; don't downgrade a
   tier on cost reasoning alone.
3. **Watch `memory_scope: all` Skills.** A 40-turn history window builds the
   largest prompt in the product (~3–5k input tokens per turn) on the
   highest-volume operation. Currently fine — and it's a real behavior
   dimension, not waste — but if chat cost ever needs reducing, capping this
   (or summarizing older turns) is the single biggest lever. Do not
   pre-optimize it now; there's one user.
4. **Don't add per-retrieval LLM calls, ever.** Anything that puts a model
   call inside the retrieval path multiplies the product's highest-volume
   operation. This is the concrete cost reason `co-cited` edge derivation was
   killed (`docs/product/vision.md §6`) and the standing reason to be suspicious of any
   future "enrich the context automatically" proposal.
5. **Leave chunk size alone at 900 chars** unless retrieval quality (not
   storage) motivates a change — see §3's note on why smaller chunks cost
   *more* storage, not less.
