# Implementation Plan

The sequenced build order for everything approved in this audit. Each phase
compiles, deploys, and demos independently — no phase leaves the product in a
half-migrated state.

**Scope note:** this plan covers the approved SOUL.md redesign
(`plan-backend.md §11–14` / `plan-frontend.md §17–19`) plus the engineering-
health fixes this audit surfaced. It does **not** re-plan the already-shipped
V1 epics, and it does not cover `plan-frontend.md §16` (the Higgsfield
cinematic pass), which is deliberately its own asset-generation session.

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
> | 0.7 browser verification | **Partially blocked.** Toast contrast and the landing font race are fixed and verified in-browser. The Notes editor and Profile empty state sit behind sign-in, which needs your credentials. |

**Why first:** two of these are correctness problems, not features, and one
of them (embeddings) invalidates any retrieval-quality measurement taken
before it lands. Building SOUL.md features on top of broken retrieval would
mean demoing confusion pairs over quizzes generated from arbitrary chunks.

| # | Task | Owner | Est. |
|---|---|---|---|
| 0.1 | **Wire a real embedding provider.** `embeddings.py::embed_texts` already isolates every caller — swap the stub for a real call, flip `USE_STUB_EMBEDDINGS=false` in `render.yaml`. Add a re-embed path for documents ingested under the stub (they hold meaningless vectors and will never retrieve correctly — `reprocess` already exists and does exactly this). | Dev A | 1–2 days |
| 0.2 | **Test `guards.py` ownership assertions.** `pytest`/`pytest-asyncio` are already declared but no test directory exists. Cover: each `assert_*` raises `NotFound` for a foreign id, returns the row for an owned one, plus the `_active_skills` no-user-filter assumption (`SECURITY.md §2`). | Dev B | 1–2 days |
| 0.3 | **Test SM-2 grading math** — `grade_card()`'s four grade branches, and (critically) that the Python and TypeScript implementations agree, since `REQUEST_PIPELINE.md` documents them as a deliberate duplication. | Dev B | 1 day |
| 0.4 | **Validate citation markers server-side.** Post-stream regex range-check, dropping/flagging out-of-range `[[n]]` before persisting (`AI_ENGINE.md §10`, `SECURITY.md §4.2`). | Dev A | half day |
| 0.5 | **Warm the app shell**, not just the landing page (`PERFORMANCE.md §6`) — fire the `/health` ping from `AppShell` mount too. | Dev A | 1 hour |
| 0.6 | **Gate `/api/v1/docs` behind an env flag** (`SECURITY.md §9`). | Dev A | 1 hour |
| 0.7 | **Click through the Notes editor in a real browser.** Rebuilt on Tiptap and **never visually verified** — flagged as the top priority by both `CHECKPOINT.md` and `design-plan.md §5`. Verify inline `/ai`, the toolbar, markdown round-tripping, and that no raw HTML or `**` reaches the screen. Also: Profile empty state, toast contrast (`plan-frontend.md §14`), landing font race + marquee gap (§15). | Dev B | 1 day |

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
| 1.1 | **Extend `subtopic` tagging to flashcard generation** (`plan-backend.md §11`, part 1) — same pattern already shipped for quiz questions. | Dev A | half day |
| 1.2 | **Change quiz `choices` to carry per-choice concept labels** — `list[str]` → `list[{text, concept}]` in the generation prompt and `QuizQuestion` schema. | Dev A | 1 day |
| 1.3 | **Backward-compatible read path.** Existing `quizzes.questions` rows hold bare-string choices. The quiz-taking UI and scoring must handle both shapes — this is the one place in the redesign where a migration-shaped problem exists, and the answer is a tolerant reader, not a data migration (old quizzes simply won't contribute to confusion pairs). | Dev A | 1 day |
| 1.4 | **Split `me.py`** (679 lines, largest backend file) into `me_brief.py` / `me_stats.py` / `me_student_model.py` **before** Phase 2 adds two more endpoints to it (`backlog.md`). | Dev B | 1 day |
| 1.5 | **Split `FlashcardsView.tsx`** (1046 lines, 9 components) — extract `Review`/`CardFace`/`Summary` and the modals into sibling files, before Phase 3 adds the exam-countdown surface. | Dev B | 1–2 days |
| 1.6 | **Measure `/me/stats` for real** and replace the simulated estimate (`PERFORMANCE.md §7`). | Dev B | 1 hour |

**Exit criteria:** new quizzes generate tagged choices; old quizzes still
take and score correctly; typecheck and tests green.
**Demo:** nothing user-visible — this is the one phase with no payoff on
screen. Keep it short and get through it, exactly as `SOUL.md §11` says
about its own Phase A.
**Parallelism:** genuinely clean here — Dev A owns the schema/prompt path,
Dev B owns refactors. No shared files.

---

## Phase 2 — Confusion pairs (1 week) ← **the demo phase**

**Why this is the priority:** `SOUL.md §8.1` ranks it highest on
pitch-value ÷ effort, no competitor does it, and `COST_MODEL.md §4` confirms
it costs $0 per use.

| # | Task | Owner | Est. |
|---|---|---|---|
| 2.1 | **`GET /me/confusion-pairs`** — aggregate `(correct_concept, chosen_concept)` from `quiz_results` × `quizzes`, normalized, `count >= 3` (`KNOWLEDGE_MODEL.md §4`). | Dev A | 2 days |
| 2.2 | **Feed it into the Home brief's suggestion** as one more candidate signal alongside lowest quiz average and overdue decks — reusing the existing selection logic, not adding a parallel one. | Dev A | 1 day |
| 2.3 | **Quiz-results confusion card** (`plan-frontend.md §17`) — "You've confused X with Y four times," wired to the existing per-question `source` so it links to the passage that separates them (the "backward edge" from `SOUL.md §7`). | Dev B | 2 days |
| 2.4 | **Empty/thin-data states.** With `count >= 3` gating, a new user sees nothing here for weeks. The card must be absent, not empty — and the brief must fall back cleanly. This is the `retrospective.md` standing-checklist item most likely to be skipped under demo pressure. | Dev B | half day |

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
concepts or tags). `SOUL.md §8.2` rates it the strongest *algorithmic* claim
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
| 3.3 | **Mirror the compression in the frontend's optimistic SM-2 copy** — non-negotiable, per `REQUEST_PIPELINE.md`: server-only compression would make every compressed card flash the wrong interval for one round trip. | Dev A | half day |
| 3.4 | **Honest-cram UI** — visible "compressed to fit your exam" indicator and an explanation of what got sacrificed. `SOUL.md §8.2` calls the honesty load-bearing, not optional. | Dev B | 2 days |
| 3.5 | **Flashcard grade-button interaction redesign** — flagged as "doesn't feel good" three times across `backlog.md`, `plan-frontend.md §7`, and `design-plan.md §3.5`, still unaddressed. This phase already touches the review surface; do it here rather than logging it a fourth time. | Dev B | 2 days |

