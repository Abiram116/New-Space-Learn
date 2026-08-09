# Memory Engine

**The governing rule:** the LLM remembers nothing — every call to Groq is
stateless, and the full context it needs is reconstructed from Postgres on
every single request. Space Learn remembers everything that matters, in a
database row with a clear owner and a clear expiration, never in a model's
context window across requests. This is what makes every claim the app makes
about a student auditable: memory that lives in a table can be inspected,
corrected, and deleted; memory that lives in an LLM's context cannot.

Five layers, ordered from most ephemeral to most durable. Each maps onto
real, already-shipped code — this document names what exists, it doesn't
propose a new subsystem.

---

## 1. Conversation memory

**What it is:** the back-and-forth within one subspace's chat.

| | |
|---|---|
| **Storage** | `chat_messages` table — one row per turn, `role`/`content`/`citations jsonb` |
| **Lifetime** | Indefinite — a chat history is part of a subspace's permanent record, cascade-deleted only if the subspace itself is deleted |
| **Retrieval** | `chat_context.py::recent_history` — last N turns, N determined by the *most permissive* active Skill's `memory_scope` (`session`→8, `topic`→20, `all`→40; see `subspace_chat.py`) |
| **Update rule** | Append-only. The user's turn is inserted **before** the model call starts (so a page refresh mid-stream still shows it); the assistant's turn is inserted after the stream completes |
| **Expiration** | None at the row level. Retrieval is capped, not the data — old turns still exist for the transcript view even once they've scrolled out of prompt context |
| **Why it exists** | This is what lets a Skill with `memory_scope: all` reason over a whole topic's history rather than the last few exchanges, and it's the raw material the confusion-pair and citation-provenance features read from indirectly (via the artifacts a conversation produces, not the conversation text itself) |

**Boundary, stated on purpose:** conversation memory never crosses a
subspace unless a `subspace_links` row exists and `rag.retrieve_with_links`
pulls from it — a chat in "Markov decision processes" cannot see a chat in
"Attention Mechanisms" by default. This is `PRODUCT.md`'s subspace boundary,
not an oversight.

---

## 2. Session memory

**What it is:** short-lived state scoped to one browser tab's visit, never
meant to survive a fresh arrival.

| | |
|---|---|
| **Storage** | Two independent mechanisms, deliberately not unified: (a) frontend `sessionStorage` via `web/src/lib/sessionCache.ts` — a TTL'd, request-deduplicating cache (60s for `/me/stats`, 30min for the brief); (b) backend in-process token buckets in `ratelimit.py`, keyed by `user_id` |
| **Lifetime** | Frontend: until the tab closes or the TTL expires, whichever first. Backend: until 900 seconds of inactivity (`_IDLE_TTL_S`), swept opportunistically every 300s so memory can't grow unbounded on a 512MB instance |
| **Retrieval** | Frontend: `SessionCache.get()` — returns the in-memory value if fresh, else the `sessionStorage` value if fresh, else calls the fetcher and caches the result. In-flight de-duplication means two components mounting simultaneously produce one request, not two |
| **Update rule** | Explicitly invalidated on writes that would make it stale — card grading and quiz submission clear the stats cache rather than waiting out the TTL, so counts never read stale after an action the user just took |
| **Expiration** | By design, not by accident — `sessionStorage` (not `localStorage`) because a new tab is genuinely a new arrival and should refetch, while moving between pages within one visit should not |
| **Why it exists** | Fixed a real, measured bug: navigating Home → Cards → Home used to refetch and re-flash skeletons on every return trip. The backend half exists purely to protect the Groq quota from a stuck retry loop or a hammering tab — see `ratelimit.py`'s own docstring |

**Why this is two mechanisms and not one:** they protect different things
(perceived UI latency vs. an external API budget) and live in different
processes that don't share memory. Unifying them would require a shared
store (Redis, or a Postgres table) for no benefit — the free-tier
"in-process is fine for one worker" reasoning applies to both independently.

---

## 3. Learning memory

**What it is:** the durable, per-student model of understanding — the thing
`SOUL.md §4` calls "the mechanism," implemented exactly as tagged evidence
rows, never as a cached derived value.

| | |
|---|---|
| **Storage** | Distributed, not centralized: `flashcards.ease/interval_days/reps/due_at` (SM-2 scheduling state, one row per card); `user_settings.student_model jsonb` (explicit fields: learning style, session length, exam context, teaching preference); computed-on-read `TopicSignal` (weak/strong areas, grouped from `quiz_results` joined through `quizzes`) |
| **Lifetime** | Indefinite for explicit fields and SM-2 state (they're the point — this is what "the app remembers you" means). Computed signals have no independent lifetime at all — see Update rule |
| **Retrieval** | `student_model.py::get()` — three reads (`user_settings`, quiz-grouped signals, activity days) run concurrently via `asyncio.gather`, because unlike the sequential-is-faster pattern elsewhere, these three don't share a request-response dependency chain worth serializing |
| **Update rule** | **Computed signals are never stored — they're recalculated from raw rows on every single read.** This is the same discipline that keeps `/me/brief` honest (`IMPLEMENTATION_PLAN.md`'s `fullness()` lesson: an invented or cached metric can silently drift from what's actually true; a query can't). Explicit fields update via `set_explicit()`, a targeted `PATCH` merge into the `student_model jsonb` blob |
| **Expiration** | None. This is the one memory layer that should never expire — it's the whole product's value proposition compounding over a semester |
| **Why it exists** | This is what's injected into every chat/agent/brief prompt (`format_for_prompt()`) so the model always has "what you know about this student" without the student re-explaining themselves each session — the literal implementation of `vision.md`'s "a mentor who remembers," built entirely from facts, never from a model's summary of a conversation |

