# Checkpoint — 2026-08-10

Where things stand, so work can resume without re-deriving context.

**Sequencing authority is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).**
This file records *state*, not order — what's done, what's blocked, and what
needs a human decision. The 2026-08-05 edition of this file has been folded
into that plan and is gone; its unfinished items are tracked below.

## Where the project is

**Architecture v1 is frozen** (see [README.md](README.md) and
[adr/](adr/README.md)). Design is finished; the work now is implementation
against a settled plan.

**Phase 0 is implemented and awaiting review.** It fixed correctness problems,
not features — nothing on screen looks different except the toasts.

**The design/engineering handoff track (D1–D6) is done.** D1–D3 (materials,
button audit, Home composition) landed earlier; D4–D6 landed 2026-08-09.

**The embedding-provider decision changed, post-D6.** The product owner
rejected the hosted OpenAI direction outright — $0 and genuinely local were
non-negotiable. [ADR-0012](adr/0012-local-embeddings-bge-small.md) is the
result: BGE-small-en-v1.5 (quantized ONNX, via `fastembed`), running
in-process, benchmarked to fit Render's 512MB free tier with real headroom.
See "Blocked — needs you" below — the blocker changed shape (a migration to
apply, not a key to obtain), but there's still one real thing outstanding.

Phase 1 has **not** started.

## Phase 0 — what landed

| Task | State |
|---|---|
| 0.1 Real embedding provider | **Superseded 2026-08-10 — see below.** Local BGE-small, not the hosted OpenAI provider originally wired here. |
| 0.2 Guard tests | Done — 15 tests |
| 0.3 SM-2 tests + Python/TS parity | Done — 9 tests + 480-case parity check |
| 0.4 Citation validation | Done — 9 tests |
| 0.5 Cold-start warm-up | Done, verified live |
| 0.6 API docs gate | Done, verified both states |
| 0.7 Browser verification | **Partial** — see blockers |

Verification at time of writing: **34 tests pass**, `ruff check app/ --select
F,E9` clean, new files clean under the full ruleset, `tsc -b` clean, frontend
builds. Entry bundle measured at **147 KB gzipped** (~209 KB for a landing
visit), against a 250 KB budget — the 245 KB figure in older docs predated the
landing rebuild.

## Blocked — needs you

