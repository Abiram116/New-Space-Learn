# Checkpoint — 2026-08-09

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

## Phase 0 — what landed

| Task | State |
|---|---|
| 0.1 Real embedding provider | Code complete, **switch off** — see blockers |
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

1. **No embedding provider key exists.** This is the big one. The provider is
   fully wired (`embeddings.py`, batching + dimension checks + typed errors),
   but `USE_STUB_EMBEDDINGS=true` is still set in `.env`, `.env.example` and
   `render.yaml` because there's no `EMBEDDING_API_KEY` anywhere. **Until
   that changes, retrieval is not semantically meaningful** — it returns
   chunks in an arbitrary-but-consistent order, and every citation points at
   a real page that isn't necessarily the right one.

   To switch on: set `EMBEDDING_API_KEY`, set `USE_STUB_EMBEDDINGS=false`,
   then run `uv run python scripts/reembed_documents.py` from `api/` once.
   Documents ingested under the stub keep their meaningless vectors until you
   do, and nothing about them looks broken from the outside.

   Costed in [COST_MODEL.md](COST_MODEL.md) — roughly 2¢ per student per
   semester. The blocker is account access, not money.

   Setting the flag without a key is safe: it logs a warning once and keeps
   using the stub rather than failing every upload.

2. **The Notes editor still has not been opened in a browser.** Rebuilt on
   Tiptap several sessions ago, never visually verified — the longest-standing
   unverified thing in the project. It sits behind sign-in, and signing in
   isn't something I can do for you. Same for the Profile empty state.

   When you sign in, check: inline `/ai`, the formatting toolbar, markdown
   round-tripping, and that no raw HTML or literal `**` reaches the screen
   (`notes.py::_demote_html` is the defensive net; confirm it's holding).

## What changed on screen

Only the toasts. All three kinds failed WCAG AA — success 1.21:1, error
1.97:1, and info **1.16:1** (white text on the near-white `--color-ink`,
which `plan-frontend.md §14` had never noticed). Now 8.5–12.2:1 using the
`-soft`/`-deep` pairing the flashcard grade buttons already use. Verified by
computing resolved contrast in a live browser.

## Corrections made while implementing

Two documented claims turned out to be false, and are fixed in the docs:

- **The landing page never actually warmed the API.** `SOUL.md §10` described
  the mitigation and `PERFORMANCE.md §6` called it "already mitigated," but no
  ping existed outside `OfflineBanner` (which is behind auth). Now real, at
  Landing and the auth pages.
- **`plan-frontend.md §15` was stale.** The display font is Archivo, not Big
  Shoulders Display, and `CodeMarquee` no longer exists — that half of the
  item is obsolete. The font race is real; axes were narrowed to what's
  actually used, which shortens the swap window without closing it.

## Found, logged, not fixed

- `subspaces.py` keeps private copies of the `guards.py` helpers, and one
  raises `Forbidden` (403) where the shared guard raises `NotFound` (404) —
  contradicting the documented anti-enumeration choice. In
  [backlog.md](backlog.md).
- No frontend test runner is configured at all. Backend coverage now exists;
  `web/` has none.

## Next

Phase 1 (`IMPLEMENTATION_PLAN.md`) — the tag/choice schema change that
prepares confusion pairs. It does not depend on the embedding key, so it can
start while that's being sorted out. Every retrieval-quality claim stays
provisional until blocker 1 is cleared.

## Standing constraints

- Local only. Do not deploy until told.
- Migrations are applied manually in the Supabase SQL editor; pushing to
  GitHub does **not** update the database.
- Never push without being asked.
