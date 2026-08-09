# ADR-0008 — SM-2-lite, deliberately duplicated client-side for optimistic UI

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** `api/app/routers/flashcards.py::grade_card`, `web/src/features/flashcards/FlashcardsView.tsx`, `docs/REQUEST_PIPELINE.md`

## Context

Flashcard review is the most repetitive interaction in the product — a student
grades dozens of cards in a session, and each grade must schedule the card's
next appearance. Any per-card latency is felt multiplied.

## Problem

Two decisions, entangled: which scheduling algorithm, and whether the UI waits
for the server before advancing to the next card.

## Decision

**SM-2-lite** — a simplified SM-2: an `ease` factor (floor 1.3), an
`interval_days`, a `reps` counter, and four grades (`again`/`hard`/`good`/
`easy`) adjusting them.

**Grading is optimistic:** the frontend advances to the next card immediately
and computes the same interval math locally, firing the `PATCH` behind it.
**This means the algorithm is deliberately implemented twice — once in Python,
once in TypeScript.**

## Alternatives considered

1. **Full SM-2 / SM-17 / FSRS.** Rejected for now: materially more complex
   state per card, and the product's differentiating scheduling idea is
   *exam-awareness* (ADR pending, `IMPLEMENTATION_PLAN.md`), which is a genuine
   improvement over vanilla SM-2 for students and is orthogonal to the base
   algorithm's sophistication. FSRS would be a better algorithm; it would not
   be a better *product* differentiator, and it's a heavier lift.
2. **Server-authoritative grading, UI waits for the response.** Rejected: a
   ~250ms round trip per card, felt on every single grade in a long session.
3. **Optimistic UI with duplicated math.** Chosen.

## Trade-offs

**Cost — and this is a real DRY violation, chosen knowingly:** the same
algorithm exists in two languages and can drift. `flashcards.py`'s docstring
flags it explicitly ("keep the two in sync"), which is the only thing
currently preventing drift — there is no test asserting the two agree.

**Benefit:** review feels instant. The server runs the identical algorithm, so
the worst case is briefly stale interval math that self-corrects within one
round trip — the frontend comment states this trade directly.

**Why duplication beats the alternatives here:** extracting the algorithm to a
shared spec (JSON rules interpreted by both, or generating one from the other)
would add machinery disproportionate to ~20 lines of arithmetic. Two small
implementations with a test asserting agreement is simpler than one clever
shared one.

## Consequences

- **Any change to scheduling must land in both places.**
  `IMPLEMENTATION_PLAN.md` Phase 3 calls this out explicitly for exam-aware
  compression: server-only compression would make every compressed card flash
  the *uncompressed* interval for one round trip — a visible regression of the
  exact property optimism exists to provide.
- A cross-implementation agreement test is scheduled in Phase 0.3 — the right
  mitigation for a knowing DRY violation.
- Grading overwrites SM-2 state in place with no history log
  (`MEMORY_ENGINE.md §5`), asymmetric with `quiz_results`' append-only model.
  Intentional: no current or planned feature needs grade *history*, only
  current state.

## Future migration path

Moving to FSRS would mean more per-card state and a heavier algorithm — at
which point duplicating it client-side stops being reasonable, and the right
answer flips to server-authoritative grading with a *predicted* next-card
prefetch to hide the latency. That's a larger change than swapping the
formula, so the algorithm choice and the optimism strategy should be revisited
together, not separately.
