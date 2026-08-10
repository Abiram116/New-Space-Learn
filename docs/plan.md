# Implementation Plan

The sequenced build order for everything approved in this audit. Each phase
compiles, deploys, and demos independently — no phase leaves the product in a
half-migrated state.

**Scope note:** this plan covers the approved product/vision.md redesign plus the
engineering-health fixes the 2026-08-09 audit surfaced, and the design track
below. It does **not** re-plan the already-shipped V1 epics.

**This is the only plan.** `docs/plan.md`, `docs/plan.md`,
`docs/plan.md`, `docs/plan.md`, `0002-reject-concept-graph-schema.md` and `docs/plan.md` were
five overlapping lists of the same work with a cross-referencing numbering
scheme between them. Everything in them was either shipped or is restated
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
| 1.4 | **Split `me.py`** (679 lines, largest backend file) into `me_brief.py` / `me_stats.py` / `me_student_model.py` **before** Phase 2 adds two more endpoints to it (`docs/plan.md`). | Dev B | 1 day |
| 1.5 | **Split the three fat frontend files**, before new surfaces land in them. `FlashcardsView.tsx` (~1050 lines, 9 components) — extract `Review`/`CardFace`/`Summary` and the modals. `NotesView.tsx` (~850 lines) — extract the ~500-line `NoteEditor`. `Settings.tsx` (~660 lines) — its six `Row*` primitives (`RowShell`, `RowWithToggle`, `RowWithNumber`, `RowWithTime`, `RowWithText`, `RowWithSelect`) aren't settings-specific and belong in `components/ui/`. | Dev B | 2–3 days |
| 1.6 | **Measure `/me/stats` for real** and replace the simulated estimate (`docs/operations/performance-and-cost.md §7`). Note the endpoint has since been parallelized with `asyncio.gather` (8 round trips → 1), so the old estimate is doubly stale. | Dev B | 1 hour |
| 1.7 | **Delete `subspaces.py`'s private guard copies.** It defines its own `_get_owned_subspace` / `_assert_space_owned` instead of calling `guards.py`, and `_assert_space_owned` raises `Forbidden` (403) where `guards.assert_space` raises `NotFound` (404). `guards.py` documents the 404 as deliberate: a 403 confirms the row exists and belongs to *somebody*, which is an enumeration oracle. Two behaviours, one contradicting a documented security decision. Still unfixed as of 2026-08-09. | Dev A | 2 hours |
| 1.8 | **Configure a frontend test runner.** `web/` has no test tooling at all. The backend's 34 tests came out of Phase 0; the frontend has nothing equivalent, and `schedule.ts` is currently only covered indirectly by the backend's parity test. | Dev B | half day |

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
| N1 | **A real student model, and a brief that uses it.** The brief should read across *every* subject and topic — what was studied, what was skipped, where quiz scores are falling, which topic has gone cold — and say something a tutor would say. Today it looks at a narrow slice. This is the single feature that makes the product a tutor rather than a CRUD app. | It is the product thesis. See `product/vision.md`. |
| N2 | **Notes agent asks how you want it.** The backend already accepts free-text `instructions` and honours them (verified: "just a checklist" returns a checklist). The UI never collects them. | Half-built feature, invisible to users. |
| N3 | **Personalised tone per student.** `student_model.format_for_prompt` exists and feeds preferences into prompts, but nothing populates `teaching_preference` or `learning_style` from behaviour. | The personalisation is a stub with a real interface. |

### P1 — visibly broken or missing

| # | Item |
|---|---|
| N4 | **Loading times, everywhere.** Needs a real profiling pass — route chunks, request waterfalls, cache hit rates, skeleton coverage — not spot fixes. Start from `operations/performance-and-cost.md`. |
| N5 | **Topics have no `⋯` menu.** Subjects got Rename/Pin/Delete; topics still have a bare bin, and `renameSubspace` exists in the provider with no UI at all. |
| N6 | **Notes has no motion.** Everything else in the app rises in; the editor snaps. |
| N7 | **Profile is thin.** Reads as a receipt. Badges exist; nothing celebrates them. |
| N8 | **`CardSequence.tsx` is dead code** — well built, imported nowhere. Wire it into `Landing.tsx` or delete it. |
| N9 | **`wow.tsx`'s `reduced()` is read once per mount**, not subscribed. Toggling the OS motion setting mid-session doesn't reach `VelocityTilt`, `Magnetic`, `DraftingCursor`, `SourceDrift`. Low impact, real. |

### P2 — engineering debt with a known cost

| # | Item |
|---|---|
| ~~N10~~ | ~~No frontend test runner~~ — **done.** Vitest, 44 tests, aimed where bugs are silent: the escaped-HTML repair, the SM-2 client port's half-to-even rounding, slash-menu availability. See N15/N16 for what is still uncovered. |
| ~~N11~~ | ~~`subspaces.py` private guard copies~~ — **done.** Deleted; it calls `guards.py` now, so the 403/404 contradiction is gone. |
| **N12** | **Two fat frontend files remain.** `FlashcardsView` (1,063) and `Settings` (656, with six generic `Row*` primitives that belong in `components/ui/`). `NotesView` was split — 1,174 → 1,068 plus `toolbar.ts` and `format.ts` — because the plan queues more notes work; the other two were left because nothing is about to land in them. **Split before adding to them, not after.** Flashcards is the more urgent of the two: Phase 3 adds the exam-countdown surface to it. |
| ~~N13~~ | ~~`me.py` is the largest backend file~~ — **done.** Now a package: `account` (who you are), `stats` (what you've done), `brief` (what to do next), `_common` (the two helpers with real second callers). 679 → largest module 362. All nine routes still register; `main.py` unchanged. |
| ~~N14~~ | ~~58 ruff errors, 93% false positives~~ — **done.** `B008` ignored with the reasoning recorded in `api/pyproject.toml`; the four real errors fixed. Zero now, and it immediately earned its keep — the `me.py` split broke four names and ruff named all of them. |
| **N15** | **No component-render tests.** Coverage is pure logic only. Nothing asserts that a component mounts, that the slash menu opens on `/`, or that the AI placeholder is removed when a request fails — all three have shipped bugs. Needs `@testing-library/react` and `jsdom`; deliberately deferred rather than half-added. |
| **N16** | **Untested pure logic worth covering next**, roughly in value order: `lib/retention.ts` (a formula shown to students as a percentage), `lib/sessionCache.ts` (the TTL/versioning that already served a stale payload once and took Home down behind the error boundary), `ImageBlock`'s `parseTitle`/`buildTitle` round-trip, and `rag.strip_invalid_citations`' frontend counterpart. |

### The end-to-end audit

Separate from the list above and worth its own pass: walk every feature and
check that backend, API contract and frontend actually agree. The prompt for
it is the class of bug found today — **code that believes one thing while
the gate or the UI above it believes another**. Quizzes loading chat history
and then refusing to use it is the canonical example; there are likely more.

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
