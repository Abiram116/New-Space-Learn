# Plan — Backend

**Status: §1–§9 are built and shipped** (2026-08-05), plus the cross-cutting
Responsiveness work below. **§11–§14 (2026-08-09) are the backend half of the
architecture redesign in [SOUL.md](SOUL.md) — not started.**

**Numbering:** §1–§10 share numbers with [plan-frontend.md](plan-frontend.md)
(same number, same feature, backend half). The redesign epics **do not** —
they were appended to each document's own sequence, so backend §11–§14 map to
frontend §17–§19. Every one of them names its counterpart explicitly, so
follow the cross-reference rather than the number:

| Feature | Backend | Frontend |
|---|---|---|
| Confusion pairs | §11 | §17 |
| Exam-aware scheduling | §12 | §18 |
| Gap Map | §13 | §19 |
| Cross-subject transfer | §14 | *(postponed — no frontend epic scoped yet)* |

Context for why this list looks the way it does: [v2-review.md](v2-review.md)
and, for §11–§14, `SOUL.md` §6–§8. Order of work is decided in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), not here.

Migrations added by this work, all applied:
`20260805110000_student_model.sql`, `20260805120000_linked_subspaces.sql`,
`20260805130000_skill_behavior.sql`.

Every item below is additive to the existing schema/routers unless stated
otherwise — no item here requires the knowledge-graph rearchitecture
rejected in `v2-review.md`.

## Cross-cutting — Voice & Identity

The actual enforcement point for `plan-frontend.md`'s Voice & Identity
note: the system-prompt fragments built server-side for the brief
(`api/app/routers/me.py`), chat, and agent generation calls should share
one small prompt fragment defining tone/voice, rather than each endpoint
improvising its own framing. Concretely, factor a `COMPANION_VOICE` prompt
fragment into a shared location (e.g. `api/app/services/llm.py` or a new
small `voice.py`) and include it in every user-facing generation call, so
the "sounds like the same mentor everywhere" property is structural, not
dependent on remembering to copy-paste tone instructions into each new
endpoint later.

## Cross-cutting — Responsiveness (done, with measurements)

Applied 2026-08-05 after a "pages take ~2 seconds to load" report. The cause
was not the frontend: `GET /me/stats` made **eight sequential PostgREST
round trips** (settings, activity, cards-due, quiz average, docs, subjects,
mastered-count, perfect-quiz), and Home blocks on it. Every one was
independent, so they now run under a single `asyncio.gather`.

Measured with a 150 ms simulated round trip, counting round-trip *depth*:

| Path | Before | After |
|---|---|---|
| `GET /me/stats` | 8 deep (~1200 ms) | 1 deep (~150 ms) |
| `student_model.get()` | 3 deep | 1 deep |
| `_brief_facts()` | 3 deep | 1 deep |
| `_compute_suggestion()` | up to 4 deep | 2 deep |

`student_model.get()` mattered most in aggregate: it runs before *every*
chat turn and *every* generation call, so three stacked round trips sat on
the critical path of each one.

Frontend side: Home refetched `/me/stats` on every mount, so navigating
away and back re-paid the cost and re-flashed skeletons. It now goes
through a shared TTL cache (`web/src/lib/sessionCache.ts`, 60 s for stats,
30 min for the brief) with request de-duplication, cleared explicitly on
card grading and quiz submission so counts never read stale. Route-level
code splitting cut the first-load bundle from 451 KB to 245 KB gzipped by
moving Tiptap, Landing, Flashcards, and Quizzes out of the main chunk.

**The standing rule this leaves behind:** independent awaits in one handler
are a latency bug, not a style preference. Reach for `asyncio.gather`
whenever two reads don't depend on each other — especially in anything on
the path to a first paint or an LLM call.

## Cross-cutting — Responsiveness (original guidance)

