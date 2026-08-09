# The Soul

> Extends `PRODUCT.md`. Nothing here overrides a Brand Commitment or a Product
> Principle — it takes Principle 3 ("every claim is traceable") and pushes it
> one level deeper, from claims to *relationships*.

> **Reviewed 2026-08-09.** The original draft of this document (and its
> duplicate, `soulgpt.md`, now deleted) proposed a dedicated `concepts` +
> `concept_edges` graph schema as the implementation. That proposal was
> checked against the actual schema and code and rejected — see §6 and §11.
> The thesis, the promise, and the edge *doctrine* below are unchanged and
> still the north star. The graph is not.

---

## 1. The enemy

**The illusion of learning.**

You read 60 pages. It felt productive. The next morning the exam asks *"compare
A and B"* — and you can't. Not because you forgot; because you never learned it
in the first place. Recognition felt like knowledge, and you had no way to catch
the mistake before it counted.

That gap — between *"I've seen this"* and *"I could be tested on this"* — is
what every study tool ever built has failed to close. Highlighters make you feel
diligent. Notes make you feel organised. Chat products answer your question and
move on. None of them notice the day you stopped actually learning.

Space Learn is the tool that notices.

## 2. The thesis

**A syllabus is a list. An exam is a graph.**

Every course is delivered linearly — Week 1, Week 2, Chapter 4 — because that is
how teaching has to be sequenced. But nothing is ever *examined* linearly. Exam
questions are almost always relational:

- "Compare X and Y."
- "How does A affect B?"
- "Given C, derive D."
- "Why does E fail when F is true?"

Students are handed a **list** and tested on a **graph**. They revise by walking
the list top to bottom, and then get destroyed by a question that lives on an
edge nobody ever showed them.

**This is a claim about how exams are shaped, not a commitment to storing your
material as a graph database.** The distinction matters — see §5.

## 3. The promise

Every study session should answer one question:

> **"What is the single highest-value thing I could study in the next 20
> minutes?"**

Nobody solves that today. ChatGPT will answer whatever you ask, but it doesn't
know what you don't know. Anki will show you what's due, but its schedule can't
see your exam. Notion will hold your notes, but has no opinion on what to open.

Space Learn's promise is that opening the app is never a decision — it is a
verdict. The next twenty minutes are already chosen, and it can tell you exactly
why they were chosen, from *your* citations, *your* mistakes, *your* reviews.

## 4. The mechanism (what the engine is, once)

Because we need it named — but the student never sees this phrase again:

**We build a per-student model of understanding.**

Every question you ask, every card you grade, every quiz answer you pick — the
right one and the wrong one — updates it. That model is what powers the twenty-
minute verdict, the exam-day scheduling, the "you keep confusing these two"
callout.

Under the hood it is **tagged evidence rows on the tables that already exist** —
a chosen quiz answer, a link you drew yourself, a subtopic label attached to a
question at the moment it was written. Not a graph database. "Model of
understanding" describes what it does for the student, not how it's stored.

### The tension, and how it resolves

*Model of understanding* invites inference. *Evidence-only* forbids it. Both are
load-bearing. The resolution — this is the sentence that makes the whole
architecture work — is:

> **The positioning is "understanding." The implementation stays "evidence."
> Understanding is never a model's guess. It is measured, from citations you can
> click, mistakes you actually made, and reviews you actually did.**

Every claim the app makes about you can be traced to a row in a table. That is
what makes the model trustworthy enough for a lecturer to hand it to a cohort —
and it holds exactly as well with tagged rows as it would with a formal graph.
Auditability comes from provenance, not from schema shape.

### Why this is defensible

Every study app on earth organises material into folders and quizzes you on
cards. None of them model *what connects to what, for you specifically*. Anki
has no concept of relationship. Quizlet has no concept of your material. Notion
has structure but no recall. Chat products answer and forget.

The gap is real, and we are already 80% of the way to filling it without
realising: we retrieve passages, cite pages, schedule recall, and record quiz
outcomes. All the raw evidence is in the database. It is simply never assembled.

