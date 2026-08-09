# Architecture Decision Records

One file per significant, hard-to-reverse decision. Numbered sequentially,
never renumbered, never deleted — a superseded ADR gets its status changed
and a pointer to the one that replaced it, because the *reasoning* stays
useful even after the decision changes.

**What earns an ADR:** a decision that would be expensive to reverse, that a
future contributor might otherwise re-litigate from scratch, or that looks
wrong without its context. Routine choices (a library version, a file
layout) do not.

**Relationship to the other docs:** ADRs are the immutable record of *why a
choice was made at a point in time*. The living documents (`ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `SOUL.md`, and the rest) describe *how the system works
now*. When they disagree, the living docs describe reality and the ADR
explains how reality got that way.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-subject-subspace-hierarchy.md) | Keep Subject → Subspace instead of an auto-organized knowledge graph | Accepted |
| [0002](0002-reject-concept-graph-schema.md) | Reject the `concepts`/`concept_edges` schema; use normalized tags | Accepted |
| [0003](0003-skills-vs-agents.md) | Split persistent Skills from one-shot Agents | Accepted |
| [0004](0004-service-role-key-with-app-guards.md) | Service-role key + application guards, with RLS as defense-in-depth | Accepted |
| [0005](0005-groq-model-tiering.md) | One provider, three model tiers | Accepted |
| [0006](0006-httpx-supabase-wrapper.md) | Hand-rolled httpx Supabase wrapper over the official SDK | Accepted |
| [0007](0007-inline-document-processing.md) | Inline document processing with a resumable budget, no job queue | Accepted |
| [0008](0008-sm2-lite-duplicated-client-side.md) | SM-2-lite, deliberately duplicated client-side for optimistic UI | Accepted |
| [0009](0009-markdown-note-storage.md) | Store notes as markdown, not structured editor JSON | Accepted |
| [0010](0010-evidence-only-relationships.md) | Relationships must be evidenced, never model-inferred | Accepted |
| [0011](0011-gap-map-derived-concept-visualization.md) | The Gap Map is a derived concept-level visualization, not stored structure | Accepted |
| [0012](0012-local-embeddings-bge-small.md) | Local embeddings (BGE-small-en-v1.5, quantized ONNX), not a hosted API | Accepted |