Not a feature, a standing bar every endpoint above should be held to: the
app should feel instant, not clunky. Concretely, as each epic above touches
a router:
- Prefer one PostgREST call with embedded-resource `select` (e.g.
  `select=score,quizzes(subspace_id,topic)`) over the manual
  fetch-then-map-in-Python join pattern used in `spaces.py`'s
  `_bulk_counts` — fewer round trips, same result. `_compute_suggestion`
  (§1, just added) already does this for the quiz-average lookup.
- Any new LLM-backed endpoint follows `/me/brief`'s existing shape: use
  `groq_model_fast` for short/structured output, never the large model for
  something under ~100 tokens of output, and always have a deterministic
  fallback so a slow/failed model call never blocks the page.
- Watch for N+1 patterns creeping into new code the way `_bulk_counts` has
  one (decks fetched, then flashcards fetched and mapped by hand) — fine at
  today's single-user data volume, but worth a single-call PostgREST embed
  instead when touching that code anyway.
- No new polling loops — the app already leans on cache-once-per-session
  (`briefCache.ts`) rather than refetching on every navigation; new features
  should follow that pattern, not add a timer.

## P0 — highest priority

### 1. Home brief as a recommendation engine
`GET /me/brief` (`api/app/routers/me.py`) currently returns
headline/body/generated. Add a `suggestion` object: identify the weakest
signal available (lowest quiz average, an overdue deck, oldest untouched
subspace) and return a short label + the route to act on it. Same
guardrails as today: `_mentions_quantity()` and `_desentence_case()` still
apply, and the suggestion must be derived from a real query, never
generated free-text from the model.
**Frontend consumer:** `plan-frontend.md` §1.

### 2. Context-aware agents
Runs on `groq_model` (the 70B tier), the same as existing quiz/flashcard
generation and chat — not `groq_model_fast`. Reasoning over real chat
history and retrieved chunks is a genuinely different job from the brief's
template-filling-over-precomputed-facts task; don't default this to the
fast tier for cost reasons without checking output quality first.

Agent endpoints (flashcard/quiz/note generation launched from chat)
currently take a topic string. Change them to accept a `subspace_id` and
pull real context server-side — recent chat turns + top retrieved document
chunks — building the generation prompt from that instead of trusting the
frontend to have summarized it correctly. This also lets the frontend show
"here's what I already know" before asking anything (`plan-frontend.md`
§2). The "fall back to live web knowledge when indexed material doesn't
cover a question" idea from the original backlog stays a separate,
later task — it needs a search tool wired in and shouldn't block this.
**Frontend consumer:** `plan-frontend.md` §2.

### 3. Student Model
Add a `student_model jsonb` column to the user profile table holding the
explicit, student-set fields (learning style preference, session length,
current exam/deadline context, free-text "explain it like this"). Add a
`GET /me/student-model` endpoint that merges those stored fields with
computed-on-read values from existing tables — weak/strong areas from real
quiz-attempt averages grouped by topic, current streak/pace from the
existing activity table — the same no-invented-numbers discipline as
`/me/brief`. Inject the merged result into the system prompt for chat, all
generation agents, and the brief. This reuses `/me/brief`'s existing
data-grounding pattern rather than inventing a new one — see
`v2-review.md` for why that consistency matters. A later behavioral-
inference tier (a periodic job reading chat/note history to update learning
style automatically) stays a distinct, later phase — don't start it until
the explicit-fields version proves the prompt injection changes output
quality in a way students notice.
**Frontend consumer:** `plan-frontend.md` §3.

## P1

### 4. Linked Subspaces
- New small join table: `subspace_links(subspace_id, linked_subspace_id,
  user_id)`, RLS-scoped like every other table, ownership asserted via
  `guards.py` the same way as elsewhere. No graph engine, no new
  infrastructure.
- New endpoint: `POST /documents/suggest-subspace` — one fast-model call
  over the first page/chunk of an uploaded document, returns a suggested
  subspace name string. Used only when the frontend has no subspace
  selected yet at upload time.
- Chat/agent context building (`rag.build_prompt()`) optionally pulls
  additional chunks from linked subspaces when a link exists — always
  explicit (the user created the link), never inferred silently.
**Frontend consumer:** `plan-frontend.md` §4.