---

## 5. Structure: Subject → Subspace stays. "Concepts" are tags, not a table.

### The fork this section used to leave open — now resolved

The original draft asked whether to replace Subspace-as-folder with a first-class
`Concepts` entity (hybrid or full-graph). **Neither.** A third option beats both:
keep Subject → Subspace exactly as it is — it is RLS's ownership boundary, it is
what students already think in, and `0002-reject-concept-graph-schema.md` already independently
confirmed it shouldn't move — and treat a "concept" as **a short, normalized tag
string**, not a row with a UUID and a resolution problem.

Concretely: `subtopic` already exists on every quiz question, generated by the
same model call that writes the question, with zero extra cost
(`api/app/routers/quizzes.py`, `QuizQuestion.subtopic`). Extend that exact
pattern to flashcards and notes. That string *is* the concept. No entity
extraction, no merge/conflict resolution, no `concepts` table.

### The killer consequence, unchanged

*Bayes' theorem* appears in Statistics and in Machine Learning. Today those are
two unrelated subspaces holding two unrelated piles of cards. Once both tag
questions with the subtopic `"Bayes' theorem"` (normalized: trimmed, lowercased
for matching, displayed with its original casing), a single

```sql
group by lower(trim(subtopic))
```

across `quiz_results` joined through `quizzes` finds the pattern without ever
knowing the two subspaces are "the same concept" in any stored, resolved sense —
they just happen to use the same words. That is enough to say:

> **"You're shaky on Bayes' theorem in Statistics. It's load-bearing for the
> Naive Bayes lecture you have on Thursday."**

No folder structure can say that sentence. No graph table is required to say it
either — a matched string across two `group by`s is sufficient, and it is
honest about its own limits: if one subspace says "Bayes' theorem" and another
says "Bayes' rule," they won't match. That's an acceptable, visible limitation
of a cheap mechanism — not a hidden one, the way a wrong LLM-resolved entity
merge would be.

**What this gives up, stated plainly:** true synonym resolution ("Bayes' rule"
≠ "Bayes' theorem" to a string match). If this turns out to matter in practice —
not before — the cheapest next step is a small manually-curated synonym list,
not an NLP resolution pipeline. Revisit only with real evidence it's needed.

---

## 6. The edge doctrine — kept as a principle, corrected as an implementation

> **An edge must be evidenced. Never inferred by a model.**

This still stands. What changes is which edges are actually cheap, checked
against the real schema instead of assumed.

| Edge | Meaning | Verdict | Why |
|---|---|---|---|
| `declared` | You drew it yourself | **Built, unchanged** | Already exists as `subspace_links` — an explicit, opt-in join table, RLS-scoped. |
| `confused-with` | You reliably pick B when the answer is A | **Build — redesigned** | Requires tagging each quiz *choice* (not just the question) with a concept label at generation time. `quiz_results.answers` stores a chosen *index*; `choices` are bare strings (`schemas/__init__.py`) — there's no concept identity on a distractor today. This is a small, cheap addition (same LLM call), not data "already sitting there." |
| `co-cited` | Both concepts were drawn from the same passage | **Killed** | Not free. `rag.retrieve()` returns chunks keyed by `document_id`+`locator`, never by concept (`services/rag.py`). Deriving this needs either a new extraction call per chunk (real, recurring LLM cost) or a fragile keyword match against known subtopic strings. Revisit only if chunks ever get concept-tagged for an unrelated reason. |
| `co-failed` | You missed both in the same attempt | **Never build** | Low signal even if built — two questions wrong in one attempt correlates with quiz difficulty and rushing at least as much as with a real conceptual relationship. Not worth the schema or the query. |

Two of the four are real; two were priced wrong. `confused-with` is still the
single highest-value edge in the doctrine, and it's still cheap — just not for
the reason originally stated.

---

## 7. The loop, reframed

The five surfaces are currently siblings on a tab strip — which makes them read
as a feature list. They are actually **phases of one loop**, and the Map is what
closes it:

