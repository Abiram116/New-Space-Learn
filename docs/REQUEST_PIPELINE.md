# Request Pipeline

Every core user action, traced end to end — frontend trigger through backend
processing through database write back to rendered UI. `SYSTEM_ARCHITECTURE.md
§3` already walks chat and upload in sequence-diagram form; this document
covers the remaining surfaces and doesn't repeat those two. Caching
(`MEMORY_ENGINE.md §2`) and the error envelope (`architecture.md`'s
"Error handling contract") are referenced, not re-explained.

---

## Notes

Three distinct write paths into the same table, on purpose — `notes.py`'s
own docstring calls this out: "supports user-authored and agent-generated
origins."

1. **Direct authoring:** `POST /subspaces/{id}/notes` (create) → student
   types → `PATCH /notes/{id}` on every autosave tick. No LLM involved.
2. **Whole-note generation:** `POST /subspaces/{id}/notes/generate` —
   retrieves real context (`rag.retrieve`, k=6) + recent chat history, fails
   with a typed `NothingIndexed` if both are empty rather than letting the
   model invent a note from nothing, writes a fresh `notes` row with
   `origin: "agent"`.
3. **Inline `/ai <prompt>`:** `POST /subspaces/{id}/notes/ai-inline` —
   returns a markdown *fragment* (`NoteAiInlineOut.content_md`), not a new
   note. The frontend inserts it at the cursor inside the same note the
   student is already editing — origin is never special-cased in storage or
   in the editor, matching `plan-frontend.md §10`'s "one editor, two
   authors" requirement.

**A defensive step worth knowing about if you touch this path:** the model
is instructed to emit plain markdown, never HTML (Tiptap is configured
`html: false`, so a stray `<p>` would otherwise render as literal visible
text in a student's note). `_demote_html()` converts the common tags anyway,
as a second layer — "instructing the model is necessary but not sufficient,"
per its own comment. If you change the inline-AI prompt, keep this function;
it's cheap insurance against a regression that's already happened once.

**Storage shape:** `body_md` stayed a markdown string (see the correction
logged in `plan-backend.md §9b`) — rendered through `tiptap-markdown`, not a
structured `jsonb` document. Every write path above produces markdown.

---

## Flashcards

Two independent lifecycles share one table: **authoring** a deck, and
**reviewing** it.

### Authoring
- `POST /subspaces/{id}/decks` → empty deck shell, immediate UI feedback.
- `POST /subspaces/{id}/cards/generate` → whole-deck generation in one call
  (grounded in `rag.retrieve` + recent chat + Student Model context),
  producing N cards atomically rather than the one-card-per-reply behavior
  `PRODUCT.md` documents as a fixed deficiency.
- `POST /decks/{id}/cards` / `PATCH /cards/{id}` → manual single-card
  authoring, same table, same shape as a generated card.

### Review — the one flow with real optimistic UI
1. `GET /decks/{id}/cards?due_only=true` — fetch what's actually due.
2. Student flips a card (pure client state, no request).
3. Student grades it (`again`/`hard`/`good`/`easy`). **The frontend advances
   to the next card immediately and computes the same SM-2-lite math
   locally**, then fires `PATCH /cards/{id}/grade` in the background.
   `FlashcardsView.tsx`'s own header comment states the trade explicitly:
   "the only cost of optimism is briefly stale interval math," because the
   server runs the identical algorithm and will correct it within one
   round trip if the two ever disagree.
4. **This means the SM-2 algorithm is intentionally duplicated in two
   languages** (Python in `flashcards.py::grade_card`, TypeScript in
   `FlashcardsView.tsx`) — a deliberate DRY exception for the sake of
   optimistic UI, not an oversight. `flashcards.py`'s own docstring flags
   it: "kept in one place because they double as the client-side optimistic
   update. Keep the two in sync." **Anyone implementing exam-aware
   scheduling (`plan-backend.md §12`) must update both copies** — adding
   interval compression only server-side would make every compressed card
   flash the *uncompressed* interval for one round trip before correcting,
   a visible regression of the exact property this comment protects.
5. Server-confirmed grade updates `ease`/`interval_days`/`reps`/`due_at` and
   bumps `daily_activity` — which is what the Home brief and streak reflect
   on next load, via the session cache's explicit invalidation (below).

---

## Quizzes

No optimistic path here — a quiz's questions must be fully valid JSON before
anything renders, so unlike chat, there is nothing meaningful to stream or
optimistically show.

1. `POST /subspaces/{id}/quiz/generate` — same grounding discipline as
   flashcards (real retrieval, real history, typed `NothingIndexed` on empty
   retrieval). Each question is generated with `answer_index`, `source`, and
   `subtopic` in one shot — `subtopic` is the field `plan-backend.md §10`
   already shipped and `§11`'s confusion-pair work will read from.
2. Student answers client-side, no request per answer.
3. `POST /quizzes/{id}/submit` — the **only** point of server contact after
   generation. Scoring happens server-side (`answer_index` comparison,
   never trust a client-computed score), `quiz_results` gets one new,
   immutable row (never an update — see `MEMORY_ENGINE.md §5`'s append-only
   note), `daily_activity` is bumped.
4. Results render from the response (`score`, `correct[]`) — no second
   fetch needed.

---

## Review & scheduling — how one grade becomes tomorrow's brief

This is the loop that makes "the app remembers you" real, traced across the
surfaces above rather than within one of them:

```
grade_card() writes due_at
        ↓
list_decks()'s _bulk_counts computes { due, total, known_pct } per deck
        ↓
/me/stats (and the Home brief) read the same underlying tables fresh —
never a cached "due count" that could drift from the actual due_at values
        ↓
Home surfaces "N cards due" and, once plan-backend.md §1 ships fully,
a specific suggested next action
```

Nothing here is pushed — every layer re-reads the tables it needs on its own
request. The only thing that makes this feel instant rather than
recomputed-every-time is the session cache (`MEMORY_ENGINE.md §2`), and that
cache is explicitly cleared on exactly the two writes that would make it
lie: card grading and quiz submission (`plan-backend.md`'s Responsiveness
note). This is worth stating as a rule for any new write path: **if a new
endpoint changes a number `/me/stats` or the brief surfaces, it must clear
that cache key, or a student will see a stale number for up to the TTL.**

---

## Error handling, as it actually surfaces per flow

The envelope itself (`{ "error": { "code", "message" } }`) is specified once
in `architecture.md` and not repeated here. What's specific to each flow
above:

- **Notes generation / inline AI:** `NothingIndexed` for generation (empty
  retrieval *and* empty history); a malformed model response raises
  `UpstreamUnavailable` with a retry-oriented message rather than surfacing
  a JSON parse error.
- **Flashcard/quiz generation:** identical `NothingIndexed` pattern; a
  quiz's `_safe_parse_questions` silently drops malformed individual
  questions rather than failing the whole batch, so one bad question from
  the model doesn't cost the student all N.
- **Grading:** a 404 (`NotFound`) on an already-deleted card is possible if
  a review session is left open across a deletion elsewhere — the frontend
  treats this the same as any other `ApiError`, no special case.
- **Document processing:** the one flow with a *third* outcome beyond
  success/error — `status: "processing"` with a message pointing at
  `/documents/{id}/reprocess`, used specifically when the 25-second inline
  budget is exceeded. This is not a failure; treating it as one would tell
  a student to re-upload a file that's actually fine and just needs a
  second, cheaper pass.
