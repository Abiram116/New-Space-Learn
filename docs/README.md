# Space Learn — documentation

> ## Architecture v1 — **FROZEN** (2026-08-09)
>
> The architecture has been audited end to end, checked for internal
> consistency, and frozen. **The next phase is implementation, not design.**
>
> What frozen means in practice:
> - The decisions in [adr/](adr/README.md) are settled. Don't re-litigate one
>   without new evidence that it's *wrong* — not merely that something else
>   would also work.
> - [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) is the single authority on
>   what to build next and in what order. `CHECKPOINT.md` and
>   `design-plan.md §5` defer to it.
> - Two rejections stay rejected: an auto-organized knowledge graph
>   ([ADR-0001](adr/0001-subject-subspace-hierarchy.md)) and a
>   `concepts`/`concept_edges` schema or any stored graph structure
>   ([ADR-0002](adr/0002-reject-concept-graph-schema.md),
>   [ADR-0011](adr/0011-gap-map-derived-concept-visualization.md)).
> - The relational database is the single source of truth. Anything
>   graph-shaped is a projection derived at render time.
> - New *product* ideas belong in [backlog.md](backlog.md). New *architectural*
>   changes need a new ADR that explicitly supersedes the one it replaces.
>
> Unfreezing is allowed — it just has to be deliberate and recorded, not
> incidental.

Start here if you're new to this codebase. Each doc below answers one kind of
question — read the one that matches what you're trying to do, not all of
them front to back.

## Product & direction

| Doc | Read this when you want to know... |
|---|---|
| [vision.md](vision.md) | What this product is trying to *be* — a companion with memory and initiative, not a tool. Read this first; it's the lens every other doc and every future feature gets judged through. |
| [SOUL.md](SOUL.md) | The deeper thesis — "a syllabus is a list, an exam is a graph" — and the approved architecture for acting on it (normalized tags, not a concept graph). Read with `vision.md`. |
| [v2-review.md](v2-review.md) | An external product review and the point-by-point response, including two independent rejections of a knowledge-graph rearchitecture. Read before scoping anything graph- or personalization-shaped. |
| [backlog.md](backlog.md) | Open, not-yet-scheduled product ideas, plus the engineering-health findings from the 2026-08-09 audit. |

## Building it

| Doc | Read this when you want to know... |
|---|---|
| [setup.md](setup.md) | How to run this locally, wire up Supabase, and deploy to Render + Vercel. |
| [architecture.md](architecture.md) | **How** the pieces fit together: repo shape, the Subjects → Subspaces data model, the design system, the error contract. The practical onboarding doc. |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | The phased build order for approved work — what to do next, in what sequence, with dependencies and risks. **Start here to pick up work.** |
| [plan-frontend.md](plan-frontend.md) / [plan-backend.md](plan-backend.md) | The scoped epic list, frontend and backend halves cross-referenced by number. §1–§11 shipped; §14–§16 open; §17–§19 are the approved SOUL.md redesign. |
| [design-plan.md](design-plan.md) | How every surface should look and move, page by page, plus the Higgsfield asset briefs and their sequencing. |
| [retrospective.md](retrospective.md) | What went wrong before, the pattern behind each mistake, and the standing checklist every feature is held to. |

## Architecture reference (the "why", from the 2026-08-09 audit)

| Doc | Read this when you want to know... |
|---|---|
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | **Why** each subsystem exists, component and sequence diagrams, service boundaries, trade-offs, and what breaks first under scale. |
| [AI_ENGINE.md](AI_ENGINE.md) | Every stage of the AI pipeline — purpose, inputs, latency, cost, alternatives rejected — including which conventional stages are deliberately *not* built. |
| [MEMORY_ENGINE.md](MEMORY_ENGINE.md) | The five memory layers (conversation, session, learning, project, review), each one's lifecycle, storage, and expiry rules. |
| [KNOWLEDGE_MODEL.md](KNOWLEDGE_MODEL.md) | The normalized-tag knowledge model, evidence/provenance per artifact, confusion relationships, and the single-source-of-truth table for every number the app may show. |
| [REQUEST_PIPELINE.md](REQUEST_PIPELINE.md) | End-to-end request lifecycles per feature: notes, flashcards, quizzes, review, caching, optimistic UI, error surfacing. |
| [PERFORMANCE.md](PERFORMANCE.md) | Explicit latency budgets, per-layer mechanisms, cold starts, and one unresolved measurement discrepancy worth fixing. |
| [COST_MODEL.md](COST_MODEL.md) | Real per-operation cost estimates, monthly projections, and why all three flagship features cost $0 per use. |
| [SECURITY.md](SECURITY.md) | Auth, the guards-over-RLS authorization model, prompt injection, upload validation, rate limiting, and the ranked list of open gaps. |
| [adr/](adr/README.md) | Architecture Decision Records — the immutable record of *why* each major choice was made, including the ones that were rejected. |

## The one-paragraph version

Space Learn is a study app built around one idea: a student uploads their own
material into a **Subject → Subspace** (e.g. "Reinforcement Learning" →
"Markov decision processes"), asks it questions, and every answer can become
something to study from later — a flashcard, a note, a quiz — each still
pointing back at the page it came from. The frontend is React on Vercel, the
backend is FastAPI on Render (free tier, so it's built to a strict memory and
CPU budget), and Postgres+pgvector on Supabase is the single source of truth.
Nothing shown in the app is invented — every number, chart, and streak is
computed from something actually stored.