```
        ┌──────────────────────────────────────────┐
        │                                          │
   INGEST ──► INTERROGATE ──► CONSOLIDATE ──► REHEARSE ──► PROVE
    Docs         Chat            Notes          Cards      Quizzes
        │                                          │
        └───────────────► THE MAP ◄────────────────┘
                    (decides what happens next)
```

Today the loop runs forward only: chat → card. The soul upgrade is that it also
runs **sideways** (subtopic → matching subtopic elsewhere) and **backward** (a
failed quiz answer → the exact paragraph that would have fixed it). Neither
direction needs a graph table — sideways is a tag match (§5), backward is
already-stored `source` on quiz questions, just not wired into the results
screen yet.

> **Every wrong answer should link to the page that would have prevented it.**

Small work, outsized effect — it makes failure *productive* instead of just
scored.

---

## 8. The five things that make this best-in-class

Ranked by (pitch value ÷ effort), with the corrected mechanism for each.

### 1. Confusion pairs — *"how did it know that?"*
Tag each quiz choice with a concept label at generation time; aggregate
`(correct_concept, chosen_concept)` pairs from existing `quiz_results`. Surfaces
sentences like *"You've mixed up self-attention and cross-attention four
times."* No graph, no new tables — one schema tweak to the `choices` shape plus
one read-time aggregation query.
**Effort: small. Wow: enormous.** No competitor does this.

### 2. Exam-aware scheduling — *the honest cram*
SM-2 is calendar-blind. Add an `exam_date` column to `subjects` and compress
`grade_card()`'s interval math to fit the runway, with a visible, honest
explanation of what got sacrificed. **Fully independent of everything else in
this document** — it never needed concepts or edges at all.
**Effort: medium. Differentiation: very high.**