1. **One migration needs applying by hand — nothing else is blocking real
   retrieval anymore.** `USE_STUB_EMBEDDINGS=true` is still set (in `.env`,
   `.env.example`, `render.yaml`) — not because a key is missing (local
   models don't need one), but because `document_chunks.embedding` is still
   `vector(1536)` and BGE-small-en-v1.5 outputs 384 dims. **Until the
   migration runs, retrieval is not semantically meaningful** — chunks
   return in an arbitrary-but-consistent order, and every citation points at
   a real page that isn't necessarily the right one.

   To switch on:
   1. Open the Supabase SQL editor and run
      `supabase/migrations/20260810090000_embedding_dim_384.sql` by hand —
      this repo's standing convention, nothing applies migrations
      automatically. **Low-risk right now:** `document_chunks` has zero rows
      in the live database (confirmed before writing the migration), so
      there's no real data to lose.
   2. Set `USE_STUB_EMBEDDINGS=false`.
   3. Run `uv run python scripts/reembed_documents.py` from `api/` — harmless
      even with nothing to re-embed yet.

   Costs **$0**, not the ~2¢/semester previously estimated here — see
   [ADR-0012](adr/0012-local-embeddings-bge-small.md). The blocker is now
   purely "someone needs to run one SQL file," not account access or money.

2. **The real-corpus benchmark gap.** ADR-0012's quality evidence rests on a
   synthetic evaluation set, not SpaceLearn's own content — the live
   database had zero usable chunks to test against, and pulling the one real
   document from Storage hung three separate times in this environment
   (recorded as unresolved in the ADR, not silently dropped). Not urgent —
   the memory/latency case stands on its own — but worth closing once real
   documents exist: re-run `api/scripts/bench_embeddings.py` against them.

3. **The Notes editor still has not been opened in a browser.** Rebuilt on
   Tiptap several sessions ago, never visually verified — the longest-standing
   unverified thing in the project. It sits behind sign-in, and signing in
   isn't something I can do for you. Same for the Profile empty state.

   When you sign in, check: inline `/ai`, the formatting toolbar, markdown
   round-tripping, and that no raw HTML or literal `**` reaches the screen
   (`notes.py::_demote_html` is the defensive net; confirm it's holding).

## What changed on screen

Only the toasts. All three kinds failed WCAG AA — success 1.21:1, error
1.97:1, and info **1.16:1** (white text on the near-white `--color-ink`,
which `IMPLEMENTATION_PLAN.md` had never noticed). Now 8.5–12.2:1 using the
`-soft`/`-deep` pairing the flashcard grade buttons already use. Verified by
computing resolved contrast in a live browser.

## Corrections made while implementing

Two documented claims turned out to be false, and are fixed in the docs:

- **The landing page never actually warmed the API.** `SOUL.md §10` described
  the mitigation and `PERFORMANCE.md §6` called it "already mitigated," but no
  ping existed outside `OfflineBanner` (which is behind auth). Now real, at
  Landing and the auth pages.
- **`IMPLEMENTATION_PLAN.md` was stale.** The display font is Archivo, not Big
  Shoulders Display, and `CodeMarquee` no longer exists — that half of the
  item is obsolete. The font race is real; axes were narrowed to what's
  actually used, which shortens the swap window without closing it.

## Found, logged, not fixed

- `subspaces.py` keeps private copies of the `guards.py` helpers, and one
  raises `Forbidden` (403) where the shared guard raises `NotFound` (404) —
  contradicting the documented anti-enumeration choice. Tracked as
  `IMPLEMENTATION_PLAN.md` tasks 1.7/1.8. **Not touched this pass** —
  explicitly out of scope for D4–D6.
- No frontend test runner is configured. Task 1.8, Phase 1. **Confirmed
  still the right call, not built this pass** — `schedule.ts` is the
  highest-value target when it happens.
- `CardSequence.tsx` exists, is well-built, and is **not imported anywhere
  in `Landing.tsx`** — dead code on the actual page. Found auditing it for
  D5. Not removed (out of scope; might be intentionally held for later use)
  but worth a decision: wire it in or delete it.
- `wow.tsx`'s `reduced()` check (`VelocityTilt`, `Magnetic`,
  `DraftingCursor`, `SourceDrift`) is read once per effect-mount, not
  listened for — unlike `useReducedMotion()` (used by `HeroReveal`,
  `CardSequence`), which reacts live to the OS setting changing.
  Practically: toggling the OS motion preference *mid-session* on the
  landing page wouldn't stop these four until a remount. Both paths handle
  arriving-with-the-preference-already-set correctly. Real but low-impact;
  not fixed this pass.

## D4–D6 — design/engineering handoff (2026-08-09)

**D4, auth responsiveness — no genuine issues found.** Tested 375/768/1024/
1440px on both `SignIn` and `SignUp`. The one documented prior break (auth
split firing at `lg`=1024px, overflowing on iPad Pro portrait) is already
fixed in the code (split now waits for `xl`=1280px) and confirmed
non-regressed live at exactly 1024px. No overflow at any width. The
1440px panel's one card bleeding past its edge is by design (vignette
sells it, contained by the panel's own `overflow-hidden`). No code changed.

**D5, landing motion — one real gap found and closed.** `HeroReveal.tsx` and
`CardSequence.tsx` correctly import and use `language.ts`'s `EASE`/`DUR`/
`STAGGER`. `Landing.tsx` didn't import from `language.ts` at all, and four
hover/transition micro-interactions (across `wow.tsx`'s CTA icon,
`Landing.tsx`'s progress dots and two hover-lifts, `CardSequence.tsx`'s beat
dots) fell back to Tailwind's default easing instead of the system's
`cubic-bezier(0.22,1,0.36,1)` — demonstrable side-by-side against sibling
elements in the same components that *did* use it correctly. Fixed by
applying `style={{transitionTimingFunction: EASE_CSS}}`; durations left as
they were (no evidence they were wrong, per `DUR`'s own "multiples, not an
exact requirement" framing). **No sticky/fixed violation exists** — verified
by cross-referencing every `wow.tsx` wrapper usage against every
sticky/fixed element in the folder, and confirmed live: both pinned scroll
scenes hold `top: 0` across their full scroll range, release cleanly, no
horizontal overflow anywhere across a 40-point scroll sweep at 1280px.

**D6, performance — the app-shell warm-up moved, `/me/stats` measured for
real.** `/me/stats` — **actually measured**, 2026-08-09, 20 runs of the
real, unmodified `stats()` handler against the real live database (a real
account with data, not empty): median 518.8ms, 475.6ms excluding a
one-time connection-pool warm-up on run 1. The previously-documented
"~150ms" figure was a simulated estimate, not a measurement, and was wrong
by roughly 3–4x. `asyncio.gather` already covers all 8 independent reads —
confirmed in code, then corroborated by the numbers themselves (a
sequential baseline would land at 1600–2400ms, not 430–750ms). **No
implementation change made** — the measurements don't demonstrate a
problem, per instruction. Script kept at
`api/scripts/measure_me_stats.py` for re-running later.

Warm-up relocation to `AuthProvider`: **still not independently verified live
— reporting this honestly rather than claiming otherwise.** The API server
(port 8001) was not running this session and browser navigation was
unavailable/declined, so nobody has watched a `GET /api/v1/health → 200`
actually fire from a cold direct-load of `/home`. What *is* verified:
`main.tsx` wraps `AuthProvider` above the router (confirmed by reading the
file), so it mounts unconditionally on every load; `tsc -b` is clean; and
`warmApi()`/`/health` is the identical, unmodified mechanism Phase 0 already
proved works end-to-end from a different mount point. The code path is
correct by inspection — the live fire has not been watched. **Manual
verification needed:** open the app fresh (not signed in, or a direct
bookmark past sign-in) with the API server running, and confirm
`GET /api/v1/health` appears in the network tab before/alongside the first
authenticated data request.

Frontend test runner: confirmed the existing plan (task 1.8) already has
the right answer — needed eventually, not now, `schedule.ts` first — left
alone rather than built, since that's Phase 1 work.

## Next

Phase 1 (`IMPLEMENTATION_PLAN.md`) — the tag/choice schema change that
prepares confusion pairs. It does not depend on the embedding migration, so
it can start in parallel with applying blocker 1. Every retrieval-quality
claim stays provisional until that migration is applied and real documents
have actually been embedded and re-embedded.

## Standing constraints

- Local only. Do not deploy until told.
- Migrations are applied manually in the Supabase SQL editor; pushing to
  GitHub does **not** update the database.
- Never push without being asked.
