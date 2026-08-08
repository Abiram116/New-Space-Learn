# Knowledge Model

The precise, schema-level companion to `SOUL.md`. `SOUL.md` makes the product
case for the normalized-tag architecture over the rejected concept-graph
schema; this document specifies exactly what that architecture *is*, so
"which table is authoritative for this number" is never a question anyone
has to re-derive from memory.

---

## 1. There is no "Knowledge Object" table, on purpose

The idealized template names a unified `Knowledge Object` that generation
produces and persistence stores. This model rejects that abstraction for the
same reason `AI_ENGINE.md §11` gives: a flashcard (SM-2 state), a quiz
question (a jsonb array element with `answer_index`), and a note (rich text)
are shaped too differently, and queried too differently, to benefit from a
shared polymorphic parent. **Each artifact type keeps its own table.** What
*is* shared across all of them is not a table — it's three properties every
artifact satisfies:

1. It belongs to exactly one subspace (`subspace_id` on every row).
2. It can carry **evidence** of where it came from (§2).
3. It can carry a **tag** naming what it's about (§3).

That's the entire "knowledge model" — not a new entity, three properties
layered onto entities that already exist.

---

## 2. Evidence — the provenance layer

Every artifact that makes a claim carries a pointer to where that claim came
from. This is `PRODUCT.md` Principle 3 made concrete, table by table:

| Artifact | Evidence column | Points at |
|---|---|---|
| Chat answer | `chat_messages.citations` (jsonb) | `document_id` + `locator` (page/offset) per cited source |
| Flashcard | `flashcards.source` | The document/passage it was generated from, if any |
| Quiz question | question object's `source` field (inside `quizzes.questions` jsonb) | Same — the passage that supports the correct answer |
| Quiz attempt | `quiz_results.answers` (jsonb) + `score` | The student's actual choices, immutable once submitted |
| Declared connection | `subspace_links` row | The student's own action of linking two subspaces — evidence *of intent*, not of content |

**The rule that makes this a doctrine and not a convention:** evidence is
never synthesized after the fact. A `source` or `locator` is written at the
moment the artifact is created, from the retrieval that grounded it — never
back-filled by asking a model "where might this have come from" later.

---

## 3. Tags — the concept substitute

A **concept**, in this model, is not a row with an id. It is a short string
— the `subtopic` already generated per quiz question (`QuizQuestion.subtopic`,
shipped) — matched by normalization, not by foreign key.

```
normalize(tag) = trim(tag).lowercase()
```

Two tags are "the same concept" if `normalize(a) == normalize(b)`. Displayed
using whichever original casing was written most recently — cosmetic only,
never affects matching.

**Where tags live today vs. where they're extending:**

| Artifact | Tag column | Status |
|---|---|---|
| Quiz question | `subtopic` (inside the `questions` jsonb array) | Shipped — generation prompt already requests it, frontend already renders it |
| Flashcard | *(none yet)* | Planned, `plan-backend.md §11` — same pattern, one more field on the generation prompt |
| Quiz choice (distractor) | *(none yet)* | Planned, `plan-backend.md §11` — required specifically for confusion pairs, see §4 below |
| Note | *(none yet)* | Not scheduled — no current feature needs a note-level tag; add only if one emerges |

**What this deliberately gives up, restated from `SOUL.md §5`:** "Bayes'
theorem" and "Bayes' rule" are different concepts to this model until a
human writes them identically, or a small curated synonym list is added
later. That is an honest, visible limitation of a cheap mechanism — not a
silently-wrong resolved entity from a merge algorithm nobody can audit.

---

## 4. Confusion relationships — the concrete shape

This is the one relationship in the model that needs slightly more schema
than "a tag on a row" — a wrong quiz answer needs to know *which concept the
wrong choice represented*, not just which concept the question was about.

**Planned schema change** (`plan-backend.md §11`, not yet built):

```jsonc
// quizzes.questions[i], before:
{ "q": str, "choices": ["Self-Attention", "Cross-Attention", "..."], "answer_index": 0, "source": str, "subtopic": "Attention Mechanisms" }

// after:
{ "q": str,
  "choices": [
    { "text": "Self-Attention", "concept": "Self-Attention" },
    { "text": "Cross-Attention", "concept": "Cross-Attention" }
  ],
  "answer_index": 0, "source": str, "subtopic": "Attention Mechanisms" }
```

**The read-time query this enables** (conceptually — see `plan-backend.md
§11` for the endpoint):

