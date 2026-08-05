# Backlog — open product ideas

Organized by what each item actually is, not by priority — nothing here is
scheduled yet. When one of these gets picked up, scope it properly first
(see the earlier Epic-style breakdown pattern used for the redesign) rather
than building straight from these notes. See [retrospective.md](retrospective.md)
for the standing checklist every scoped item should pass before it's called
done.

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
