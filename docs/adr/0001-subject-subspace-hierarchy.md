# ADR-0001 — Keep Subject → Subspace instead of an auto-organized knowledge graph

- **Status:** Accepted
- **Date:** 2026-08-05
- **Supersedes:** nothing
- **Related:** [ADR-0002](0002-reject-concept-graph-schema.md)

## Context

An external review (ChatGPT, walked through the docs and live screenshots)
recommended replacing the Subject → Subspace hierarchy with "Workspaces"
containing an AI-auto-extracted knowledge graph of concepts, with no manual
organization and automatic cross-linking throughout. The review's underlying
diagnosis — that the AI felt like a tool answering questions rather than a
mentor tracking a journey — was accurate and matched `vision.md`.

## Problem

Two real user-facing problems were named: there was no concept-to-concept
linking, and creating a subspace was friction when a student only knew the
subject name, not the topics inside it. The question was whether solving them
required replacing the data model.

## Decision

**Keep Subject → Subspace.** Add a lightweight cross-referencing layer on top
("Linked Subspaces") rather than replacing the hierarchy.

## Alternatives considered

1. **Full rearchitecture to Workspaces + auto-extracted concept graph** (the
   review's proposal). Rejected — see trade-offs.
2. **Keep the hierarchy, add nothing.** Rejected: the two named problems are
   real and worth solving.
3. **Keep the hierarchy, add explicit opt-in links + AI-suggested subspace
   naming.** Chosen.

## Trade-offs

**What rejecting the rearchitecture cost us:** no automatic organization —
students still create their own topics. No implicit cross-linking; a
connection exists only if someone made it.

**What it bought:**
- Every table is scoped to `subspace_id`, with RLS policies and ownership
  guards built on that assumption throughout `guards.py` and every router.
  Replacing it is not a UI change — it's rewriting the data model, every
  policy, and every screen simultaneously, with real risk of ending up with a
  half-finished graph database and a broken working product.
- Reliable concept extraction and **entity resolution** from arbitrary PDFs
  is research-grade work, not a feature toggle. (Is "Bellman Equation" in one
  document the same concept as "bellman eq." in another?)
- Graph navigation is a power-user affordance; folders win on predictability
  for the average student, who is this product's user.
- The named problems didn't actually require it — a false binary.

**Notable:** the external reviewer, shown this reasoning, revised its own
position and converged on the lightweight version, independently calling full
extraction + resolution "months of work." Two of the four original objections
were dropped as the proposal changed (graph-as-navigation was never the
intent; concurrent-load scale isn't a live concern with one user). The
decision held on the remaining two.

## Consequences

- `subspace_links` (a small join table), AI-suggested subspace naming on
  first upload, and concept tags on citations were built instead —
  `IMPLEMENTATION_PLAN.md`.
- Cross-subject insight is reachable through tag matching rather than a
  resolved entity graph (see ADR-0002).
- Anyone proposing this rearchitecture again needs to engage with
  `0002-reject-concept-graph-schema.md` rather than restating the original case.

## Future migration path

If Linked Subspaces proves insufficient — evidenced by real usage, not
intuition — the escalation order is: (1) a curated synonym list for tag
matching, (2) LLM-*proposed* links the student confirms, never auto-committed,
(3) only then reconsider a resolved concept entity. Each step is
independently shippable and reversible.
