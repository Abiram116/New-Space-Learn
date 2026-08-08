# ADR-0002 — Reject the `concepts`/`concept_edges` schema; use normalized tags

- **Status:** Accepted
- **Date:** 2026-08-09
- **Amended by:** [ADR-0011](0011-gap-map-derived-concept-visualization.md) — Gap Map granularity only; this decision's core (no `concepts` table, no stored graph) stands unchanged
- **Related:** [ADR-0001](0001-subject-subspace-hierarchy.md), [ADR-0010](0010-evidence-only-relationships.md), `docs/SOUL.md`, `docs/KNOWLEDGE_MODEL.md`

## Context

An internal vision document (`SOUL.md`) proposed the product's next major
step: a per-student "model of understanding" enabling confusion-pair
detection, exam-aware scheduling, a diagnostic "Gap Map," and cross-subject
transfer. Its proposed implementation was a dedicated `concepts` +
`concept_edges` schema with four evidenced edge types (`co-cited`,
`co-failed`, `confused-with`, `declared`), phased over six milestones.

The product thesis was compelling and approved. The implementation was
audited against the actual codebase before committing to it.

## Problem

Does the flagship product value require a graph schema, and were the
proposal's cost estimates accurate?

## Decision

**Build the product vision. Reject the graph schema.** A "concept" is a
normalized tag string (`normalize(t) = trim(t).lowercase()`) on artifacts that
already exist — not a row with a UUID. Relationships are computed by
`GROUP BY` at read time, not stored as edges.

## Alternatives considered

1. **Build `concepts` + `concept_edges` as proposed.** Rejected — two of its
   four cost claims didn't survive checking, and nothing needed it.
2. **Full graph rearchitecture** (no containers, concepts and edges only) —
   SOUL.md's own stated alternative. Rejected for ADR-0001's reasons, plus
   materially more work.
3. **Normalized tag strings + read-time aggregation.** Chosen.

## Trade-offs

**Two claims in the proposal were mispriced, verified against the code:**

- *"`co-cited` is free — already happens during RAG retrieval."* Not free.
  `rag.retrieve()` returns chunks keyed by `document_id` + `locator`, never by
  concept. Deriving concept co-citation needs either a new extraction call per
  chunk — **recurring LLM cost on the product's highest-volume operation** —
  or a fragile keyword match. Killed.
- *"`confused-with` is cheap — one pass over stored answers; the data is
  sitting there, unread."* Directionally right, mechanically wrong.
  `quiz_results.answers` stores a chosen *index*; `choices` are bare strings
  with no concept identity. Knowing someone picked index 2 says nothing about
  what index 2 meant. It needs a small schema addition (per-choice concept
  labels), which is still cheap — just not free, and not already there.

**What the tag approach gives up:** true synonym resolution. "Bayes' rule"
and "Bayes' theorem" are different concepts until a human writes them
identically. This is an honest, *visible* limitation — as opposed to a
silently-wrong entity merge from a resolution algorithm nobody can audit.

**What it buys:** zero new tables; all three flagship features cost **$0 per
use** (`COST_MODEL.md §4`); no write on the retrieval hot path; no
extraction pipeline; and no new attack surface.

## Consequences

- `SOUL.md` was rewritten to reflect this; its duplicate draft was deleted.
- `plan-backend.md §11–14` / `plan-frontend.md §17–19` carry the redesigned
  epics; `IMPLEMENTATION_PLAN.md` sequences them.
- The Gap Map was initially rescoped to **subspace-level** nodes here, to
  avoid needing a concept entity. That rescoping turned out not to be
  computable and was corrected by
  [ADR-0011](0011-gap-map-derived-concept-visualization.md): nodes are
  normalized tags and edges are derived from evidence at render time. **This
  does not reopen the present decision** — ADR-0011 still stores no graph and
  adds no `concepts` table; it only changes what the *visualization* is
  computed from.
- `co-failed` will never be built: low signal (two questions wrong in one
  attempt correlates with quiz difficulty and rushing at least as much as
  with a conceptual relationship).
- `v2-review.md` gained a "Round 3" entry recording that this is the second
  independent rejection of a concept graph on this stack.

## Future migration path

Escalate only on observed evidence that tag matching is insufficient:
(1) curated synonym list; (2) student-confirmed LLM-proposed merges;
(3) a resolved `concepts` entity, at which point this ADR is superseded
rather than quietly ignored. Note that arriving at (3) would still not
require `concept_edges` — relationships can stay computed.