**Exit criteria:** a subject with an exam 9 days out visibly compresses
intervals, server and client agree, and the UI explains the trade.
**Demo:** *"Your exam is in 9 days. Here's what actually fits, and here's
what I dropped to make it fit."*
**Note:** 3.1–3.3 are one serial chain owned by one dev — the SM-2 change
lands in two languages and splitting it across two people invites drift.

---

## Phase 4 — The Gap Map (1 week)

**Why last of the features:** it's the only one that reads *from* the others'
output. Per [ADR-0011](adr/0011-gap-map-derived-concept-visualization.md),
nodes are normalized concept tags and **confusion pairs are the only edge
source** — so Phase 2 is a hard prerequisite, not just a source of edge
weights. Nothing about the map is stored; it's a projection assembled per
request.

| # | Task | Owner | Est. |
|---|---|---|---|
| 4.1 | **`GET /me/gap-map?subject_id=`** — nodes per normalized tag (size = question + flashcard count; colour = quiz average by tag), edges reusing Phase 2's confusion aggregation, plus a cross-subject flag per tag. All `GROUP BY`, no new table (`plan-backend.md §13`). | Dev A | 2 days |
| 4.2 | **The view** (`plan-frontend.md §19`) — deliberately boring and readable. **Must be its own lazy route chunk** (`PERFORMANCE.md §2`: 245KB against a 250KB ceiling leaves ~5KB of headroom; a rendering library in a shared module blows the budget). | Dev B | 3 days |
| 4.3 | **The nodes-only state.** Before a student has three repeated confusions the map has no edges at all. This is correct, not empty — it must read as "nothing's gone wrong yet." Easiest thing to skip and most likely thing a fresh account sees. | Dev B | half day |
| 4.4 | **Verify the "five-second scan" goal** — if the eye doesn't go straight to the worst edge, it has failed its own design brief and needs another pass, not a prettier one. | Both | half day |

**Exit criteria:** the map renders from real data with no stored graph
structure; main bundle still ≤250KB gzipped; a thick problem edge is
identifiable at a glance; a fresh account sees a coherent nodes-only map.
**Demo:** *"Here's your revision plan, and here's why."*

---

## Phase 5 — Cross-subject transfer (3 days)

Only startable once Phase 2 has produced real repeated tags across more than
one subject (`plan-backend.md §14` — postponed deliberately, not forgotten).

| # | Task | Est. |
|---|---|---|
| 5.1 | Normalized-`subtopic` match across subjects; surface weakness propagation | 2 days |
| 5.2 | Brief integration: *"This is about to hurt you in another module."* | 1 day |

**Risk:** genuinely dependent on real usage data existing. If tags haven't
accumulated across subjects yet, **this phase should slip rather than be
demoed on synthetic data** — a fabricated cross-subject insight is exactly
the invented-metric mistake `retrospective.md §4` warns about.

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
  source (ADR-0011), so Phase 4 has nothing to draw without them.

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
| Refactors (1.4, 1.5) introduce regressions in untested UI | Medium | Medium | Sequence them *before* new features land in those files, so a regression is attributable to one change |
| Scope creep from `plan-frontend.md §16` (Higgsfield) | Medium | Medium — it's a whole session of asset work | Explicitly out of scope for this plan; schedule separately |

---

## Definition of done, per phase

Inherited from the engineering constitution and `retrospective.md`'s standing
checklist — a phase is not done until: it compiles and typechecks; its tests
pass; **it has been clicked through in a real browser** (the single most
repeated lesson in `retrospective.md` — "verify against the actual rendered
output, never against 'it typechecks'"); every number on screen traces to a
stored row; the empty/first-run and single-item states are handled; the
relevant living doc (`plan-backend.md`, `plan-frontend.md`, or the doc set
this audit produced) is updated in the same pass; and no known technical debt
is introduced without being logged in `backlog.md`.
