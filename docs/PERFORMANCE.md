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
| Simple list/get API call, warm | <300ms | One measured warm round trip to remote Supabase is ~150–257ms (`plan-backend.md`); most list endpoints are 1–2 round trips deep after the responsiveness pass |
| Chat time-to-first-token, warm | <1.5s | Retrieval (2–3 round trips) + Groq TTFT (estimated 300–600ms) — not independently measured end-to-end |
| Quiz/flashcard generation (full artifact) | <6s | One 70B call generating N structured items — the slowest routine user-facing wait in the product; must always show a real loading state, never a bare spinner with no explanation |
| Document processing (upload → ready) | Hard cap 25s (`PROCESSING_BUDGET_S`); target median <8s for a typical lecture PDF | Not independently measured; falls back to "still processing, tap reprocess" on timeout rather than hanging |
| First-load JS bundle (gzipped) | ≤250KB | **245KB today** — right at the self-imposed ceiling; see §2 |
| Any in-app animation | ≤320ms (`design-plan.md §2`'s existing rule) | Enforced by convention (`components/ui/motion.tsx`), not a runtime check |

These are planning targets, not SLAs verified by a monitoring system —
this product has no APM. Treat every "not independently measured" note
above as a to-do, not a claim.

---

## 2. Frontend

- **Bundle:** route-level code splitting already moved Tiptap, Landing,
  Flashcards, and Quizzes out of the main chunk, cutting first load from
  451KB to 245KB gzipped (`plan-backend.md`'s Responsiveness work). Split
  chunks prefetch on idle so opening Notes/Cards/Quizzes for the first time
  doesn't cost a cold fetch on top of the click.
- **Headroom is thin.** 245KB against a 250KB self-imposed ceiling leaves
  ~5KB. The Gap Map (`plan-frontend.md §19`) will need a rendering approach
  — **budget it as its own lazy-loaded route chunk from the start**, the
  same way Tiptap is isolated today. Do not import a charting/graph library
  into a shared module that the main chunk pulls in.
- **Motion:** governed by `design-plan.md §2`'s six rules (nothing over
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
  handler are a latency bug" (`plan-backend.md`) — reach for
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
  for exactly one worker — see `SYSTEM_ARCHITECTURE.md §5` for when this
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
~30s. `SOUL.md §10`'s mitigation — a `/health` ping fired from the landing
page on load — covers a visitor who arrives at `/welcome` and reads the
pitch before clicking through. **It does not cover a returning student who
bookmarks the app directly** (`/home`, or a specific subspace URL) and hits
a cold backend with no warm-up window. This is a real, currently-unaddressed
gap for exactly the "re-entry beats onboarding" user `PRODUCT.md` names as
primary. Cheapest fix: fire the same health-ping from the app shell's own
mount (`AppShell`), not just the landing page — a few lines, no new
infrastructure, closes the gap for the more important of the two visitor
types.

---

## 7. A real discrepancy worth resolving, not just noting

Two performance write-ups in this codebase reach opposite conclusions about
concurrent Supabase calls, and it's worth naming plainly rather than letting
both stand unreconciled:

- `spaces.py::_bulk_counts` — **measured**, explicitly, with real
  wall-clock numbers: 4 gathered calls (1566ms) lost to 4 sequential calls
  (1114ms) against this remote Postgres, because of TLS handshake overhead.
  Kept sequential.
- `/me/stats` (`plan-backend.md`'s Responsiveness section) — went from 8
  sequential round trips to `asyncio.gather`, reporting "8 deep (~1200ms) →
  1 deep (~150ms)." But that section's own header states the numbers are
  from "a 150ms *simulated* round trip, counting round-trip depth" — an
  idealized model, not a wall-clock measurement of the real gather call the
  way `_bulk_counts` was.

**Both directional calls are very likely still correct** — going from 8
sequential calls to gathering them is almost certainly a large win even
accounting for TLS contention, and 4-way contention costing more than
4-way's benefit doesn't mean 8-way necessarily follows the same curve.
But "~150ms" is a planning estimate dressed as a measurement, sitting next
to a genuinely measured number in a sibling file. **Recommended fix, small:**
add one timing log line around `/me/stats`'s handler and replace the estimate
with a real number. Local against the real remote Supabase is sufficient —
the round trips being measured go to Supabase, not to Render, so this doesn't
require a live deployment. This is exactly the "measurement over intuition"
principle this codebase already prides itself on in `SOUL.md §14` — worth
holding every performance claim to it, including ones already written down.

---

## 8. Recommendations, ranked by effort ÷ impact

1. **Warm the app shell, not just the landing page** (§6) — a few lines,
   closes the highest-impact remaining cold-start gap.
2. **Measure `/me/stats` for real** (§7) — a log line or a `curl` timing,
   resolves a real internal inconsistency in this codebase's own
   performance claims.
3. **Budget the Gap Map's rendering approach as its own lazy chunk from day
   one** (§2) — costs nothing extra if done from the start; costly to
   retrofit if a graphing library quietly lands in the main bundle first.
4. **Fix real embeddings before optimizing retrieval further** (§4) — any
   retrieval-latency work done before this is optimizing the wrong metric.
