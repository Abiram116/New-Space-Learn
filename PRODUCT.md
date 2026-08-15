# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students — school through university — studying their own material, mostly alone,
mostly at night, on a laptop. They arrive with a PDF, a lecture deck, or a topic
they're behind on, and a finite amount of willpower. The job is not "search my
notes"; it is *get me from behind to ready*, repeatedly, without the session
feeling like a chore.

Sessions are short and interrupted. A user may return after three days having
forgotten what they were doing. Re-entry is a first-class moment, not an edge case.

## Product Purpose

Space Learn turns a student's own source material into an active study loop:
upload documents into a topic, ask questions and get answers that cite the exact
page, then convert what was just learned into notes, flashcards, and quizzes
without leaving the conversation.

Success is a returning student: streak intact, cards due cleared, quiz average
climbing. The product's real competitor is the student closing the tab.

## Positioning

Chat products answer questions and forget them. Flashcard products make you
author every card by hand. Space Learn's mechanism is the **hand-off**: the same
conversation that explained a concept produces the note, the deck, and the quiz
about it, each traceable back to the page it came from. Retrieval, generation,
and recall live in one place, scoped to a topic the student defined.

## Operating Context

- **Subjects → Subspaces.** A subject ("Reinforcement Learning") holds topics
  ("Markov decision processes"). Everything — docs, chat, notes, cards, quizzes —
  is scoped to a subspace.
- **Per-subspace surfaces:** Chat, Docs, Notes, Quizzes, Cards.
- Documents are PDFs and text, chunked and embedded on upload; answers cite
  `document · locator`.
- Study state is real and persisted: SM-2-lite scheduling on cards, daily
  activity rows driving streak/heatmap/badges, per-user settings.
- Free-tier hosting: single backend worker, no background jobs. Work happens
  inline within a request or not at all.

## Capabilities and Constraints

**Two distinct AI concepts — this distinction is product truth and must be made
legible in the UI, not collapsed:**

- **Skills** are persistent AI *personalities* the student switches on for a
  subspace. They change how every answer in that topic is written (Socratic
  Tutor withholds the answer and asks questions; Exam Cram runs rapid-fire;
  Debugging Mentor guides toward a bug instead of fixing it for you). They are
  configurable, cloneable from a library, and stay on until turned off.
  ("Cite Everything" was removed from the library — it restated, per-space and
  as a soft "teaching style," what `user_settings.answer_only_from_docs` /
  `.always_show_citations` already do account-wide and on by default.)
- **Agents** are one-shot *actions* that consume the current conversation and
  produce an artifact: a note, a deck of cards, or a quiz. They run, they hand
  back something, they're done.

The one-line test the UI must satisfy: a Skill changes *how the AI talks*; an
Agent *makes you something*.

Other confirmed facts:

- LLM: Groq, tiered — 70B for chat/quiz generation, 8B for short prompts,
  a vision model available but not yet wired to a feature.
- Auth: Supabase, email/password + Google. Email confirmation required.
- Backend holds all AI credentials; the browser never calls the model.
- Every error reaches the user as plain language — no stack traces, no raw
  provider text, no `[object Object]`.
- Card generation currently produces a single card from a chat reply. This is a
  known deficiency, not the intent: an agent asked for cards should produce a
  deck.

## Brand Commitments

User-pinned and binding:

- **Dark only.** No light theme, no theme switcher. Not near-black — a middle
  ground, soft and warm, with neon-leaning accents.
- **No violet.** The current `#6c5ce7` brand color is explicitly rejected.
- Bold, funky, playful, high-energy. Aimed at a student, not an enterprise.
- **No decorative emoji as iconography.** Emoji-as-icon is called out as
  childish and must be replaced with real drawn icons.
- No raw markdown artifacts (`**`, `##`) ever visible in rendered output.
- Must not read as generic AI-generated design.

Name: Space Learn.

## Evidence on Hand

- Working full-stack implementation: FastAPI + Supabase (Postgres/pgvector) +
  React, all features wired to real endpoints.
- Live database with schema, RLS, RAG function, and a seeded library of 10
  Skills: Socratic Tutor, Exam Cram, Paper Explainer, Concept Simplifier,
  Feynman Tutor, Debugging Mentor, Exam Examiner, Mistake Analyst, Compare &
  Contrast, Code Review Mentor.
- Real Groq and Supabase credentials configured; chat, retrieval, and citation
  verified working end-to-end.
- No real users, usage data, testimonials, or performance benchmarks exist.
  Nothing may claim otherwise.

## Product Principles

1. **The hand-off is the product.** Every surface should make it obvious that
   what you just learned can become something you'll be tested on.
2. **Re-entry beats onboarding.** The student who returns after three days is
   the primary case. Tell them where they left off and what to do next, in their
   own material's terms — never a generic greeting.
3. **Every claim is traceable.** An answer without its source is a downgrade.
4. **Momentum is honest.** Streaks, badges, and progress reflect real logged
   activity. No fake encouragement, no inflated numbers.
5. **Never blame the student for the system.** Failures explain themselves and
   offer the next move.

## Accessibility & Inclusion

Keyboard paths for the study loop (flip, grade, send) are required — reviewing
cards is repetitive and mouse-only review is a wrist injury. Motion respects
`prefers-reduced-motion`. Dark-only means contrast must be verified against the
chosen ground, not assumed.
