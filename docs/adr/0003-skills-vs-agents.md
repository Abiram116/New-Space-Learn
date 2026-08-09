# ADR-0003 — Split persistent Skills from one-shot Agents

- **Status:** Accepted
- **Date:** 2026-08-03 (original), extended 2026-08-05 (behavior package)
- **Related:** `PRODUCT.md` "Capabilities and Constraints", `IMPLEMENTATION_PLAN.md`

## Context

The product needed a way for students to shape how the AI behaves, and a way
to turn a conversation into study material. These are easy to collapse into
one "AI features" concept — and collapsing them makes both incomprehensible.

## Problem

If a student can "turn on" a Socratic Tutor and also "run" a flashcard
generator, and both are presented identically, the mental model breaks: one
persists and changes every future answer, the other executes once and hands
back an artifact. Users can't predict which is which.

## Decision

Two distinct first-class concepts, and the UI must keep them visibly
distinct:

- **Skills** are persistent AI *personalities* attached to a subspace. They
  change how every answer in that topic is written. Configurable, cloneable
  from a library, stay on until turned off.
- **Agents** are one-shot *actions* that consume the current conversation and
  produce an artifact (a note, a deck, a quiz). They run, hand something
  back, and they're done.

The one-line test `PRODUCT.md` requires the UI to satisfy: **a Skill changes
how the AI talks; an Agent makes you something.**

## Alternatives considered

1. **One unified "AI tools" concept.** Rejected: collapses a real behavioral
   difference and leaves users unable to predict persistence.
2. **Skills only** (agents as slash-commands inside chat). Rejected: artifact
   generation deserves its own affordance — it's the product's "hand-off,"
   which `PRODUCT.md` Principle 1 names as *the* product.
3. **Agents only** (no persistent personality). Rejected: loses the
   Socratic-tutor use case entirely, which is one of the strongest
   pedagogical differentiators available.

## Trade-offs

- **Cost:** two concepts to explain, two UI surfaces, two data shapes.
- **Benefit:** each is independently comprehensible, and the distinction maps
  onto a real technical difference — Skills contribute to `build_prompt()`'s
  system message on every turn; Agents are separate endpoints producing rows
  in `notes`/`decks`/`quizzes`.

**Extension (2026-08-05):** a Skill was originally a single `instructions`
text blob. `IMPLEMENTATION_PLAN.md` upgraded it to a behavior package —
`instructions` kept its meaning as *reasoning style*, and `memory_scope`
(`session`/`topic`/`all`) plus `output_format` were added. `capabilities`
already served as the allowed-tools dimension. Existing rows migrated with no
data loss and no forced re-authoring.

`memory_scope` is the load-bearing one: it genuinely changes the history
window fed to the model (8 / 20 / 40 turns in `subspace_chat.py`), so it's a
real behavioral dimension rather than a longer prompt for its own sake.

## Consequences

- `skills` + `subspace_skills` tables; four seeded library Skills.
- `memory_scope: all` builds the largest prompt in the product (~3–5k input
  tokens/turn) on its highest-volume operation — noted as the primary cost
  lever in `COST_MODEL.md §6` if chat spend ever needs reducing.
- Agent endpoints must ground themselves in real retrieved context, never a
  bare topic string (`IMPLEMENTATION_PLAN.md`).

## Future migration path

If the two concepts ever need to converge (e.g. a Skill that can also produce
artifacts), the honest version is a Skill declaring which Agents it can
invoke — extending `capabilities`, not merging the tables.
