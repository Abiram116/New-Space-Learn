# Checkpoint — 2026-08-05

> **Superseded for sequencing (2026-08-09).** This file's "Do this next"
> ordering has been folded into
> [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), which is now the single
> authority on what to work on next — its Phase 0 carries the
> browser-verification items below. Keep reading this file for the *historical
> record* of what was uncommitted and why on 2026-08-05; ignore its ordering.

Where things stand, so work can resume without re-deriving context. Delete
this file once the open items below are done.

## Committed and pushed

- `b80d659` — backlog §7–§13, plus the performance/security audit
  (8-round-trip `/me/stats` → 1, unmetered LLM endpoint closed, route
  code-splitting 451 KB → 245 KB gzipped).

## Uncommitted, in the working tree

Everything below is written, typechecked, built, and backend-verified —
but **not committed and not seen in a browser**.

### Fixes from live feedback
- **Streak hover showed empty boxes.** `StreakLedger` rendered
  `'▮'.repeat(intensity)` — a glyph Big Shoulders Display doesn't carry.
  Third recurrence of the unsupported-glyph class (after `γ` in AuthShell
  and Landing). Backend also discarded real per-day minutes and sent only
  an abstract 0–3 intensity, so the hover had nothing true to show.
  `HeatmapCell` now carries `minutes`; hover reads `~12m`.
- **Study time was not measured.** 60s/chat, 20s/card, 180s/quiz were bare
  magic numbers in three routers. Centralised in `services/activity.py`
  with reasoning; UI now renders `~11m` because presenting an estimate as a
  measurement is the `fullness()` mistake again.
- **Page switching.** Ownership guard and data read ran sequentially in six
  list endpoints. The reads are already `user_id`-scoped, so they can't
  leak — now gathered. All six verified to still raise `NotFound` for an
  unowned subspace (`verify_guard.py`). 2–3 round trips → 1.
- **Chunk prefetch.** Split chunks warm on idle, so splitting the bundle
  doesn't cost a wait on first opening Notes/Cards/Quizzes.
- **Brief copy.** Prompt said "Name the actual topic" in the body, but the
  headline already names it — that caused "Markov decision processes" to
  appear twice. Fixed, plus an explicit ban on filler phrasing.

### New: app motion system
`web/src/components/ui/motion.tsx` — `Rise`, `Stagger`, `PageTransition`,
`CountUp`, `useReducedMotion`. Closes the audit's biggest finding: the
landing page had a full motion vocabulary while the app had hover colours
and nothing else.

Applied: page cross-fades (`AppShell`), dealt-in topic cards + counting
streak (Home), chat bubble entrances, quiz results stagger + score
count-up.

### New: `docs/design-plan.md`
Per-page design plan for every surface, motion principles, and Higgsfield
asset briefs written as ready-to-paste prompts, with sequencing.

### Other
- Profile had **no empty state at all** — a new account saw empty charts
  with no explanation. Added, and switched it to the shared stats cache.
- Home first-run copy rewritten to sound like the companion introducing
  itself rather than a database reporting zero rows.
- Home suggestion CTA now visually distinct from a generic action.

## Do this next, in order

> Superseded — see the note at the top of this file.
> [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 0 now carries items
> 1–2 below; items 3–4 remain scoped in `design-plan.md` and
> `plan-frontend.md §16`.

1. **Run it and click through.** Nothing above has been seen in a browser.
   Highest priority is the **Notes editor** (Tiptap, inline `/ai`) — built
   two sessions ago and still never visually verified.
2. `docs/design-plan.md` §5 Phase 1 — toast contrast, landing font race and
   marquee gap.
3. Phase 2 — flashcard grade buttons (flagged twice as feeling wrong, still
   unaddressed), docs processing→ready transition.
4. Phase 3 — Higgsfield assets. Generate the §4.2 icon set first: smallest,
   fastest way to judge whether the style contract holds before committing
   to video.

## Standing constraints

- Local only. Do not deploy until told.
- Migrations are applied manually in the Supabase SQL editor; pushing to
  GitHub does **not** update the database.
- Never push without being asked.