**What's deliberately *not* in this layer:** a summarized/compressed history
of past conversations. The temptation is an LLM-generated "here's what this
student tends to struggle with" summary, refreshed periodically — rejected,
because it reintroduces exactly the unfalsifiable-model-opinion problem
`SOUL.md §6`'s edge doctrine forbids. Every fact in Learning memory traces to
a real row (a grade, a quiz answer, a setting the student typed), never to a
model's inference about the student.

---

## 4. Project memory

**What it is:** the material itself — documents, and everything generated
from them, scoped to the Subject → Subspace hierarchy.

| | |
|---|---|
| **Storage** | `documents` + `document_chunks` (source material and its embeddings), `notes`, `decks`/`flashcards`, `quizzes`, `skills` attached via `subspace_skills`, and `subspace_links` (explicit cross-subspace references) |
| **Lifetime** | Indefinite, and cascades — every one of these tables has `on delete cascade` to its owning subspace/user, confirmed in `20260803120000_init.sql`. Deleting a subspace deletes everything grown from it; deleting a user's account deletes everything they own, in one Admin API call (`IMPLEMENTATION_PLAN.md`'s delete-account note) |
| **Retrieval** | Always subspace-scoped by default (`rag.retrieve`); explicitly widened only via `subspace_links` (`retrieve_with_links`) — a student must have drawn the connection themselves |
| **Update rule** | Documents are write-once-then-reprocessable (a new upload creates a new row; `reprocess` re-derives chunks for an existing one). Notes/cards/quizzes are directly mutable by the student or by an agent call, with no distinction in the editor between the two origins (`IMPLEMENTATION_PLAN.md`'s "one editor, two authors" principle) |
| **Expiration** | None — this is the student's actual work product. The only deletions are explicit (student deletes a document/deck/note) or cascading (parent subspace deleted) |
| **Why it exists** | This is the actual "single source of truth" — every citation, every card, every quiz question traces back to a specific row here, which is what makes the product's central claim (`PRODUCT.md` Principle 3) checkable rather than asserted |

---

## 5. Review memory

**What it is:** the historical record of how a student performed — the raw
evidence Learning memory's signals are computed from, and the layer the
SOUL.md-derived confusion-pair feature reads directly.

| | |
|---|---|
| **Storage** | `quiz_results` — one **immutable, append-only** row per attempt (`answers jsonb`, `score`, `submitted_at`); `daily_activity` — one row per user per day, incrementally bumped (`chat_messages`/`cards_reviewed`/`quizzes_taken`/`study_seconds` counts) |
| **Lifetime** | Indefinite for `quiz_results` — every attempt is kept forever, which is exactly what makes "you've confused these two four times" a real, countable fact rather than an impression. `daily_activity` rows are also kept indefinitely (they're the streak/heatmap's raw material) |
| **Retrieval** | Grouped and aggregated at read time — `student_model.py`'s `_quiz_signals()` for weak/strong areas, `streaks.py::compute_streak` for the activity heatmap, and (once built) `IMPLEMENTATION_PLAN.md`'s confusion-pair aggregation over the same `quiz_results` rows |
| **Update rule** | Append-only for quiz attempts — a resubmitted quiz creates a new `quiz_results` row, it does not overwrite the old one. **Asymmetry worth stating plainly:** flashcard grading is the opposite — `grade_card()` overwrites `ease`/`interval_days`/`reps`/`due_at` *in place* on the same row, with no log of past grades kept. This is intentional, not an oversight: no current or planned feature needs a flashcard's grade *history*, only its current SM-2 state (even the P3 "predicted-retention estimate" backlog item only needs current ease + interval + time-since-last-review, not a trend line) |
| **Expiration** | None for either table |
| **Why it exists** | This is the layer that makes the product's flagship claim possible: "you picked the wrong answer three times" is only a fact because every attempt, right or wrong, was kept — not summarized, not overwritten |

---

## Summary table

| Layer | Storage | Lifetime | Update model | Expires? |
|---|---|---|---|---|
| Conversation | `chat_messages` | Indefinite | Append-only | No (retrieval is capped, not the data) |
| Session | `sessionStorage` cache + in-process rate buckets | One tab visit / 15 min idle | Explicit invalidation on relevant writes | Yes, by design |
| Learning | `flashcards` SM-2 fields, `user_settings.student_model`, computed `TopicSignal` | Indefinite | Computed signals: recalculated every read, never cached. Explicit fields: direct patch | No |
| Project | `documents`, `notes`, `decks`/`flashcards`, `quizzes`, `skills`, `subspace_links` | Indefinite, cascades with owner | Direct mutation (student or agent) | No |
| Review | `quiz_results`, `daily_activity` | Indefinite | Append-only (`quiz_results`); incremental bump (`daily_activity`) | No |

**The one property every durable layer shares:** nothing here is ever
overwritten with a model's summary or a model's guess. A model can *read*
any of these five layers to answer a question or write an artifact; it never
*writes back* a compressed version of them. That boundary is what keeps
Learning memory honest, and it's the same boundary `SOUL.md`'s edge doctrine
states for a different part of the system — one principle, applied twice.
