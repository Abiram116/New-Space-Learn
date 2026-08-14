# Implementation Plan

The sequenced build order for everything approved in this audit. Each phase
compiles, deploys, and demos independently — no phase leaves the product in a
half-migrated state.

**Scope note:** this plan covers the approved product/vision.md redesign plus the
engineering-health fixes the 2026-08-09 audit surfaced, and the design track
below. It does **not** re-plan the already-shipped V1 epics.

**This is the only plan.** `plan-frontend.md`, `plan-backend.md`,
`design-plan.md`, `backlog.md`, `v2-review.md` and `retrospective.md` were six
overlapping lists of the same work with a cross-referencing numbering scheme
between them. Everything in them was either shipped or is restated
here; they were deleted rather than left to drift. Their durable decisions
live in [decisions.md](decisions.md).

**Team assumption:** two developers. Phases are sized to ≤1 week each. Where
two tracks can genuinely run in parallel, that's called out — but note that
several phases have a real serialization constraint, and pretending otherwise
would produce a plan that breaks on contact.

---

## Phase 0 — Fix what's actually broken (1 week)

> **Status: implemented 2026-08-09, awaiting review.** 34 tests pass, ruff and
> `tsc` clean, frontend builds. Two items are partially blocked and need you:
>
> | Task | Status |
> |---|---|
> | 0.1 embeddings | **Code path complete; flag still `true`.** No embedding provider key exists in any environment, so flipping `USE_STUB_EMBEDDINGS=false` would break every upload. This is exactly the risk this phase flagged. Set `EMBEDDING_API_KEY`, flip the flag, run `api/scripts/reembed_documents.py`. |
> | 0.2 guard tests | Done — 15 tests, including a coverage test that fails if a *future* endpoint forgets its guard. |
> | 0.3 SM-2 tests | Done — 9 branch tests plus a parity test that executes the real `schedule.ts` over 480 cases. They agree. |
> | 0.4 citation validation | Done — 9 tests; the canonical text is also returned on the `done` event so the client reconciles. |
> | 0.5 warm-up | Done, **and a doc error corrected**: the landing page never actually pinged. Now warms from Landing and the auth pages. Verified live (`GET /api/v1/health → 200`). |
> | 0.6 docs gate | Done — `EXPOSE_API_DOCS`, off in `render.yaml`. Verified both states. |
> | 0.7 browser verification | **Still partially blocked.** Toast contrast and the landing font race are fixed and verified in-browser. The Notes editor and Profile empty state sit behind sign-in and have *never been opened in a browser by anyone*. This is the oldest unpaid item in the plan. |

**Why first:** two of these are correctness problems, not features, and one
of them (embeddings) invalidates any retrieval-quality measurement taken
before it lands. Building product/vision.md features on top of broken retrieval would
mean demoing confusion pairs over quizzes generated from arbitrary chunks.

| # | Task | Owner | Est. |
|---|---|---|---|
| 0.1 | **Wire a real embedding provider.** `embeddings.py::embed_texts` already isolates every caller — swap the stub for a real call, flip `USE_STUB_EMBEDDINGS=false` in `render.yaml`. Add a re-embed path for documents ingested under the stub (they hold meaningless vectors and will never retrieve correctly — `reprocess` already exists and does exactly this). | Dev A | 1–2 days |
| 0.2 | **Test `guards.py` ownership assertions.** `pytest`/`pytest-asyncio` are already declared but no test directory exists. Cover: each `assert_*` raises `NotFound` for a foreign id, returns the row for an owned one, plus the `_active_skills` no-user-filter assumption (`docs/engineering/security.md §2`). | Dev B | 1–2 days |
| 0.3 | **Test SM-2 grading math** — `grade_card()`'s four grade branches, and (critically) that the Python and TypeScript implementations agree, since `docs/engineering/ai-pipeline.md` documents them as a deliberate duplication. | Dev B | 1 day |
| 0.4 | **Validate citation markers server-side.** Post-stream regex range-check, dropping/flagging out-of-range `[[n]]` before persisting (`docs/engineering/ai-pipeline.md §10`, `docs/engineering/security.md §4.2`). | Dev A | half day |
| 0.5 | **Warm the app shell**, not just the landing page (`docs/operations/performance-and-cost.md §6`) — fire the `/health` ping from `AppShell` mount too. | Dev A | 1 hour |
| 0.6 | **Gate `/api/v1/docs` behind an env flag** (`docs/engineering/security.md §9`). | Dev A | 1 hour |
| 0.7 | **Click through the Notes editor in a real browser.** Rebuilt on Tiptap and **never visually verified** — flagged as the top priority by both `docs/plan.md` and `docs/plan.md`. Verify inline `/ai`, the toolbar, markdown round-tripping, and that no raw HTML or `**` reaches the screen. Also: Profile empty state, toast contrast (`docs/plan.md`), landing font race + marquee gap (§15). | Dev B | 1 day |

**Exit criteria:** real embeddings live and previously-ingested documents
re-embedded; `pytest` green with guard + SM-2 coverage; a chat answer's
citations verified in a browser against the actual cited page; the Notes
editor confirmed working by a human, not a typecheck.
**Demo:** "Ask a question — the cited passage is now genuinely the most
relevant one in your material, and we can prove the citation points where it
says it does."
**Risk:** 0.1 requires a second provider account/key. If that's blocked,
Phase 0 still ships 0.2–0.6 and Phase 1 can proceed — but every phase's
retrieval-quality claim stays provisional until 0.1 lands. **Flag this early
rather than discovering it mid-phase.**