### 5. Skills as a behavior package
Schema change on `skills`: split the single `instructions` text column
into `reasoning_style`, `memory_scope`, `output_format`, `allowed_tools`
(or a single structured `jsonb behavior` column if the fields end up
tightly coupled — decide at implementation time based on how much they're
queried independently). Existing rows migrate by putting current
`instructions` content into `reasoning_style` and leaving the rest at
sensible defaults — no data loss, no forced re-authoring of existing
skills.
**Frontend consumer:** `plan-frontend.md` §5.

### 6. LLM grounding fix — quiz/flashcard generation
`POST /subspaces/{id}/cards/generate` and the quiz-generation equivalent
need the subject + subspace name injected into the generation prompt
explicitly, plus a hard branch: if RAG retrieval returns zero chunks for
the topic, return a typed "nothing indexed on this topic yet" response
instead of letting the model free-associate on a bare string. This is the
direct fix for the "transformers" → movie-trivia bug already on record.
**Frontend consumer:** `plan-frontend.md` §6.

## P2

### 7. Delete-account endpoint
One endpoint calling Supabase's Admin API to delete the auth user; existing
`on delete cascade user_id → auth.users` foreign keys already handle
cleanup across every table, confirmed already in place. Needs rate-limiting
or a confirmation-token step given it's irreversible and unlike other
endpoints, has no undo.
**Frontend consumer:** `plan-frontend.md` §8.

### 8. Multimodal document upload
Extend the document pipeline to accept CSV (straightforward — parse to
text, chunk as normal) and images (PNG/JPG/SVG — needs the vision-tier
model, `GROQ_MODEL_VISION`, already configured but not yet wired into the
ingestion path, only into ad-hoc chat vision calls). Scope CSV first, image
ingestion second — different complexity.
**Frontend consumer:** `plan-frontend.md` §9.

### 9. Note-referencing in chat
`/notes-<name>` autocomplete in the chat composer needs a lightweight
lookup endpoint (`GET /subspaces/{id}/notes?search=`) and the chat prompt
builder accepting an explicit list of note IDs to include verbatim as
context, separate from the RAG-retrieved document chunks. v1 boundary:
same-subspace only, per the original backlog note — cross-subspace
note-referencing is subsumed by Linked Subspaces (§4) once that exists.
**Frontend consumer:** `plan-frontend.md` §10.

### 9b. Note storage shape — **resolved, this item is stale**
Decided in favor of the smaller change: `notes.body_md` stayed a plain
markdown string; the Tiptap editor (§10) renders it via `tiptap-markdown`
rather than switching storage to structured JSON. `generate_note` and the
`/ai`-inline endpoint (`notes.py::note_ai_inline`) both still write/return
plain markdown. One real risk this decision introduced, already mitigated
in code: Tiptap is configured `html: false`, so any stray HTML tag a model
emits would otherwise render as literal visible text in a student's note
(the exact bug `plan-frontend.md` §10 logged from a live screenshot).
`notes.py::_demote_html` converts common HTML block/inline tags to their
markdown equivalent as a defensive second layer, on top of instructing the
model not to emit HTML in the first place — belt and braces, per its own
comment. No further action needed here; don't re-open this decision.
**Frontend consumer:** `plan-frontend.md` §10.

## P3 — flagged, needs care before building

