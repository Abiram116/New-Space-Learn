# Backlog — open product ideas

Organized by what each item actually is, not by priority — nothing here is
scheduled yet. When one of these gets picked up, scope it properly first
(see the earlier Epic-style breakdown pattern used for the redesign) rather
than building straight from these notes. See [retrospective.md](retrospective.md)
for the standing checklist every scoped item should pass before it's called
done.

**A prioritized, scoped version of this list exists now:** see
[plan-frontend.md](plan-frontend.md) and [plan-backend.md](plan-backend.md),
written after the review in [v2-review.md](v2-review.md). The "Cross-context
knowledge" and "Personalization" items below were superseded by that
review's more concrete "Linked Subspaces" and "Student Model" epics — kept
here for history, but scope new work from the plan docs, not from this raw
list.

## Engineering health — audit findings (2026-08-09)

Not product features — real technical debt found during a full-codebase
audit. Ranked by actual risk, not by how they were discovered.

- **Real embeddings are still stubbed everywhere.**
  `USE_STUB_EMBEDDINGS=true` is set in the local `.env`, in `.env.example`,
  *and* in the `render.yaml` deploy manifest, so RAG retrieval runs cosine
  similarity over deterministic hash-based pseudo-vectors
  (`embeddings.py`'s `_stub_embedding`), not real semantic meaning.
  Citations still point at a real `document · page`, but the "top-k relevant
  chunks" for any question are close to arbitrary. This is a bigger gap than
  any pending epic — the product's central claim (answers grounded in *your*
  material) isn't actually true in any environment yet.
  Fix: wire a real embedding provider (`embeddings.py`
  already isolates every caller behind `embed_texts()`, so this is a
  one-function swap, not a refactor) — most likely OpenAI's
  `text-embedding-3-small` proxied through the existing Groq-key pattern,
  per the `TODO` already in that file. Priced in `COST_MODEL.md`.
- ~~**Zero automated tests exist anywhere in the repo**~~ — **addressed in
  Phase 0** (2026-08-09). `api/tests/` now holds 34 passing tests covering
  the two highest-risk surfaces: `guards.py` ownership assertions (plus a
  coverage test that fails if a *future* endpoint forgets its guard, which is
  the failure mode that actually shipped once) and SM-2 grading, including a
  parity test that executes the real `web/src/lib/schedule.ts` over 480 cases
  to prove the deliberate Python/TypeScript duplication still agrees.
  **Still uncovered and worth doing next:** the RAG prompt builder, document
  chunking, and anything in the frontend (no test runner is configured for
  `web/` at all).

- **`subspaces.py` duplicates `guards.py` and disagrees with it** (found
  2026-08-09). It defines its own `_get_owned_subspace` and
  `_assert_space_owned` rather than using the shared helpers. Functionally
  safe — both check ownership — but `_assert_space_owned` raises
  `Forbidden` (403) where `guards.assert_space` raises `NotFound` (404).
  `guards.py` documents 404 as deliberate: a 403 confirms the row exists and
  belongs to *somebody*, which is an enumeration oracle. Two call sites, two
  behaviours, one of them contradicting a documented security decision. Fix
  is to delete the local copies and call the shared guards.
- **Three frontend files bundle multiple components each**, verified by
  grepping component boundaries directly: `FlashcardsView.tsx` (1046 lines —
  `DeckTile`, `DeckDetail`, `CardEditor`, `Review`, `CardFace`, `Summary`,
  two modals, plus the view itself), `NotesView.tsx` (847 lines, embeds a
  500-line `NoteEditor`), `Settings.tsx` (663 lines, embeds six generic
  `Row*` primitives — `RowShell`, `RowWithToggle`, `RowWithNumber`,
  `RowWithTime`, `RowWithText`, `RowWithSelect` — that aren't
  settings-specific and belong in `components/ui/`). Not bugs, but exactly
  the files `plan-frontend.md` §17/§18 (confusion-pair card, exam countdown)
  are about to add more surface to. Split before adding, not after.
- **`api/app/routers/me.py` (679 lines, already the largest backend file)**
  is about to gain the confusion-pairs and Gap Map endpoints
  (`plan-backend.md` §11/§13). Split into `me_brief.py` / `me_stats.py` /
  `me_student_model.py` before it crosses ~1000 lines, not after — the
  pattern every other domain already follows (one router file per concern).

## Layout / space usage

