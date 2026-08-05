# Plan — Backend

**Status: all backend epics here are built and shipped** (2026-08-05), plus
the cross-cutting Responsiveness work below. Epics are numbered to match
[plan-frontend.md](plan-frontend.md) — same number, same feature, backend
half. Context for why this list looks the way it does:
[v2-review.md](v2-review.md).

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

### 9b. Note storage shape
`notes.body_md` is currently a plain markdown string, which is exactly why
raw `**`/`__` can leak to the screen when the render path doesn't match
(see the concrete bug logged in `plan-frontend.md` §10). Once the editor
decision in §10 is made, decide whether `body_md` stays markdown (rendered
through a real markdown renderer, never shown raw) or becomes the editor's
own structured format (e.g. Tiptap JSON, stored as `jsonb`) with markdown
generated only for export/citation purposes. Whichever the editor needs —
this is a follow-on decision, not a separate task, and should be settled
alongside §10, not before it. `generate_note` (already built, §2) writes
plain markdown into `body_md` today; if the storage shape changes, that
endpoint's output needs to change with it.
**Frontend consumer:** `plan-frontend.md` §10.

## P3 — flagged, needs care before building

### 10. Quiz question subtopic tagging
Add a `subtopic` text column to the quiz-questions table, populated at
generation time by the same model call that writes the question (cheap —
it already "knows" what the question is about). Only build the
weak-topic-identification frontend feature (`plan-frontend.md` §13) once
this column exists and is actually being populated with real values — 
don't compute weak topics from anything client-side-guessed.

## Explicitly out of scope for this phase

Auto-extracted knowledge graph (concept/entity extraction, relationship
inference, a graph store) — rejected in `v2-review.md` on free-tier
infrastructure grounds, not just product grounds. If Linked Subspaces (§4)
later proves insufficient, that's the point to revisit this, not before.