```sql
-- For every wrong answer this user has ever given, pair the concept they
-- should have picked with the concept they actually picked, and count it.
select
  normalize(q.choices[correct.idx]->>'concept') as correct_concept,
  normalize(q.choices[chosen.idx]->>'concept') as chosen_concept,
  count(*) as times_confused
from quiz_results r
join quizzes qz on qz.id = r.quiz_id
cross join lateral jsonb_array_elements(qz.questions) with ordinal position as q(question, i)
where r.user_id = :user_id
  and (r.answers->>(i-1))::int <> (question->>'answer_index')::int
group by 1, 2
having count(*) >= 3
order by times_confused desc;
```

(Illustrative — the shipped endpoint may unnest in Python rather than raw
`lateral` SQL depending on what the Supabase PostgREST wrapper supports
cleanly; the *result* is what matters: a ranked list of
`(correct_concept, chosen_concept, count)` tuples, computed with zero new
tables and zero LLM calls.)

**This is the entire "confusion relationship."** No edge table, no graph
traversal — a `GROUP BY` over two existing tables, gated at `count >= 3` so a
single unlucky guess never gets surfaced as a pattern.

---

## 4b. The Gap Map is a projection, not a structure

The Gap Map looks like a graph and is worth being precise about, because
"visualization shaped like a graph" and "graph stored in the database" are
easy to conflate — and this model stores neither a `concepts` table (§3) nor
any adjacency structure.

Per [ADR-0011](adr/0011-gap-map-derived-concept-visualization.md), every part
of the map is computed at render time from rows that already exist:

| Visual property | Derived from | Query shape |
|---|---|---|
| A node exists | a normalized tag appearing on any artifact | `distinct normalize(subtopic)` over `quizzes.questions` + tagged flashcards |
| Node size | how heavily the material covers that concept | `count(*)` of questions + flashcards per normalized tag |
| Node colour | current recall strength for that concept | quiz average grouped by normalized tag — `TopicSignal`'s computation, finer grain |
| An edge exists | a confusion pair between two tags | §4's aggregation, `count >= 3` |
| Edge thickness | the confusion tally | the same `count(*)` |
| "Also in another subject" flag | the same tag appearing under a second `subject_id` | `count(distinct subject_id)` per normalized tag |

**Nothing here is written back.** There is no graph table, no materialized
view, no cached layout, no adjacency list. The relational tables remain the
single source of truth (§6) and the map is assembled per request and
discarded with the response.

**Two consequences worth stating, because they're easy to get wrong at
implementation time:**

1. **Confusion pairs are the only edge source** — not merely a weight applied
   to some other edge. A student with no repeated confusions gets a map of
   nodes and no edges, which is a correct and expected state, not a bug.
2. **`subspace_links` is not an input to the map.** It keeps its original job
   — explicit, opt-in retrieval widening in `rag.retrieve_with_links` — and
   remains a `declared` relationship under §2. It is not a Gap Map edge,
   because a link between two *subspaces* says nothing about a relationship
   between two *concepts*.

## 5. Learning state and scheduling

Both are fully specified in `MEMORY_ENGINE.md §3` (Learning memory) and
`AI_ENGINE.md §14` (Scheduling) respectively — not repeated here. The one
fact worth restating in a knowledge-model context: **learning state is
always computed from evidence (§2) and tags (§3), never stored as its own
independent opinion.** A "weak area" is a `GROUP BY` over `quiz_results`
joined through `quizzes.topic`; a future "weak concept" is the same query
grouped by normalized `subtopic` instead. Same mechanism, finer grain — not
a new one.

---

## 6. Single source of truth — one table per fact, no exceptions

Every number this product is allowed to show must have exactly one
authoritative source. This table exists so that never has to be re-derived
under time pressure:

| Fact shown to a student | Authoritative source | Computed how |
|---|---|---|
| "You've studied N days in a row" | `daily_activity` | `streaks.py::compute_streak` over `day` rows |
| "You're weak on X" (subspace-level) | `quiz_results` joined through `quizzes` | `student_model.py::_quiz_signals`, min. 2 attempts |
| "You're weak on X" (concept-level, planned) | Same tables, grouped by normalized `subtopic` | `plan-backend.md §11` |
| "You've confused X with Y N times" (planned) | `quiz_results.answers` + tagged `choices` | §4 above |
| A card is due today | `flashcards.due_at` | Direct column read, no derivation |
| A citation's source | `chat_messages.citations[i]` / an artifact's `source` field | Written at generation time, never after |
| "This subspace relates to that one" | `subspace_links` | Direct row existence — the student created it |
| Every node, edge and thickness on the Gap Map | `quizzes`, `quiz_results`, `flashcards` | Aggregated at render time, never stored — see §4b |
| A Skill's behavior | `skills.instructions` / `memory_scope` / `output_format` / `capabilities` | Direct columns, no runtime inference |

If a future feature wants to show a number that isn't in this table, the
first question is which existing row it derives from — per
`retrospective.md`'s standing rule, if the honest answer requires inventing
a weighting formula, it doesn't ship until this table can name a row for it.