---

## Phase 1 — Prepare the ground for confusion pairs (1 week)

**Why now:** the tag/choice schema change is a prerequisite for the flagship
feature, and it's the only part of the redesign that touches a stored data
shape. Doing it alone, first, keeps the risky part small and isolated.

| # | Task | Owner | Est. |
|---|---|---|---|
| 1.1 | **Extend `subtopic` tagging to flashcard generation** (`docs/plan.md`, part 1) — same pattern already shipped for quiz questions. | Dev A | half day |
| 1.2 | **Change quiz `choices` to carry per-choice concept labels** — `list[str]` → `list[{text, concept}]` in the generation prompt and `QuizQuestion` schema. | Dev A | 1 day |
| 1.3 | **Backward-compatible read path.** Existing `quizzes.questions` rows hold bare-string choices. The quiz-taking UI and scoring must handle both shapes — this is the one place in the redesign where a migration-shaped problem exists, and the answer is a tolerant reader, not a data migration (old quizzes simply won't contribute to confusion pairs). | Dev A | 1 day |
| ~~1.4~~ | ~~Split `me.py` (679 lines, largest backend file) into `me_brief.py` / `me_stats.py` / `me_student_model.py` **before** Phase 2 adds two more endpoints to it.~~ **Done** — verified by the 2026-08 end-to-end audit: `api/app/routers/me/` is now a package (`__init__.py`, `_common.py`, `account.py`, `brief.py`, `stats.py`). | Dev B | 1 day |
| ~~1.5~~ | ~~Split the three fat frontend files.~~ **Done** — verified by the 2026-08 end-to-end audit: `Settings.tsx`'s six `Row*` primitives live in `components/ui/Row.tsx`; `NoteEditor` is its own file, split out of `NotesView.tsx` (now 329 lines); `FlashcardsView.tsx` is down to 558 lines. | Dev B | 2–3 days |
| ~~1.6~~ | ~~Measure `/me/stats` for real~~ — **done** (`docs/operations/performance-and-cost.md §9`, its own "done" marker, re-confirmed by the 2026-08 end-to-end audit). | Dev B | 1 hour |
| ~~1.7~~ | ~~Delete `subspaces.py`'s private guard copies.~~ **Done** — verified by the 2026-08 end-to-end audit: `subspaces.py` now imports `assert_space`/`assert_subspace` from `guards.py` and its module docstring records the 2026-08-10 fix and the reason (403 was an enumeration oracle). | Dev A | 2 hours |
| ~~1.8~~ | ~~Configure a frontend test runner.~~ **Done** — verified by the 2026-08 end-to-end audit: Vitest is configured, 255+ frontend tests exist. | Dev B | half day |

**Exit criteria:** new quizzes generate tagged choices; old quizzes still
take and score correctly; typecheck and tests green.
**Demo:** nothing user-visible — this is the one phase with no payoff on
screen. Keep it short and get through it, exactly as `docs/product/vision.md §11` says
about its own Phase A.
**Parallelism:** genuinely clean here — Dev A owns the schema/prompt path,
Dev B owns refactors. No shared files.

---

## Phase 2 — Confusion pairs (1 week) ← **the demo phase**

**Why this is the priority:** `docs/product/vision.md §8.1` ranks it highest on
pitch-value ÷ effort, no competitor does it, and `docs/operations/performance-and-cost.md §4` confirms
it costs $0 per use.

| # | Task | Owner | Est. |
|---|---|---|---|
| 2.1 | **`GET /me/confusion-pairs`** — aggregate `(correct_concept, chosen_concept)` from `quiz_results` × `quizzes`, normalized, `count >= 3` (`docs/engineering/ai-pipeline.md §4`). | Dev A | 2 days |
| 2.2 | **Feed it into the Home brief's suggestion** as one more candidate signal alongside lowest quiz average and overdue decks — reusing the existing selection logic, not adding a parallel one. | Dev A | 1 day |
| 2.3 | **Quiz-results confusion card** (`docs/plan.md`) — "You've confused X with Y four times," wired to the existing per-question `source` so it links to the passage that separates them (the "backward edge" from `docs/product/vision.md §7`). | Dev B | 2 days |
| 2.4 | **Empty/thin-data states.** With `count >= 3` gating, a new user sees nothing here for weeks. The card must be absent, not empty — and the brief must fall back cleanly. This is the `docs/plan.md` standing-checklist item most likely to be skipped under demo pressure. | Dev B | half day |

**Exit criteria:** a seeded account with real repeated wrong answers surfaces
a real confusion pair, traced to a real passage; a fresh account shows no
confusion UI at all.
**Demo:** *"You've mixed up self-attention and cross-attention four times.
Here's the paragraph that separates them."* — lead the whole product demo
here.
**Risk:** demo quality depends on having realistic quiz history. **Build a
seed script in this phase**, not the night before the demo.

---

## Phase 3 — Exam-aware scheduling (1 week)

**Why here:** its *data* is fully independent of Phases 1–2 (it never needed
concepts or tags). `docs/product/vision.md §8.2` rates it the strongest *algorithmic* claim
available for a viva.

**But it is not schedulable before task 1.5.** Phase 3 adds two surfaces to
the flashcard review UI (3.4, 3.5), and 1.5 splits the 1046-line
`FlashcardsView.tsx` those surfaces land in. Starting Phase 3 first means
either doing the refactor twice or abandoning it — so **1.5 is a real
prerequisite for Phase 3, even though no data dependency exists.** See the
parallelism note below.

| # | Task | Owner | Est. |
|---|---|---|---|
| 3.1 | **`exam_date date` (nullable) on `subjects`** + settings UI to set it. | Dev A | 1 day |
| 3.2 | **Interval compression in `grade_card()`** — when a computed `due_at` would land past the exam, compress to fit the runway. | Dev A | 1–2 days |
| 3.3 | **Mirror the compression in the frontend's optimistic SM-2 copy** — non-negotiable, per `docs/engineering/ai-pipeline.md`: server-only compression would make every compressed card flash the wrong interval for one round trip. | Dev A | half day |
| 3.4 | **Honest-cram UI** — visible "compressed to fit your exam" indicator and an explanation of what got sacrificed. `docs/product/vision.md §8.2` calls the honesty load-bearing, not optional. | Dev B | 2 days |
| ~~3.5~~ | ~~**Flashcard grade-button interaction redesign**~~ — **done 2026-08-09** in the design track below. Four bevelled chips in four hues became figures on a rule; see Design Phase 2. |

**Exit criteria:** a subject with an exam 9 days out visibly compresses
intervals, server and client agree, and the UI explains the trade.
**Demo:** *"Your exam is in 9 days. Here's what actually fits, and here's
what I dropped to make it fit."*
**Note:** 3.1–3.3 are one serial chain owned by one dev — the SM-2 change
lands in two languages and splitting it across two people invites drift.

---

## Phase 4 — The Gap Map (1 week)

**Why last of the features:** it's the only one that reads *from* the others'
output. Per [docs/decisions.md](decisions.md),
nodes are normalized concept tags and **confusion pairs are the only edge
source** — so Phase 2 is a hard prerequisite, not just a source of edge
weights. Nothing about the map is stored; it's a projection assembled per
request.

| # | Task | Owner | Est. |
|---|---|---|---|
| 4.1 | **`GET /me/gap-map?subject_id=`** — nodes per normalized tag (size = question + flashcard count; colour = quiz average by tag), edges reusing Phase 2's confusion aggregation, plus a cross-subject flag per tag. All `GROUP BY`, no new table (`docs/plan.md`). | Dev A | 2 days |
| 4.2 | **The view** (`docs/plan.md`) — deliberately boring and readable. **Must be its own lazy route chunk** (`docs/operations/performance-and-cost.md §2`: 245KB against a 250KB ceiling leaves ~5KB of headroom; a rendering library in a shared module blows the budget). | Dev B | 3 days |
| 4.3 | **The nodes-only state.** Before a student has three repeated confusions the map has no edges at all. This is correct, not empty — it must read as "nothing's gone wrong yet." Easiest thing to skip and most likely thing a fresh account sees. | Dev B | half day |
| 4.4 | **Verify the "five-second scan" goal** — if the eye doesn't go straight to the worst edge, it has failed its own design brief and needs another pass, not a prettier one. | Both | half day |

**Exit criteria:** the map renders from real data with no stored graph
structure; main bundle still ≤250KB gzipped; a thick problem edge is
identifiable at a glance; a fresh account sees a coherent nodes-only map.
**Demo:** *"Here's your revision plan, and here's why."*

---

## Phase 5 — Cross-subject transfer (3 days)

Only startable once Phase 2 has produced real repeated tags across more than
one subject (`docs/plan.md` — postponed deliberately, not forgotten).

| # | Task | Est. |
|---|---|---|
| 5.1 | Normalized-`subtopic` match across subjects; surface weakness propagation | 2 days |
| 5.2 | Brief integration: *"This is about to hurt you in another module."* | 1 day |

**Risk:** genuinely dependent on real usage data existing. If tags haven't
accumulated across subjects yet, **this phase should slip rather than be
demoed on synthetic data** — a fabricated cross-subject insight is exactly
the invented-metric mistake `docs/plan.md` warns about.

---

## Design track — the three materials (2026-08-09)

Runs alongside the feature phases above and shares no files with them, so it
parallelizes cleanly. It exists because of one complaint that turned out to
be exactly right: *"you designed everything in a card approach — that is
fine, but it's not great, and it doesn't match the theme."*

The cause was not a missing idea. `components/ui/Surface.tsx` already defined
three materials with a written rationale — **Card** (things you own), **Leaf**
(things you read), **Ledger** (things you're measured against) — and was
imported by zero files. Every screen rendered everything as cardstock, which
is why nothing read as distinguished: when every object is the same material,
being one means nothing.

The one-line test, from `Surface.tsx`: *cardstock is a thing you HAVE; a leaf
is a thing you're INSIDE; a ledger is a thing you're MEASURED AGAINST.*

### Done

| # | Phase | What changed |
|---|---|---|
| D1 | **Adopt the three materials** | Every screen audited against "is this owned, read, or measured?" Notes editor and chat answers → `Leaf`; quiz stems → `Leaf`; streak, quiz score panel, profile stat tiles, flashcard session summary → `Ledger`; flashcard faces and topic/source cards deliberately **stay** `Card`. Settings got no material at all — it has no owned, read, or measured objects, so its panels are plain. |
| D2 | **Button purpose audit** | One pass per screen answering *why does this button exist here, and what pain does it solve?* Outcome was demotions and deletions, as expected. Sign out went from three places to one (Settings › Account, the only one with an explanation next to it). The flashcard grade row — flagged as feeling wrong three separate times — was rebuilt: four bevelled chips in four hues became figures on a rule, because grading is one ordered scale, not four categories, and the ascending intervals already say so in real numbers. `bevel3d` stopped being exported. Quiz "Back" demoted to ghost. The "keys 1–4" caption was deleted by folding the digit into each button. |
| D3 | **Home as one composition** | Was four stacked sections and twelve borders. Now four bands on one sheet: streak, cards due, quiz average and weekly minutes as **four figures sharing one rule**, with the fortnight chart beneath them as evidence; the schedule and composition panels as ledgers; topic cards as the only cardstock left on the page. `foil` removed from every figure — an average is not something you won. `StreakLedger.tsx` became `Fortnight.tsx` and gave up its own surface. |

### Open — pick up here

| # | Phase | What it is |
|---|---|---|
| D4 | **Auth responsiveness** | Verify `features/auth/AuthShell.tsx` at 375px, 768px, 1024px and 1440px. The iPad-portrait case broke here once before, so 768px is the one to check first. |
| D5 | **Landing motion consistency** | `features/landing/language.ts` defines one motion language and states nothing may invent its own. Audit `Landing.tsx`, `HeroReveal.tsx`, `wow.tsx` and `CardSequence.tsx` for durations and curves that bypass it. **Constraint, learned from a real bug — do not regress it:** none of `wow.tsx`'s wrappers may contain a `sticky` or `fixed` descendant. A transform on an ancestor re-parents both and silently unpins the scene. |
| D6 | **Performance, cost, and repo standards** | Fold in `docs/operations/performance-and-cost.md`'s own top two recommendations — warm the app shell rather than only the landing page (also task 0.5), and measure `/me/stats` for real (task 1.6). Then the broader pass: request-shape review against `docs/operations/performance-and-cost.md`, dependency audit, and the frontend test runner from task 1.8. |

### The rules this track established

Anything built after this point is held to them, because the whole point was
to stop the app being a pile of undifferentiated objects:

- **Pick the material before writing the markup.** If a new component doesn't
  obviously fit Card, Leaf, or Ledger, the material question hasn't been
  answered yet — that's the signal, not a reason to add a fourth material.
- **`Card` is not the default.** It means *you own this*. Using it for a
  figure or a paragraph is what caused this whole track.
- **`foil` is for collectibles only.** Never on a measurement.
- **A button earns its place or it goes.** Same action in two places means one
  of them is wrong. Prefer demotion to deletion only when the demoted version
  still does real work.
- **Don't animate numbers.** One counting figure on a page is a focal point;
  five is a slot machine.

---

## Now — everything outstanding (2026-08-10)

Written after a working session that fixed several things and surfaced
several more. Ordered by whether the product is *wrong* without it, not by
size.

### Resolved today, for the record

Struck through so nobody re-opens them:

- ~~Retrieval was stubbed~~ — the `vector(384)` migration is applied on the
  live database, `USE_STUB_EMBEDDINGS=false`, and a real PDF was verified
  end to end: upload → chunk → embed → insert → retrieve → correct citation.
- ~~Documents hung at "embedding chunks"~~ — the cause was an **infinite
  loop in `chunk_text`**, not embedding-provider timing. Any document whose
  final chunk fell within `CHUNK_OVERLAP` of the end looped forever
  appending the same trailing chunk until memory ran out. Covered by
  `test_chunking.py`.
- ~~Note generation always failed~~ — the model was asked for JSON around a
  long markdown payload and reliably broke the escaping, sometimes omitting
  the opening quote entirely. Now a `TITLE:` / `---` delimiter format, which
  has nothing to escape.
- ~~Quizzes and flashcards refused to run without an indexed document~~ —
  both already *loaded* chat history and passed it to the model; only the
  gate above disagreed. Chat now counts as material, matching notes.
- ~~The Home brief kept describing deleted subjects~~ — the rows really were
  deleted; the model-written brief was cached for 30 minutes and outlived
  them.
- ~~Subject delete was unreachable~~ — three attempts. `opacity-0` meant it
  did not exist on touch. The `opacity-40` replacement measured 1.89:1
  contrast, under half the WCAG floor. Both of those were the wrong axis
  entirely: the real cause was a missing `min-w-0` on a `flex-1` button, so
  a long subject name refused to shrink, `truncate` never fired, and the
  control was pushed past the rail's `overflow-x-hidden` edge. That is why
  it appeared on "dfcs" and not on "Reinforcment Learning" — the bug was
  name length, not position. It is a `⋯` menu now, with Rename, Pin and
  Delete.
- ~~The codebase was not ready for the work above~~ — see the struck-through
  P2 rows: lint gate restored to zero, `me.py` split into a package before
  Phase 2/4 add endpoints to it, the duplicated guards deleted, and a
  frontend test runner with 44 tests where none existed.

### P0 — the product is wrong without these

| # | Item | Why it matters |
|---|---|---|
| ~~N1~~ | ~~A real student model, and a brief that uses it~~ — **done.** The model is per-subspace `TopicView`s across every subject with quiz average, trend, cold/untouched/neglected detection, plus per-concept mastery (below). The brief reads one snapshot instead of three overlapping fetches, ranks facts by how unlikely the student is to have noticed them, and the deterministic fallback follows the same ranking. |
| ~~N2~~ | ~~Notes agent asks how you want it~~ — **done.** `NoteBriefDialog` collects free-text `instructions` before the agent runs. Examples are prefills, not an enum — the schema comment is explicit that a fixed style list can only offer shapes someone thought of in advance. |
| ~~N3~~ | ~~Personalised tone per student~~ — **done, deliberately not as written.** The task said populate `teaching_preference`/`learning_style` from behaviour. Those fields are the student's own words, shown back in Settings, so writing inferences into them would display sentences they never wrote as though they had. Behaviour now feeds a separate observed layer (`observed_habits`, `preferences.resolve()`), counted in **days** rather than events so 400 cards and 3 quizzes aren't compared as one unit. Explicit always outranks observed. |

### The personalization engine — shipped 2026-08-10

Knowledge, preferences, per-task context, skill composition and the feedback
loop are **built and in use**. How it works, and every decision behind it:
[engineering/personalization.md](engineering/personalization.md).

**The feedback loop is HALF-MIGRATED — finish P-0 before anything else.**

The ask policy shipped time-driven ("chips every 5 assistant turns"), which is
the wrong product principle: it makes the app feel like a survey. The right
question is not *when did we last ask* but **is asking worth the interruption**.
Half the fix is in; the UI half is not.

Done:
- **Implicit signals are mined from the student's own turns.** "explain that
  more simply", "go deeper", "give me an example" are already feedback, already
  stored in `chat_messages`, and were being ignored — while the app interrupted
  the student to ask what they had just said. Now derived at read time (never
  stored — the messages are the source), filed as `observed` so a regex reading
  phrasing can never outrank a deliberate tap, and dropped entirely when a
  dimension was pulled both ways, because that is context-dependence rather than
  a preference. High precision by design: "give me an example" counts, "what is
  an example of a monad" does not.
- `thumbUp` / `thumbDown` icons added to `Icon.tsx`. **Currently unused** — they
  are for P-0 below.

What is left, in order:

| # | Item | Gated on |
|---|---|---|
| ~~P-0~~ | ~~Finish the event-driven feedback UX~~ — **done.** Asking is now caused by an event, never a clock. Three triggers: confusion with no direction, a second consecutive regeneration, a dimension whose evidence contradicts itself. A *directed* request ("explain simpler") suppresses asking outright, because it was already said and already recorded. `TURN_GAP` is gone; `MIN_TURNS_BETWEEN_OFFERS` and `AFTER_FEEDBACK_GAP` survive only as floors that can suppress an ask, never cause one. The passive thumbs render under every completed answer and never ask anything; a thumbs-down opens the chips rather than recording a bare negative, since "wrong" with no direction would lower every leading preference on no information. New chat and new topic are not observed by the policy at all, so they cannot become triggers by accident. 27 tests, including one that fails if any counter is reinstated as a trigger. | — |
| **P-1** | **Scoped preferences** — subject/topic-level, not just global. `response_feedback.concept` is already recorded so this needs no backfill. Only worth doing if the collected data shows preferences actually diverge by subject; precedence is cheap to define and expensive to populate. | real feedback data |
| **P-2** | **A/B teaching-strategy experiments.** Two strategies for the same struggling concept, compared on what happens next (quiz movement, fewer clarifications, recall). Needs a `strategy` label on `chat_messages.meta` — the column already exists — and a `teaching_experiments` table. **Deliberately not started:** two generations per question doubles token cost on the highest-traffic endpoint and burns the rate limiter's budget (chat costs 1 of 20/min). Justify it with evidence that single-signal feedback is insufficient. | P-1 evidence |
| **P-3** | **Confusion pairs into the model.** "You've mixed up self-attention and cross-attention four times" needs the *chosen* concept, not just the correct one. | tasks 1.2 + Phase 2 below |
| **P-4** | **Concept-tag flashcards** (task 1.1). Cards carry no `subtopic`, so Phase 4 outcome measurement can't ask "did drilling improve this concept". | — |

### Shipped 2026-08-10 (workspace + assessment pass)

- **The chat dock is a workspace, not a menu.** Notes read *and edit* in the
  panel with autosave; card review runs there; quizzes are taken and scored
  there. The file that used to argue a 320px column couldn't host these was
  wrong about what they need — a card is one question and four grades, a quiz
  question is a stem and four choices. They are the narrowest things in the
  app. Same components as the full pages, in `compact` mode, so the two cannot
  drift.
- **Notes are no longer scoped to the current topic.** `GET /notes` returns
  everything with its subject and topic name; the panel has a This topic /
  Everything toggle.
- **Quizzes reveal each answer on commit**, with an explanation the generator
  now writes, an encouraging line on a hit, the correct answer plus the concept
  to revise on a miss, and an elapsed timer. Choices lock once answered — a
  reveal you can answer around is not a reveal.
- **Chat locks during a quiz or card review.** Ref-counted so two mounted
  assessments can't unlock each other, tied to component lifecycle so no exit
  path forgets.
- **Quiz results rebuilt**: verdict pinned, review scrolls in its own
  container, misses first with explanations open, correct answers collapsed.
- **First-run intake** replaces the dashboard-of-zeroes: four questions in a
  scripted chat (no model call), writing real preferences. It does not ask what
  you're studying for — that changes fortnightly and already lives in Settings.
- **Settings has no dead controls.** Reminder time is gone rather than
  "honestly labelled"; the column stays if a notifier ever ships.
- **Profile fills the page** instead of centring into a blank lower half.

### Shipped 2026-08-11 to 2026-08-12 (grounding, guardrails, images, engineering pass)

Two commits this section previously didn't reflect (`21f8e16`, `b9c5baf`) —
N15–N18 above cover the first; this covers the second plus a follow-on
engineering-gap pass:

- **Response shape and diagram rules keyed on non-linearity, not keywords.**
  Skills moved behind the honesty invariants — a user-authored Skill could
  previously outrank them by prompt position alone, now it's framed as
  style, not truth. Safety narrowed and says so explicitly, so coursework on
  pathogens, exploits and atrocities is answered rather than refused.
- **Images paste into the composer** — downscaled client-side, validated
  before quota is charged, routed to the vision tier at 2x cost.
- **Every capped API field is mirrored in `lib/limits.ts`**, checked by a
  test that parses the Pydantic source directly rather than hand-copying
  numbers that then drift. Slash-command topics are clamped where the
  argument becomes a request, since no input `maxLength` covers that path.
- **A real embedding-provider decision, reversed and re-decided.** Phase 0
  shipped a hosted OpenAI provider; the product owner rejected it outright —
  $0 and genuinely local, not just cheap. Investigated BGE-small-en-v1.5
  (quantized ONNX) against measured memory/latency/quality, rejected BGE-M3
  for production (~2.2GB model, 4–8x the entire Render free-tier ceiling),
  and shipped the local model behind a `Protocol`-based provider interface.
  Migration to `vector(384)` applied on the live database; a real PDF
  verified end-to-end, upload → chunk → embed → insert → retrieve → correct
  citation. See `decisions.md`.
- **N4b closed for real** — see the table above. Also found and fixed two
  bugs that were blocking verification itself, not features: `@testing-library/dom`
  was never installed (a peer dependency of `@testing-library/react` that
  silently didn't resolve — all 21 frontend test files failed on a clean
  `npm ci`, so "217 tests pass" wasn't reproducible from a fresh clone), and
  `tests/styles.test.ts`'s `room.ts` exclusion compared a Windows
  backslash-separated path against a forward-slash literal, so the
  source-of-truth file flagged itself as its own offender on this platform.
- **BTech-core seed data added** to the live account for demo/dev use —
  Operating Systems, Database Management Systems, Computer Networks, each
  with real subspaces and at least one genuine study note, alongside the
  existing `fsd`/`NLP`/`Deep Learning`/`Java` subjects.

### P1 — visibly broken or missing

| # | Item |
|---|---|
| ~~N4~~ | ~~Loading times~~ — **addressed.** Chat's pre-model path went six sequential round trips → two waves; quiz/cards/notes generation gather their reads; `/me/brief` stopped double-fetching three tables; `/me/preferences` reads 3 tables instead of 10. What remains is a *measured* pass — there are still no numbers, only removed waterfalls. |
| ~~N4b~~ | ~~Measure it~~ — **done, 2026-08-12.** Real handlers, real database, real Groq calls, real embedded documents (`api/scripts/measure_perf_pass.py`): `/me/brief` 814.5ms median, `/me/stats` 725.5ms median (up from an earlier 518.8ms pass — checked the code, the round-trip shape hasn't regressed; flagged as an open question rather than papered over), retrieval 512ms against 52 real embedded chunks (sanity-checked against real similarity scores, not just timed), Groq TTFT 187ms, real chat TTFT ≈699ms (inside the <1.5s budget), document reprocess 6.2s (inside the 25s cap and <8s target). Full numbers in `operations/performance-and-cost.md §9`. Skeleton coverage on less-travelled screens is still unaudited. |
| ~~N5~~ | ~~Topics have no `⋯` menu~~ — **done.** `SpaceMenu` generalised to `RowMenu` taking its items as data, used by both subjects (Pin/Rename/Delete) and topics (Rename/Delete). Two near-identical menu components is how the two rows drift apart. |
| ~~N6~~ | ~~Notes has no motion~~ — **done.** Editor column rises per opened note (keyed on note id); the note list staggers in on load. Both use the app's existing primitives, not bespoke tweens. |
| ~~N7~~ | ~~Profile is thin~~ — **done.** Every badge is a threshold on a figure `/me/stats` already computes, so locked badges now show standing ("7 of 10") instead of only a rule. `earned` is derived from the threshold rather than passed in, so the two can't disagree. |
| ~~N8~~ | ~~`CardSequence.tsx` is dead code~~ — **deleted.** `Film` in `Landing.tsx` already implements the same idea more richly, and its own docstring records that two back-to-back pinned scenes is what made the page read as slides. Wiring it in would have re-introduced the seam that was deliberately removed. |
| ~~N9~~ | ~~`wow.tsx`'s `reduced()` is read once per mount~~ — **done.** It now uses the live-updating `useReducedMotion()` that already existed in `components/ui/motion.tsx`; the local copy was a second, static implementation of a solved problem. `VelocityTilt` also clears its transform on the flip rather than freezing mid-skew. |

### P2 — engineering debt with a known cost

| # | Item |
|---|---|
| ~~N10~~ | ~~No frontend test runner~~ — **done.** Vitest, 44 tests, aimed where bugs are silent: the escaped-HTML repair, the SM-2 client port's half-to-even rounding, slash-menu availability. See N15/N16 for what is still uncovered. |
| ~~N11~~ | ~~`subspaces.py` private guard copies~~ — **done.** Deleted; it calls `guards.py` now, so the 403/404 contradiction is gone. |
| ~~N12~~ | ~~Two fat frontend files remain~~ — **done, before Phase 3 lands in them rather than after.** `FlashcardsView` 1,063 → 555 (`Review.tsx`, `Summary.tsx`, `modals.tsx`, `model.ts` — `Mode` had to move too, or extracting `Review` would have been a circular import). `Settings` 656 → 543, with the six `Row*` primitives now in `components/ui/Row.tsx`; nothing in them knew what a preference was. |
| ~~N13~~ | ~~`me.py` is the largest backend file~~ — **done.** Now a package: `account` (who you are), `stats` (what you've done), `brief` (what to do next), `_common` (the two helpers with real second callers). 679 → largest module 362. All nine routes still register; `main.py` unchanged. |
| ~~N14~~ | ~~58 ruff errors, 93% false positives~~ — **done.** `B008` ignored with the reasoning recorded in `api/pyproject.toml`; the four real errors fixed. Zero now, and it immediately earned its keep — the `me.py` split broke four names and ruff named all of them. |
| ~~N15~~ | ~~No component-render tests~~ — **done, 21f8e16.** `@testing-library/react` + `jsdom` installed. First fully-mounted `NoteEditor` test in the repo: slash menu opens on `/`, closes on backspace/space/ordinary text. `clearAiPlaceholder` extracted out of a closure specifically so the "Thinking…" survives a failed request" bug is covered directly, not mocked. Two mutations survived the first pass and both were real — see the exit-criteria note on mutation-checking. |
| ~~N17~~ | ~~No regenerate control exists~~ — **done, 21f8e16.** Wired end to end: `ChatSend` gains a `regenerate` flag, backend skips re-inserting the already-on-record question, frontend sends a `regenerate` response_feedback event and resends without duplicating the user bubble. First test coverage `subspace_chat.py` has ever had. |
| ~~N18~~ | ~~`readSignal` duplicates `_IMPLICIT_PATTERNS`~~ — **done, 21f8e16 + 2026-08-12.** Two real drifts found and fixed: the frontend had zero pattern for "just give me the answer"/"stop asking" (that whole preference category could never suppress an ask); and a genuine disagreement on "I don't understand" — backend read it as directed evidence for "simpler," frontend read it as the strongest ask-trigger. Pinned with a parity test rather than silently picking a side (`test_implicit_signal_parity.py`), then **resolved 2026-08-12 as a product decision, not a refactor**: first occurrence asks, a repeat with nothing resolving it in between infers instead of interrupting again. `consecutiveConfusion` gates `askReason`'s `confusion` trigger; the classifiers themselves didn't change. See `decisions.md`. |
| ~~N16~~ | ~~Untested pure logic~~ — **done, 21f8e16 + 2026-08-12.** `lib/retention.ts` (13 tests against the documented forgetting-curve formula, computed independently rather than copied from source) and `lib/sessionCache.ts` (12 tests, including the literal stale-shape-crashes-Home regression) closed in 21f8e16. `ImageBlock`'s `parseTitle`/`buildTitle` round-trip (16 tests, including the full round-trip property across every alignment/width) and `resolveDone` — the frontend counterpart of `rag.strip_invalid_citations`, extracted out of `handleEvent`'s closure to make it testable (8 tests) — closed 2026-08-12. |
| ~~N19~~ | ~~Frontend `ErrorCode` missing two real backend codes~~ — **done, 2026-08-12.** `handle_http_exception` (`errors.py`) can emit `method_not_allowed` and `http_error`; neither existed in `errors.ts`'s union. `client.ts` parses the server's code with a bare `as ErrorCode` — no runtime check — so the gap didn't crash or type-error, it silently fell back to a generic message. Added both, plus `tests/errors.test.ts` (7 tests, mirroring `limits.test.ts`'s "read the real Python" discipline), which is what would have caught this originally and will catch the next one. Also fixed a stale `nothing_indexed` default that still said "Upload a document first" after the backend's own message changed — provably unreachable today (the server always sends a real message, which `friendlyMessage` prefers), but wrong text is wrong text. |
| ~~N20~~ | ~~`NoteCitation` duplicated `Citation`~~ — **done, 2026-08-12.** Structurally identical, defined twice — `notes.ts` now imports the shared type. Zero behavior change; removes a place a future field on `Citation` could silently not reach note citations. |
| **N21** | **A real asymmetry, found and deliberately left alone.** `quizzes.py`'s `NothingIndexed` gate is `not retrieved and not history and settings.llm_configured`; `flashcards.py`'s and `notes.py`'s are the same minus the `llm_configured` check. Practical effect: with no Groq key configured, quizzes fall through to a working placeholder flow (`_stub_questions`) regardless of material, while flashcards and notes always raise a real error. Not a crash either way — both are handled gracefully — but three structurally-parallel "generate" features shouldn't disagree on whether "no key configured" is demo-clickable. **Not fixed now**: building stub content for flashcards/notes is new feature surface, which is explicitly out of scope going into a review. Real-world impact is near-zero regardless — every deployment target configures a real `GROQ_API_KEY`; this only bites local dev with no key. Revisit after the review, not before. |

### The end-to-end audit

**Done, 2026-08-12.** Systematic pass, not a vibe check: every Pydantic
response model in `schemas/__init__.py` diffed field-by-field against its
TypeScript counterpart (`types.ts` plus the resource-specific files —
`feedback.ts`, `notes.ts` — for the ones that live there instead); every
`ApiError` code cross-checked against `errors.ts`'s union; every
`NothingIndexed` gate compared across `quizzes.py`/`flashcards.py`/`notes.py`;
the document status state machine checked against every frontend consumer.

**Clean:** the shared type contract (`types.ts`), the feedback-kind taxonomy,
document status handling, `PreferenceOut`/`Preference`. The class of bug this
audit was named for — quizzes loading chat history and then refusing to use
it — really was already fixed; re-verified rather than assumed.

**Found:** N19–N21 above. Two real, low-risk contract gaps (fixed), one real
architectural asymmetry (documented, deliberately not fixed — see N21).

---

## Dependencies and critical path

```
Phase 0 (embeddings, tests, citations, browser verification)
   │
   └──> Phase 1 (tag schema, refactors)
           │
           ├──> Phase 2 (confusion pairs) ──> Phase 4 (Gap Map) ──> Phase 5 (cross-subject)
           │
           └──> Phase 3 (exam scheduling)   [needs task 1.5 only, not Phase 2]
```

**Critical path:** 0 → 1 → 2 → 4 → 5. About five weeks with two developers.

**Genuinely parallelizable:** **Phase 3 against Phase 2**, once Phase 1 is
done — Phase 2 touches `me.py`/quiz routers and the quiz results view; Phase 3
touches `subjects`, `flashcards.py`, and the (now-split) review components. No
shared files, no shared data.

**Not parallelizable, despite looking like it:**
- **Phase 3 before task 1.5** — no data dependency, but a direct file
  collision in `FlashcardsView.tsx`. This is why the graph above hangs Phase 3
  off Phase 1 rather than off Phase 0.
- **Phase 3's 3.1–3.3 chain** — one algorithm in two languages; splitting it
  across two people invites drift.
- **Phase 4 before Phase 2** — confusion pairs are the Gap Map's only edge
  source (docs/decisions.md), so Phase 4 has nothing to draw without them.

---

## Milestones

| Milestone | After | Demonstrable claim |
|---|---|---|
| **M1 — Honest foundation** | Phase 0 | "Retrieval is real, citations are verified, and the security boundary has tests." |
| **M2 — The differentiator** | Phase 2 | "No competitor can tell you which two concepts you specifically keep confusing." |
| **M3 — Better than Anki for students** | Phase 3 | "SM-2 is calendar-blind. Ours isn't." |
| **M4 — The verdict** | Phase 4 | "Opening the app is a verdict, not a decision." |
| **M5 — The moment hierarchy can't produce** | Phase 5 | "Your weakness in Statistics is about to cost you in Machine Learning." |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Embedding provider blocked (account/key/cost) | Medium | High — every retrieval-quality claim stays provisional | Surface in Phase 0 day 1; Phases 1–4 can proceed but must not *claim* retrieval quality until resolved |
| Confusion pairs have no real data to show at demo time | **High** | High — it's the lead demo | Build the seed script during Phase 2 (task 2.4's sibling), not later |
| SM-2 duplication drifts between Python and TypeScript | Medium | Medium — visibly wrong intervals | Phase 0.3's cross-implementation test, plus keeping 3.1–3.3 with one owner |
| Gap Map blows the 250KB bundle ceiling | Medium | Medium | Lazy chunk from the first commit (4.2), verify bundle size in the phase's exit criteria |
| Old bare-string quiz `choices` break scoring | Low | High — breaks a shipped feature | Phase 1.3's tolerant reader, explicitly tested against a pre-change quiz row |
| Refactors (1.4, 1.5) introduce regressions in untested UI | **High** — `web/` has no test runner (1.8) | Medium | Do 1.8 first, then sequence refactors *before* new features land in those files, so a regression is attributable to one change |
| Landing/asset work re-opening as a time sink | Medium | Medium — asset generation is a whole session, not a task | The cinematic pass shipped 2026-08-09. Treat further landing work as a new, separately scheduled piece, not a tweak |

---

## Definition of done, per phase

A phase is not done until:

1. It compiles and typechecks (`npx tsc -b --noEmit`, `ruff check .` — which
   must be **zero**, not "the usual noise").
2. Both suites pass (`cd api && uv run --extra dev pytest`, `cd web && npm test`).
3. **It has been clicked through in a real browser.** This is the single most
   repeated lesson this project has learned: verify against the actual
   rendered output, never against "it typechecks." Every mistake worth
   recording came from skipping it.
4. Every number on screen traces to a stored row. No invented metrics.
5. The empty, first-run, and single-item states are handled — a fresh account
   is the state most likely to be shipped broken.
6. The main bundle is still under the 250 KB gzipped ceiling
   (`docs/operations/performance-and-cost.md`).
7. **Any test written was mutation-checked** — break the implementation on
   purpose and confirm the test goes red before trusting it. A test that
   cannot fail is worse than no test, because it reports safety that is not
   there.

   This is not hypothetical. A `notePreview` test written during the
   2026-08-10 refactor appeared to guard against base64 image data leaking
   into note previews. Disabling the image-stripping it was "protecting"
   changed nothing — `stripMarkdown` already handled images, so the line was
   dead code and the test had been passing for the wrong reason since it was
   written. The mutation check is the only thing that found it. The line is
   gone, the hazard is a comment, and the test now asserts behaviour rather
   than implementation.

8. The relevant doc is updated in the same pass, and any technical debt
   introduced is written into this plan rather than left in someone's head.
