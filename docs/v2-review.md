# V2 Review — external feedback, and my response to it

An external review (ChatGPT, walked through the docs and live screenshots)
came back strongly positive on visual design and product thinking, and
identified "AI Experience" as the weakest score — the AI feels like a tool
answering questions rather than a mentor tracking a journey. That diagnosis
matches [vision.md](vision.md) and [backlog.md](backlog.md) closely enough
that it's worth treating as validation, not new information.

One recommendation in that review — replacing the Subject → Subspace model
with an AI-auto-organized knowledge graph — I disagree with, and explain why
below. Everything else is folded into [plan-frontend.md](plan-frontend.md)
and [plan-backend.md](plan-backend.md).

## Where the review is right

- **The dashboard shows data; it should start a conversation.** Exactly
  `vision.md`'s thesis, applied to one screen. `/me/brief` already proves
  the pattern (real data, no invented numbers) — it needs to grow into an
  actual recommendation ("review this before moving on"), not stay a single
  headline.
- **Chat reads as a generic assistant even with agents attached.** The
  Notes/Cards/Quiz agents currently seed from the last reply or a bare
  topic, not the session's actual arc. This was already `backlog.md`'s
  "context-aware agents" item — the review just makes the cost of not
  fixing it more concrete.
- **A Skill should be a behavior package, not a prompt string.** Reasoning
  style + memory scope + output format + allowed tools, not one
  `instructions` text field. This is a real, scoped improvement to the
  existing Skills schema — not a rewrite.
- **Two independent reviews (mine in `retrospective.md`, this one)
  converging on "personalization/memory is the biggest opportunity"** is a
  stronger signal than either alone. Elevating it in priority below.

## Where I disagree, and why it matters

The review's core recommendation is: drop Subjects/Subspaces, replace with
"Workspaces" containing an AI-auto-extracted knowledge graph of concepts,
with no manual organization and automatic cross-linking everywhere.

I think this is the wrong move **right now**, for reasons specific to this
project that a conversation without codebase access can't see:

1. **Every table is scoped to `subspace_id`** — documents, chat_messages,
   notes, decks, flashcards, quizzes, skills, all of it, with RLS policies
   and ownership guards built on that assumption throughout
   `api/app/guards.py` and every router. "Replace the architecture" is not
   a UI change; it's rewriting the data model, every policy, and every
   screen at once, with real risk of ending up with a half-finished graph
   database and a broken working product.
2. **Reliable concept/relationship extraction from arbitrary PDFs is a hard
   open problem**, not a toggle. Entity resolution alone (is "Bellman
   Equation" in one document the same concept as "bellman eq." in another?)
   is research-grade work, not a feature to ship alongside everything else
   already in the backlog.
3. **This runs on Render's free tier** — 512MB RAM, no background workers,
   the whole backend built to that budget (see `architecture.md`). A live
   per-user knowledge graph is a serious infra escalation that directly
   conflicts with that documented discipline.
4. **Graph navigation is a power-user feature, not a default.** Tools like
   Obsidian's graph view are beloved by a minority and disorienting for
   most people; folders/hierarchy win on predictability for the average
   user, which is who this product is for.
5. **It's a false binary.** The actual named problems — no concept-to-concept
   linking, friction creating a subspace when you only know the subject
   name — don't require replacing the hierarchy. They require *adding* two
   things on top of it, both already directionally in `backlog.md`:
   auto-suggesting a first subspace name from an uploaded document, and an
   explicit, opt-in cross-link between subspaces. `vision.md` already states
   the right default: *stays separate unless explicitly connected.*

**My recommendation: keep Subject → Subspace.** Add a cross-linking layer
on top of it — I'm calling this **Linked Subspaces** below. It captures
most of the graph idea's real value (concept connections, less manual
organizing) without rewriting a working, RLS-secured, already-well-received
product's foundation.

### Linked Subspaces — the concrete alternative

- **Auto-suggested subspace on first upload.** When a document is uploaded
  to a subject with no subspace picked yet, one cheap fast-model call
  proposes a subspace name from the document's content (e.g. "Attention
  Mechanisms" from a transformers paper) instead of asking the user to
  invent one blind. Directly answers "what if the user only knows the
  subject, not the topics."
- **Explicit "related to" links between subspaces**, same subject or
  across subjects — a small join table, not a graph engine. A subspace can
  declare "this builds on X" and chat/agents can pull grounding from linked
  subspaces when relevant, without ever doing so silently. This is Epic 6
  from the original backlog, scoped precisely instead of left open.
- **Concept tags on chat citations and quiz questions** — a lightweight,
  explicit alternative to auto-extracted graph nodes. When the model cites
  something, it can tag it with a short concept label ("value iteration").
  Repeated tags across a subspace become the "you've asked about Layer
  Normalization three times" signal the review wants, computed from real
  stored tags, not inferred from an entity graph.