The quiz-taking screen, quiz results, the quiz list (also reported as not
scrolling — likely a missing `min-h-0` on a flex ancestor, the same bug
class fixed repeatedly elsewhere in this app), flashcard review, and the
Notes editor all center their content in a narrow column and leave the rest
of a wide screen empty. The flashcard grade buttons ("easy/hard doesn't feel
good") need a real interaction/visual redesign, not a spacing tweak.

## LLM grounding

Quiz and flashcard generation currently take a bare topic string with no
framing of what subject/subspace it lives inside — this is why typing
"transformers" produced movie trivia instead of attention-mechanism
questions. Needs the subject + subspace name injected into every generation
prompt, plus explicit model instructions for "nothing indexed yet" instead
of letting the model free-associate on an ambiguous word.

## Settings

No real change-password or delete-account action yet. Both are actually
straightforward: Supabase's client SDK handles password change directly
with the current session, and account deletion is one Admin API call
(cascade deletes already exist via `on delete cascade user_id →
auth.users` on every table). Presentation is currently a flat list of rows
and reads as an afterthought rather than a real settings surface.

## Composer / multimodal input

Pasting a large block of text dumps it raw into the chat textarea instead
of collapsing into an attachment chip (the way claude.ai handles it).
Pasting an image does nothing. Document upload only accepts
PDF/markdown/text today — no CSV, no images (PNG/JPG/SVG). The context
dock's small upload box in the chat sidebar is currently a dead link to the
Docs page instead of supporting its own drag-and-drop.

## Notes — rich editing + inline AI

Currently a plain textarea rendering raw markdown. The ask: real formatting
controls (bold/italic/underline/H1-H3/bullets), a single unified note
stream instead of visually separate "AI-written" vs "user-written"
sections, and a `/ai <prompt>` command typed directly into a note that
writes formatted content in place with a clear (not gimmicky) reveal. This
is the single largest item on this list — effectively building a small
editor, not a UI pass. Open question raised but not settled: whether to
hand-roll a lightweight `contentEditable`-based editor (smaller, fully
matches the app's bespoke visual system, more code to maintain) or adopt an
editor library like Tiptap (less custom logic, needs restyling work, adds a
real dependency). Confirm this before starting.

## Cross-context knowledge

Wanting to reference a specific existing note (and, less clearly specified,
a flashcard or quiz question) as context in a chat turn — something like
typing `/notes-<name>` with autocomplete. There's also a bigger, fuzzier
idea underneath: letting one topic borrow knowledge from another topic —
same subject, or a different subject entirely — while defaulting to
staying separate unless explicitly connected. The flashcard/quiz version of
this was explicitly flagged as unresolved by whoever raised it — that's an
honest open design question, not a small gap to fill in passing. A sensible
v1 boundary, not yet confirmed: same-subspace note-referencing only, with
cross-topic/cross-subject sharing designed as its own later feature once
the interaction pattern is proven.

## Context-aware agents

The Notes/Cards/Quiz agents launched from chat's right-hand dock currently
seed generation from either the last assistant reply or a bare topic
string — not the full conversation, not what's actually indexed in the
topic. Wanted: pass real session context (recent chat history + retrieved
document chunks) into every agent call. Also raised: agents should detect
the *actual subtopics* present in a student's material (e.g. "attention" vs
"cross-attention" inside a broader "transformers" topic) rather than asking
a blind "how many cards do you want" form — and potentially fall back to
live web knowledge when the indexed material doesn't cover a question (this
last piece needs a search tool wired into the backend and should be scoped
as its own separate task, not bundled with the context-passing fix).

## Personalization

Wanting the AI to adapt to how an individual student likes to be taught.
Two tiers: an explicit setting (a free-text "explain things like this to
me" field that gets injected into every prompt) and, longer-term, an
inferred sense of a student's study patterns built from how they actually
use the app over time. The second tier is a real analytics/summarization
feature on its own — needs a job that periodically reads chat/note history
and updates a stored preference profile — and shouldn't be started until
the explicit-field version proves the prompt-injection actually changes
output quality in a way students notice.

## Home brief as a recommendation engine

`GET /me/brief` currently returns one headline + body re-entry line.
Extending it to identify a weak area (lowest quiz average, an overdue deck)
and surface a concrete suggested action — retake this quiz, review this
deck, generate a fresh set — turns Home from a status readout into an
actual recommendation. Additive to the existing endpoint; no architecture
change needed. **This is the most direct next step toward
[vision.md](vision.md)** — the brief is already the one place in the app
that behaves like a mentor instead of a form; this extends that pattern
rather than starting a new one.
