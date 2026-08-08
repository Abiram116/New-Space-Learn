# ADR-0010 — Relationships must be evidenced, never model-inferred

- **Status:** Accepted
- **Date:** 2026-08-09 (formalized; the principle predates this as `subspace_links`' design note)
- **Related:** [ADR-0002](0002-reject-concept-graph-schema.md), `docs/SOUL.md §6`, `PRODUCT.md` Principle 3

## Context

`PRODUCT.md` Principle 3 states that every claim is traceable — originally
about *answers* carrying citations. As the product grew toward modeling a
student's understanding, the same question arose one level up: when the app
asserts that two things are *related*, or that a student is weak at
something, where does that assertion come from?

The tempting answer is an LLM: ask a model which concepts relate, or to
summarize what a student struggles with. Roam, Obsidian, and every "AI
knowledge graph" demo take some version of this path.

## Problem

An unauditable claim about a student is worse than no claim. If the app says
"you keep confusing X and Y" and can't show why, a student can't correct it, a
lecturer can't trust it, and nobody can tell a real insight from a
hallucination.

## Decision

**Every relationship and every claim about a student must trace to a specific
stored row. A model may *propose*; it may never *assert*.**

Concretely, the permitted evidence types:

| Relationship | Evidence | Status |
|---|---|---|
| `declared` — the student linked two topics | a `subspace_links` row | Built |
| `confused-with` — you reliably pick B when the answer is A | a distractor tally over `quiz_results` | Approved, `plan-backend.md §11` |
| Weak/strong area | real quiz averages grouped from `quiz_results` | Built |
| Citation | `document_id` + `locator` written at retrieval time | Built |

**What is forbidden:** "the model thinks these are related." An LLM-proposed
relationship may be surfaced as a *suggestion the student confirms*, at which
point it becomes a `declared` edge — evidence of the student's action, not the
model's opinion.

## Alternatives considered

1. **LLM-inferred relationships, stored as facts.** Rejected: unfalsifiable
   and wrong often enough to poison trust in everything else the app says.
   This is precisely why competitors' knowledge graphs are "beautiful, useless
   hairballs" — a graph you can't audit is decoration.
2. **Manual-only relationships.** Rejected as too strict, and for a
   clarifying reason: the line isn't manual-vs-automatic, it's **fact vs
   guess.** "These two were both cited from p.31" is an *observation*, and
   deriving it automatically is fine. "These two seem conceptually similar" is
   an inference, and automating it is not.
3. **Evidence-only, automatic derivation permitted.** Chosen.

## Trade-offs

**Cost:** fewer features. No automatic concept map, no "you might also like,"
no inferred learning-style detection. `SOUL.md §14` frames this as an
interview answer worth having: "It cost me features and it's the reason a
lecturer could trust it."

**Benefit:** every sentence the app says about a student is defensible, and
the aggregate institutional product (`SOUL.md §13` — "73% of the cohort
confuses these two concepts") is *only* saleable because it's a count of real
attempts rather than a model's impression of a cohort.

**A tension this resolves explicitly:** the product's positioning is
"understanding," which invites inference; the implementation forbids it. The
reconciling sentence, from `SOUL.md §4`: *the positioning is "understanding,"
the implementation stays "evidence."* Both survive because understanding is
**measured**, not guessed.

## Consequences

- `co-cited` and `co-failed` edges were killed under this principle *plus*
  cost analysis (ADR-0002) — `co-cited` would have needed a model call to
  determine which concepts a chunk contains, making it an inference wearing an
  observation's clothes.
- `MEMORY_ENGINE.md §3` forbids the tempting "LLM-generated summary of what
  this student struggles with" in Learning memory, for this reason.
- Every computed signal is recalculated from raw rows on read, never cached as
  a derived value that could drift — a corollary of the same principle, and
  the direct lesson from `retrospective.md §4`'s invented-metric mistake.
- `retrospective.md`'s standing checklist enforces this at feature-review
  time: "Does every number/bar/chart point at something real and stored?"

## Future migration path

This principle should not be migrated away from — it's product identity, not
an implementation detail. The one sanctioned extension is the
propose-then-confirm flow: a model suggests a link, the student accepts, and
it lands as `declared`. Any future proposal to store a model's unconfirmed
judgment about a student should be treated as a change to what the product
*is*, and argued at that level.