This gets the personalization and cross-referencing wins the review is
actually asking for, on infrastructure this project can carry on a free
tier, without discarding a data model that already works and is already
secured.

## Direct answers to the other edge cases raised

- **"What if the user only knows the subject, not the topics?"** — solved
  by auto-suggested subspace naming above, not by removing subspaces.
- **"Where's knowledge sharing across subjects?"** — solved by explicit
  Linked Subspaces, opt-in per `vision.md`'s stated default.
- **"How should each Skill affect generation?"** — solved by the
  Skills-as-behavior-package schema change (reasoning style + memory scope
  + output format, not one prompt string) — see `plan-backend.md`.
- **"Personal customization in how the AI explains things"** — already
  scoped as `backlog.md`'s Personalization epic; this review reinforces
  starting there rather than with the graph rearchitecture.

## What changed as a result of this review

- **Personalization/memory moved to the top priority** in both plan docs —
  two independent reviews naming the same gap is a strong signal.
- **A new, scoped "Linked Subspaces" epic replaces the open-ended
  "cross-context knowledge" backlog item** with something concrete and
  buildable on this stack.
- **Skills gets a schema-level upgrade** (behavior package, not prompt
  string) added to `plan-backend.md`.
- **The knowledge-graph/Workspace rearchitecture is explicitly rejected**
  for this phase — recorded here so it isn't silently re-proposed later
  without this reasoning being re-litigated.

## Round 2 — the review revised itself after seeing this doc

The external review read the disagreement above and updated its own
position rather than restating it — worth recording because it changes a
few things and confirms others.

**A factual correction that came up first:** the claim that "we haven't
added RAG or a vector DB yet" is wrong — `pgvector`, `match_document_chunks`,
and `api/app/services/rag.py` were built in the very first migration
(`20260803120000_init.sql`, 2026-08-03) and every citation in the app
already depends on them. The schema *is* only two days old, which does
lower the switching-cost stakes generally — but replacing RAG specifically
would mean replacing a working, already-integrated system, not filling an
empty gap.

**Two of my four objections to the graph rearchitecture no longer apply,
because the proposal itself changed:**
- The revised version is explicit that the graph/related-concepts data is
  **internal only, never a homepage or a navigation surface** — a student
  sees "this relates to Attention, Embeddings" as a short list, not a graph
  visualization. That resolves the UX-disorientation objection entirely;
  it was written against graph-as-navigation, which was never actually the
  intent.
- "The only user is me, this won't run under concurrent load" removes the
  scale part of the free-tier objection. Render's memory ceiling is still
  real, but "can this survive concurrent traffic" isn't a live concern
  here.

**Two of the four still hold, and notably the review's own revision now
agrees with them:** full entity extraction + resolution + relation
inference + merge/conflict-resolution is, in the review's own words after
reconsidering, "months of work" — regardless of user count, that's a real
engineering cost for a small, uncertain payoff over the cheap version. The
revised recommendation is now "one LLM call generates a short related-
concepts list per subspace, no extraction pipeline, no graph store" — which
*is* what this doc already scoped as Linked Subspaces (`plan-frontend.md`
§4, `plan-backend.md` §4). This isn't two positions holding firm past each
other; it converged.

**Two things changed as a direct result of this round:**
- **Personalization was elevated and enriched into a "Student Model"
  epic** (`plan-frontend.md`/`plan-backend.md` §3) — both reviews
  independently ranked this as the single biggest opportunity, and the
  richer structured version (weak/strong areas, pace, exam context) turned
  out to be mostly data already stored, not new infrastructure, so there
  was no good reason to keep scoping it down to one text field.
- **`vision.md`'s stance on personality was softened.** It previously read
  as "no persona costume, full stop." The real objection was never
  personality itself — it was personality *substituting for* real memory
  and data-grounding. Character/voice layered on top of real substance is
  fine and worth doing; `vision.md` now says so explicitly.

**Where this leaves the architecture decision:** unchanged in substance —
keep Subject → Subspace, add Linked Subspaces as the lightweight
cross-referencing layer — but now because both reviews agree, not because
one pushed back on the other. The Phase 1 (stabilize current model) / Phase
2 (AI layer: auto-subspaces, related subspaces, Student Model, richer
Skills) / Phase 3 (long-term: cross-workspace search, an internal-only
knowledge graph, adaptive planning) framing the review landed on maps
directly onto this doc's P0/P1/P2/P3 split in `plan-frontend.md` and
`plan-backend.md` — restated here as the two-review-converged shape, not
duplicated as a separate roadmap.