### 3. The Gap Map — *a diagnostic, not a hairball*
Concept-level, **derived at render time, never stored** — see
[ADR-0011](adr/0011-gap-map-derived-concept-visualization.md). Not a
force-directed graph. A deliberately **boring, readable** layout where:
- **node = a normalized concept tag** (§5's tag, not a stored entity); size =
  how heavily the material weights it (count of quiz questions + flashcards
  carrying that tag)
- **node colour = your current recall strength** — quiz average grouped by
  that tag, the same computation as `student_model.py`'s `TopicSignal` at
  finer grain
- **edge = a confusion pair between two concepts, thickness = the tally**
  (#1 above). This works because both concepts in a confusion pair come from
  the same question — see ADR-0011 for why the earlier subspace-level version
  of this was not computable
- **scope = one subject at a time**, for readability; a tag appearing in more
  than one subject is marked as such, which is how the map exposes §5's
  cross-subject consequence without a separate mechanism

The eye should go straight to a thick red edge between two big nodes. That is
your revision plan. **There is no graph database and no graph storage** — the
relational tables stay the single source of truth and the map is a projection
assembled per request and discarded, so nothing about it can ever go stale.

### 4. Cross-subject transfer — *the moment hierarchy can't produce*
One subtopic string, many subjects. Weakness propagates via §5's string match.
**Postponed** until #1 ships and there's real repeated-tag data to match against
— building this first, with no data yet, is building on nothing.

### 5. Provenance everywhere — *already built, under-sold*
Every card, note and quiz question tracing to `document · page` is the existing
moat. It should be visible on every artifact, not just chat answers. Pure UI
surfacing — no backend change.

---

## 9. What we deliberately will not build

A plan is only real if it says no. These are all tempting and all wrong for this
product:

- **A dedicated `concepts` / `concept_edges` graph schema.** Nothing in §8
  actually needs it, once checked against the real code. Building it anyway
  would be complexity spent on architecture instead of on the student.
- **A graph database, or any stored graph structure, to back the Gap Map.**
  The map is a *visualization* derived from relational rows at render time
  (ADR-0011). Needing to look like a graph is not a reason to store one.
- **`co-cited` edge derivation.** Priced as "free" in the original draft; it
  isn't, and the payoff doesn't clear the real cost. See §6.
- **`co-failed` edge derivation.** Low signal even at zero cost.
- **Any LLM-driven concept/entity extraction or resolution pipeline.** This is
  the same "months of work, research-grade" problem `0002-reject-concept-graph-schema.md` already
  rejected once, for the auto-organized-knowledge-graph proposal. It does not
  become a good idea the second time it's proposed, under a different name.
- **A pretty force-directed graph.** Beautiful, unreadable, universally
  abandoned. The Map earns its place by being diagnostic or it does not ship.
- **LLM-invented edges of any kind.** Poisons the one thing we have that
  competitors don't: auditability.
- **Social / sharing / public decks.** That is Quizlet's moat, built over 15
  years and millions of users. Competing there loses.
- **A mobile app.** Responsive web covers the actual use case (laptop, library,
  1am). A second codebase for a capstone is self-harm.
- **Real-time collaboration.** Enormous complexity, near-zero demo value for a
  solo-study product.
- **Gamification beyond honest streaks.** `PRODUCT.md` already forbids inflated
  numbers, and XP/leagues would violate it.

---

## 10. Free-tier engineering reality

Render free tier: one worker, 512MB, **spins down after 15 minutes**, no
background jobs. Supabase free: 500MB. These are hard constraints, and the
redesign in §5–§8 respects them better than the original graph proposal did —
there is no write-on-every-retrieval edge table, no recursive CTE, no new
table at all beyond a couple of columns.

| Constraint | Design response |
|---|---|
| No background workers | Confusion-pair and Gap Map data are computed **at read time** via plain SQL aggregation over existing tables — no derived table to keep in sync, nothing to write on the hot path of retrieval. |
| Cold start ~30s | **Warm the API from the landing page.** Fire a `/health` ping on load. Unrelated to this document's scope, but still the single highest-value performance trick available, and still costs one `fetch`. |
| 500MB database | No new tables means no new storage budget spent on this work at all — the entire redesign fits inside a few added columns. |
| Inline work only | Every new query here is O(rows for one user), read-only, no LLM call except the two structured-output tweaks (choice concept tags, subtopic-on-flashcards) that already happen inside an existing generation call. |
| Single worker | Follow the standing rule from `IMPLEMENTATION_PLAN.md`: independent reads go through `asyncio.gather`; a chain of reads against the *same* remote Postgres from one request does not, per the measured 1566ms-vs-1114ms lesson in `spaces.py`. |

---

## 11. Phasing — every phase ends in something demo-able, none require a graph

| Phase | Ships | Demo sentence |
|---|---|---|
| **A** | `subtopic` tagging extended to flashcards (already shipped for quiz questions) | *(invisible groundwork — nothing breaks)* |
| **B** | Confused-with: per-choice concept tags + aggregation endpoint, surfaced on quiz results and the Home brief | **"You've confused these four times."** ← lead the demo here |
| **C** | Exam-aware scheduling: `exam_date` on subjects + interval compression | "Your exam is in 9 days. Here's what fits." |
| **D** | The Gap Map — concept-level, derived at render time (ADR-0011) | "Here's your revision plan, and here's why." |
| **E** | Cross-subject transfer via subtopic string-match | "This is about to hurt you in another module." |

Concrete backend/frontend task breakdowns for A–E live in `IMPLEMENTATION_PLAN.md` and
`IMPLEMENTATION_PLAN.md` (same numbering convention as every other epic there) —
this document states the architecture; those state the work.

**RAG and agents are not a phase.** They are the substrate all of this runs on
and they already exist.

---

## 12. The landing page

The original draft proposed a 3D/SVG rendering of the concept graph as the
landing hero. **Dropped** — not on merit, but because `IMPLEMENTATION_PLAN.md` §16
already scoped a different, more concrete hero (a looping video scene) that
went through its own review and is already approved and sequenced. Two sibling
documents proposing two different hero mechanisms is exactly the kind of
drift `IMPLEMENTATION_PLAN.md` already warns about. Defer to §16.

The instinct behind the original proposal — *make the moat visible, don't just
claim it* — is still worth keeping, just aimed at the right place: the **Gap
Map itself**, inside the app, is the visible proof that claims are evidenced.
It doesn't need to also be the marketing page's hero.

---

## 13. The pitch

Five beats. Two minutes. The order is load-bearing — villain, insight,
mechanism, proof, moat.

1. **The villain** — *"The biggest problem in studying isn't forgetting. It's
   believing you've learned something when you haven't."* You read 60 pages,
   felt productive, then couldn't answer *"compare A and B"* on the exam. Every
   student in the room recognises this. That is the whole audience, in one
   sentence.
2. **The insight** — "You were given a list. You were tested on a graph." (A
   claim about how exams are shaped — see §2. Not a claim about our schema.)
3. **The mechanism** — "Space Learn builds a per-student model of understanding
   from what you upload, ask, get wrong, and review. Every study session, it
   tells you the single highest-value thing to do in the next twenty minutes —
   and it can show you exactly why."
4. **The demo** — upload a PDF → ask a question → answer arrives with
   `physiology-wk6.pdf · p.31` → app says *"you've confused this with X four
   times. Here's the paragraph that separates them."*
5. **The moat** — "Every claim about you traces to a citation, a card grade, or
   a specific quiz attempt. Nothing is a model's opinion. That is why a lecturer
   can hand it to a cohort."

### Selling it

The most saleable version is **not** a consumer app (you'd be fighting Quizlet's
distribution). It's the same engine pointed at an institution:

- A department uploads the actual course material once
- Every student gets a personal model over *the same trusted corpus*
- The lecturer gets the aggregate: **"73% of the cohort confuses these two
  concepts"** — which is genuinely valuable and nobody currently supplies it

That aggregate view is the thing worth money. Build the student product; the
institutional product is one query on top of it — and, notably, a much simpler
query on top of tagged rows than it would have been on top of a graph database.

---

## 14. Why this is resume-strong

Be able to tell these five stories in an interview:

1. **Positioning against implementation.** "Our positioning is that we build a
   model of the student's understanding. Our implementation forbids inferred
   relationships. Those pull against each other — 'understanding' invites a
   model to guess, and guessing is exactly what we don't do. I reconciled it by
   making every claim about the student traceable to a specific row of evidence:
   a citation they can click, a quiz answer they actually picked, a card grade
   they actually gave. The positioning is 'understanding.' The implementation
   stays 'evidence.' Both survive."

2. **An architectural opinion, defended — twice.** "I refused LLM-generated
   relationships in the knowledge graph once, when an external reviewer
   proposed auto-organizing everything into a graph. Then a later draft of our
   own internal vision doc quietly reintroduced the same idea as a `concepts`
   table. I checked its 'free' claims against the actual schema, found two of
   four were wrong, and killed the graph again — this time replacing it with
   two tag columns and three `GROUP BY` queries that keep the flagship feature
   at a fraction of the cost."

3. **Measurement over intuition.** "I parallelised four database calls and it got
   *slower* — 1566ms versus 1114ms — because concurrency forced new TLS
   handshakes to a remote Postgres while the sequential path reused one warm
   keepalive connection. I reverted it and wrote the numbers into the code so
   nobody re-optimises it wrongly."

4. **A product principle with teeth.** "The app is forbidden from showing a
   number it can't source. That killed some nice-looking dashboard ideas, and
   it's the reason a lecturer would let it near their students."

5. **Knowing when not to build the impressive-sounding thing.** "A graph
   database is a better interview anecdote than a tag column, right up until
   someone asks what it does that the tag column doesn't. I'd rather be able to
   answer that question than have the fancier architecture."

Those are senior-engineer answers. Very few capstones can supply them.

---

## 15. The fork — resolved

The original draft left open "how radical to go on hierarchy," offering a
choice between a hybrid concepts-inside-subjects model and a full graph
rearchitecture. **Neither.** Subject → Subspace stays completely unchanged.
"Concepts" are normalized tag strings on existing artifacts, not a new entity.
See §5 for the reasoning and §11 for the phased plan that follows from it.