### 10. Quiz question subtopic tagging — **already shipped, this item is stale**
`QuizQuestion.subtopic` exists and is populated at generation time
(`routers/quizzes.py`'s prompt asks for it explicitly), and the frontend
already renders it (`QuizzesView.tsx`). What's still open is the *aggregation*
on top of it — weak-topic identification (`plan-frontend.md` §13) and the
confusion-pair work below (§11) — not the column itself. Don't re-scope this
as new work.

## New — the SOUL.md architecture redesign (2026-08-09)

`SOUL.md` proposed a `concepts`/`concept_edges` graph schema. Rejected — see
`SOUL.md` §6 and §9 for why (two of its four "free" edge-derivation claims
don't hold against this schema, and nothing below actually needs a graph).
These three epics are the redesigned, cheaper implementation of the same
product value. Same priority tier as the item they replace conceptually
(P3's weak-topic work) plus one genuinely independent win (exam-aware
scheduling), so sequenced as their own tier rather than folded into P0–P2
above, which are all already shipped.

### 11. Confusion pairs (`SOUL.md` §8.1)
Two parts, both additive:
- **Generation-time:** change the quiz-generation prompt/schema so each
  `choices` entry carries its own short concept label, not just the question's
  `subtopic` — e.g. `choices: [{"text": str, "concept": str}]` instead of
  `list[str]`. One extra field per choice, same LLM call, no new request.
  Extend the same `subtopic` pattern to flashcard generation while touching
  this code (flashcards currently have no topic tag at all).
- **Read-time:** a new endpoint (e.g. `GET /me/confusion-pairs`) that joins
  `quiz_results.answers` against `quizzes.questions` (both `jsonb`, unnested
  in the query), buckets wrong answers by `(correct_concept, chosen_concept)`
  normalized (trim + lowercase for grouping, original casing for display),
  and returns pairs with count ≥ 3. Pure SQL/PostgREST, no LLM call, no new
  table. Consumed by `plan-frontend.md` §17 (quiz results) and folded into the
  existing `/me/brief` suggestion (§1) as a candidate signal alongside lowest
  quiz average and overdue decks.
**Frontend consumer:** `plan-frontend.md` §17.

### 12. Exam-aware scheduling (`SOUL.md` §8.2)
Fully independent of §11 — never depended on concepts or edges. Add an
`exam_date date` column to `subjects` (nullable — most subjects won't have
one). In `grade_card()` (`routers/flashcards.py`), when a computed `due_at`
would land after the subspace's subject's `exam_date`, compress the interval
to fit the remaining runway instead of scheduling past it, and surface which
cards got compressed so the "honest cram" framing holds — no silently
dropped reviews. No new table; one column, one branch in existing logic.
**Frontend consumer:** `plan-frontend.md` §18.

### 13. Gap Map data endpoint (`SOUL.md` §8.3)
Concept-level and **derived at render time** — see
[ADR-0011](adr/0011-gap-map-derived-concept-visualization.md). A new endpoint
(e.g. `GET /me/gap-map?subject_id=`) returning, scoped to one subject:
- **nodes** — one per normalized concept tag (`trim` + `lowercase` for
  grouping, original casing for display), with `size` = count of quiz
  questions + flashcards carrying that tag, and `strength` = quiz average
  grouped by that tag (same computation as `TopicSignal`, finer grain)
- **edges** — confusion pairs between two tags with their tally, reusing §11's
  aggregation rather than reimplementing it
- **a flag per node** for tags that also appear in another subject, which is
  what §14 later reads

All of it is `GROUP BY` over `quizzes`, `quiz_results`, and `flashcards`. **No
new table, no materialized view, no adjacency storage, no recursive query** —
the relational tables stay authoritative and the projection is discarded after
the response. **Hard dependency on §11:** confusion pairs are the *only* edge
source, not merely a weight, so with no confusion data this endpoint returns
nodes and an empty edge list — a valid state the frontend must render, not an
error.
**Frontend consumer:** `plan-frontend.md` §19.

### 14. Cross-subject transfer (`SOUL.md` §8.4) — postponed
String-match on normalized `subtopic`/concept labels across subjects, same
mechanism as §11's grouping. Deliberately not scoped further yet — needs §11
shipped and generating real repeated-tag data first, otherwise there's
nothing to match against.

## Explicitly out of scope

Auto-extracted knowledge graph (concept/entity extraction, relationship
inference, a graph store) — rejected twice now: once in `v2-review.md` for
the external reviewer's "auto-organized Workspace" proposal, and again in
`SOUL.md` §9 for the `concepts`/`concept_edges` schema this document's own
earlier draft proposed. Don't propose it a third time without new evidence
that string-tag matching (§11, §14) has hit a real, observed limit.
