# ADR-0011 — The Gap Map is a derived concept-level visualization, not stored structure

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [ADR-0002](0002-reject-concept-graph-schema.md), [ADR-0010](0010-evidence-only-relationships.md), `docs/SOUL.md §8.3`, `docs/KNOWLEDGE_MODEL.md §5`

## Context

`SOUL.md`'s original draft described the Gap Map with **concept-level** nodes
and edges whose thickness showed "how often you fail across that edge." When
ADR-0002 rejected the `concepts`/`concept_edges` schema, the Gap Map was
rescoped to **subspace-level** nodes to avoid needing a concept entity — while
keeping the confusion-weighted-edge idea unchanged.

A consistency check found that combination is not computable.

## Problem

A confusion pair is derived from a single question, inside a single quiz, and
`quizzes.subspace_id` holds exactly one value. Therefore the correct concept
and the chosen concept in **every** confusion pair belong to the same
subspace. No confusion pair can ever span two subspaces, so confusion data can
never weight an edge *between* subspaces. The specification described a
visualization whose central visual signal had no possible data source.

## Decision

**Nodes are normalized tags. Edges are computed from evidence at render time.
Nothing about the map is stored.**

- **Node** = a normalized concept tag (`normalize(t) = trim(t).lowercase()`),
  the same string `KNOWLEDGE_MODEL.md §3` already defines.
- **Node size** = how heavily the material weights that concept — the count of
  quiz questions and flashcards carrying the tag.
- **Node colour** = current recall strength — quiz average grouped by
  normalized tag, the same computation as `TopicSignal` at finer grain.
- **Edge** = a confusion pair between two concepts; **thickness = the tally**.
  This works natively, because both concepts in a confusion pair come from the
  same question — the exact property that made subspace-level edges impossible
  makes concept-level edges correct.
- **Scope** = one subject at a time, for readability. A tag appearing in more
  than one subject is marked as such, which is how the map exposes
  `SOUL.md §5`'s cross-subject consequence without a separate mechanism.

**No graph database. No graph storage. No adjacency table, no materialized
view, no cached layout.** The relational database remains the single source of
truth; the graph is a *projection* of it, assembled per request from
`quizzes`, `quiz_results`, and `flashcards`, and discarded when the response
is sent.

## Alternatives considered

1. **Keep subspace nodes, drop edge weighting** — edges from `subspace_links`
   unweighted, confusion rendered as node intensity instead. Viable and
   cheapest, but abandons the map's strongest visual signal: the thick edge
   *between* two things is the entire diagnostic idea.
2. **Keep subspace nodes, weight edges by shared concept tags** — a different
   metric ("these two topics overlap") wearing the visual language of a
   different one ("you fail across this link"). Rejected as quietly
   misleading, which ADR-0010's discipline forbids.
3. **Concept-level nodes with derived edges.** Chosen — restores the original
   intent, and every input already exists or is already scheduled.
4. **A stored concept graph to back it** — rejected again here, for
   ADR-0002's reasons. The visualization needing to *look* like a graph is not
   an argument for *storing* one.

## Trade-offs

**Cost:** the aggregation is more work per request than reading a stored
adjacency list would be — several `GROUP BY`s over one user's rows instead of
one indexed read. At single-user data volumes this is immaterial, and it stays
$0 in provider cost because no LLM call is involved.

**Benefit:**
- Nothing can go stale. A stored graph would need invalidating on every quiz
  submission, every generated deck, every grade — an entire class of
  cache-coherence bug that simply doesn't exist here.
- No migration, no new table, no new storage budget.
- The map is inherently auditable: every node and edge traces to rows a
  student can click through to, satisfying ADR-0010 by construction rather
  than by convention.

**Consequence for `subspace_links`:** it is no longer an input to the Gap Map.
It keeps its original and only job — explicit, opt-in retrieval widening in
`rag.retrieve_with_links` — and remains a `declared` relationship under
ADR-0010. The map renders evidenced confusion edges only.

**Honest limitation, unchanged from ADR-0002:** tags match by exact
normalized string, so "Bayes' rule" and "Bayes' theorem" are separate nodes.
Visible in the map rather than hidden, which is the right failure mode.

## Consequences

- `SOUL.md §8.3`/§11, `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_PLAN.md`, and
  `IMPLEMENTATION_PLAN.md` Phase 4 were corrected to this specification.
- Phase 4 now depends on Phase 2 for a stronger reason than before: confusion
  pairs aren't just edge *weights*, they're the only edge *source*. With no
  confusion data the map renders nodes and no edges — a valid, honest state
  that must be handled, not a bug.
- Node size draws on flashcard tags, making `IMPLEMENTATION_PLAN.md` task 1.1
  (extend `subtopic` to flashcards) a real prerequisite rather than a
  nice-to-have.

## Future migration path

If read-time aggregation ever becomes measurably slow — measured, not
assumed — the first step is a materialized view refreshed on quiz submission,
**not** a graph store. That keeps the relational database authoritative and
the projection derived, which is the property this ADR is protecting.
