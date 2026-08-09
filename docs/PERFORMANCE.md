# Performance

Explicit budgets first, then the mechanisms already in place per layer, then
one real discrepancy found while writing this document that's worth fixing
before it's trusted further.

---

## 1. Latency budgets

| Interaction | Budget | Current reality |
|---|---|---|
| Landing page first paint | <1s | Static on Vercel, no backend dependency — should already meet this |
| App shell interactive, backend warm | <500ms | Not independently measured; depends on auth verify + first data fetch |
| App shell interactive, backend cold | Best-effort — Render free tier costs ~30s here, not a target to hit | Mitigated for landing visitors (health-ping warm-up per `SOUL.md §10`); **not mitigated for a student who bookmarks the app directly and lands past the landing page** — see §6 |
| Simple list/get API call, warm | <300ms | One measured warm round trip to remote Supabase is ~150–257ms (`IMPLEMENTATION_PLAN.md`); most list endpoints are 1–2 round trips deep after the responsiveness pass |
| Chat time-to-first-token, warm | <1.5s | Retrieval (2–3 round trips) + Groq TTFT (estimated 300–600ms) — not independently measured end-to-end |
| Quiz/flashcard generation (full artifact) | <6s | One 70B call generating N structured items — the slowest routine user-facing wait in the product; must always show a real loading state, never a bare spinner with no explanation |
| Document processing (upload → ready) | Hard cap 25s (`PROCESSING_BUDGET_S`); target median <8s for a typical lecture PDF | Not independently measured; falls back to "still processing, tap reprocess" on timeout rather than hanging |
| First-load JS bundle (gzipped) | ≤250KB | **Measured 2026-08-09: 147KB** entry (app), **~209KB** for a landing visit (entry + the lazy `Landing` chunk). The 245KB previously recorded here predates the landing rebuild and further splitting. |
| Any in-app animation | ≤320ms (`IMPLEMENTATION_PLAN.md`'s existing rule) | Enforced by convention (`components/ui/motion.tsx`), not a runtime check |

These are planning targets, not SLAs verified by a monitoring system —
this product has no APM. Treat every "not independently measured" note
above as a to-do, not a claim.

---

## 2. Frontend

- **Bundle:** route-level code splitting already moved Tiptap, Landing,
  Flashcards, and Quizzes out of the main chunk, cutting first load from
  451KB to 245KB gzipped (`IMPLEMENTATION_PLAN.md`'s Responsiveness work). Split
  chunks prefetch on idle so opening Notes/Cards/Quizzes for the first time
  doesn't cost a cold fetch on top of the click.
- **Headroom is thin.** 245KB against a 250KB self-imposed ceiling leaves
  ~5KB. The Gap Map (`IMPLEMENTATION_PLAN.md`) will need a rendering approach
  — **budget it as its own lazy-loaded route chunk from the start**, the
  same way Tiptap is isolated today. Do not import a charting/graph library
  into a shared module that the main chunk pulls in.
- **Motion:** governed by `IMPLEMENTATION_PLAN.md`'s six rules (nothing over
  ~320ms, stagger capped at ~240ms total, `prefers-reduced-motion` renders
  the final state, etc.) — not repeated here, just the pointer. Any new
  epic that adds motion (confusion-pair reveal, exam countdown) inherits
  these rules by default, not by re-deciding them.
- **Session cache** (`MEMORY_ENGINE.md §2`) is the main lever against
  redundant refetching — 60s TTL for stats, 30min for the brief, explicit
  invalidation on grading/quiz-submit. This is a caching strategy, not a
  raw-speed one: it makes the *second* visit to a page free, not the first.

---

## 3. Backend

- **Round-trip discipline:** the standing rule is "independent awaits in one
  handler are a latency bug" (`IMPLEMENTATION_PLAN.md`) — reach for
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
  for exactly one worker — see `ARCHITECTURE.md` for when this
  stops being true.
- **Inline document processing**, capped at 25s, is the direct performance
  consequence of "no background workers" — a document that can't finish in
  the budget hands back a resumable `processing` state instead of hanging
  the request until Render's own timeout kills the connection.

---

## 4. Database

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
  that's a correctness fix (`AI_ENGINE.md §4`), not a performance one.

---

## 5. Streaming

Chat's SSE stream emits `citation` events before the first `token` —
deliberately, so the frontend can render source cards while generation is
still running rather than waiting for the full reply. This is the one place
in the product where perceived latency was reduced by *reordering* work, not
by making anything faster. Quiz/flashcard generation can't use the same
trick (§ `REQUEST_PIPELINE.md`'s note on why those aren't streamed) — the
mitigation there has to be a good loading state, not a streaming response.

---

## 6. Cold starts

Render's free tier spins down after 15 minutes idle; the next request pays
~30s.

**Corrected 2026-08-09.** This section previously said `SOUL.md §10`'s
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

## 7. A real discrepancy worth resolving, not just noting

Two performance write-ups in this codebase reach opposite conclusions about
concurrent Supabase calls, and it's worth naming plainly rather than letting
both stand unreconciled:

- `spaces.py::_bulk_counts` — **measured**, explicitly, with real
  wall-clock numbers: 4 gathered calls (1566ms) lost to 4 sequential calls
  (1114ms) against this remote Postgres, because of TLS handshake overhead.
  Kept sequential.
- `/me/stats` (`IMPLEMENTATION_PLAN.md`'s Responsiveness section) — went from 8
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

## 8. Recommendations, ranked by effort ÷ impact

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
