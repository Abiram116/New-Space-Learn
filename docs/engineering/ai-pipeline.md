# The AI pipeline

Everything between a student's question and what comes back: retrieval,
prompt construction, generation, and what is remembered afterwards.

This was four documents — `docs/engineering/ai-pipeline.md`, `docs/engineering/ai-pipeline.md`,
`docs/engineering/ai-pipeline.md` and `docs/engineering/ai-pipeline.md` — describing one subsystem from
four angles, each opening by explaining which of the other three it did not
repeat. That is a structure that costs a reader four decisions before they
learn anything, so they are one document with four parts.

---

## Part 1 — The engine

Latency figures marked "measured" come from comments already in the code
(`docs/plan.md`'s responsiveness work). Figures marked "estimated" are
reasoned from Groq's published inference characteristics and this stack's
known request shape, not measured in this project — treat them as planning
numbers, not SLAs, until someone times them for real.

---

### Pipeline overview

```
Upload → Parse → Chunk → Embed → Retrieve → [Hybrid Search: not built] → Context Build
   → Reason → [Citation Validation: partially built] → Artifact Generation
   → Learning State Update → [Scheduling] → Response
```

`[Knowledge Object]` from the idealized template doesn't appear as its own
stage — see §11 for why.

---

### 1. Upload

**Code:** `api/app/routers/documents.py::upload_document`

- **Purpose:** get a student's raw material into the system with the least
  possible friction, without ever losing the original bytes.
- **Input:** a multipart file (PDF, plain text, markdown, CSV, or an image),
  ≤20MB.
- **Output:** a `documents` row (`status=uploading` → `processing`), the raw
  file persisted to Supabase Storage at `{user_id}/{doc_id}/{filename}`.
- **Latency:** the row insert + storage upload happen before any processing,
  specifically so the client sees the document immediately (optimistic UI at
  the API layer, not just the frontend). Storage upload itself: **estimated
  200–800ms** depending on file size, dominated by the upload bandwidth to
  Supabase, not compute.
- **Cost:** $0 marginal — Supabase Storage on the free tier, no LLM call
  unless the file is an image (see §2).
- **Alternatives rejected:** a presigned-URL direct-to-storage upload (skips
  the backend hop entirely) would shave the upload latency further, but adds
  a second code path to keep in sync with the ownership-guard model and
  isn't worth it at today's file sizes (≤20MB) and request volume. Revisit
  only if upload latency is ever measured as a real complaint.

### 2. Parsing

**Code:** `api/app/services/embeddings.py::extract_pdf_text`,
`api/app/routers/documents.py::_extract_csv_text`, `_extract_image_text`

- **Purpose:** turn arbitrary file bytes into plain text, preserving enough
  structure (page numbers) to cite later.
- **Input:** raw bytes + MIME type.
- **Output:** a single text blob, PDFs tagged inline with `[p.N]` markers so
  chunk locators can reference a real page.
- **Latency:** PDF text extraction (`pypdf`) — **estimated 50–300ms** for a
  typical lecture-length PDF, pure CPU, no network. Image transcription is
  categorically different: it's a **vision-model LLM call**
  (`GROQ_MODEL_VISION`), so it inherits that stage's latency and cost (§9),
  not this one's.
- **Cost:** $0 for PDF/CSV/text. Image parsing costs one vision-model call —
  metered identically to a chat turn (`consume_llm_quota(cost=2)` in
  `upload_document`).
- **Alternatives rejected:** OCR for scanned (non-text) PDFs isn't built —
  `pypdf`'s `extract_text()` returns empty for a scanned page, and that
  document fails with "no readable text found" rather than silently
  producing garbage. Adding OCR (e.g. via the vision model, page-by-page) is
  a real, scoped future feature, not a gap in this stage's design — it needs
  its own cost/latency budget because it'd be one vision call per page, not
  per document.

### 3. Chunking

**Code:** `api/app/services/embeddings.py::chunk_text`

- **Purpose:** split extracted text into windows small enough to embed
  meaningfully and cite precisely, without cutting mid-sentence.
- **Input:** the full extracted text.
- **Output:** a list of `Chunk(index, content, locator)` — 900 characters
  (~200 tokens) per window, 120-character overlap, snapped to the nearest
  paragraph or sentence boundary within 40% of the window size.
- **Latency:** pure string operations — **estimated <10ms** for a typical
  document, irrelevant next to any other stage.
- **Cost:** $0.
- **Alternatives rejected:** token-based chunking (via a real tokenizer)
  would size windows more precisely against the embedding model's actual
  token limit, but pulls in tokenizer weights at cold start on a
  memory-constrained free-tier process — the character-based approximation
  costs a little chunking precision to keep the backend's cold-start light,
  a trade this codebase already makes consciously (`embeddings.py`'s own
  comment). Revisit only if chunk-boundary quality is ever measured as a
  real retrieval problem, not preemptively.

### 4. Embedding — real, local, and live

**Code:** `api/app/services/embeddings.py::embed_texts`, `EmbeddingProvider`,
`LocalBgeEmbeddingProvider`, `StubEmbeddingProvider`

- **Purpose:** turn each chunk into a vector that captures its meaning, so
  semantically similar text is geometrically close.
- **Input:** a batch of chunk strings.
- **Output:** a `vector(384)` per chunk (was `vector(1536)` — see below).
- **Status (updated by the 2026-08 end-to-end audit): live, not pending.**
  `supabase/migrations/20260810090000_embedding_dim_384.sql` is applied
  (`document_chunks.embedding` is `vector(384)`), `USE_STUB_EMBEDDINGS=false`
  in the active environment, and `document_chunks` holds real rows with real
  384-dim BGE vectors — confirmed live by running `rag.retrieve()` against an
  actual uploaded document (the Attention Is All You Need paper) and getting
  correctly-ranked, semantically relevant chunks back (similarity 0.71–0.75
  for a query about self-attention). [docs/decisions.md](../decisions.md)
  replaced the Phase-0.1 hosted OpenAI provider entirely, per an explicit
  product decision: $0 recurring cost, no external API dependency. Now
  **BGE-small-en-v1.5, quantized ONNX, via `fastembed`**, running
  in-process — no API key, nothing to provision.
- **Measured, not estimated, this time:** app baseline ~57–60MB, model
  marginal ~170–200MB loaded / ~230MB peak while embedding, combined
  ~250–290MB of Render's 512MB ceiling — full numbers and method in
  docs/decisions.md. ~10ms/chunk, ~3ms/query — not a bottleneck.
- **BGE-M3 evaluated and rejected for production, kept as an offline
  quality benchmark only.** ~2.2GB model weights alone — 4–8x the entire
  memory ceiling before the app is counted. Not a close call.
- **Already on.** The migration is applied and the flag is flipped in the
  active environment; this is the record of what turning it on required, kept
  for anyone standing up a fresh environment: apply
  `supabase/migrations/20260810090000_embedding_dim_384.sql` by hand in the
  Supabase SQL editor **first**, then set `USE_STUB_EMBEDDINGS=false`, then
  run `api/scripts/reembed_documents.py` once to backfill any chunks that
  were inserted under the stub.
- **Cold start:** a real, one-time cost this design accepts — ~15–24s on
  the very first run after a fresh deploy (import + model download), ~3.4s
  on subsequent cold-start wake-ups once the model is cached on disk.
  Measured, in docs/decisions.md.
- **Cost:** $0, permanently. No longer "in tension" with "free" — that
  tension is what this decision closed.
- **Alternatives rejected:** the hosted OpenAI provider (built, benchmarked,
  removed — see docs/decisions.md's "Alternatives considered"); BGE-M3 in production;
  a separate embedding microservice; offline/batch embedding (not needed —
  measured latency fits the existing 25s inline budget with room to spare).

### 5. Retrieval

**Code:** `api/app/services/rag.py::retrieve`, `retrieve_with_links`

- **Purpose:** given a question, find the chunks most likely to answer it.
- **Input:** the question text, a `subspace_id`, optionally a list of linked
  subspace ids.
- **Output:** top-k `Retrieved` objects (`document_id`, `document_name`,
  `content`, `locator`, `similarity`) — `k=4` for chat, `k=6` for
  quiz/flashcard generation.
- **Latency:** one embedding call (question only — small, fast even once
  real) + one `match_document_chunks` RPC (a single indexed Postgres query)
  + one `documents` lookup for names. **Measured pattern elsewhere in this
  codebase puts one warm Supabase round trip at ~150–257ms**; this stage is
  2–3 such round trips run sequentially (deliberately — see
  `docs/engineering/architecture.md`'s note on why `asyncio.gather` is *slower*
  against this specific remote Postgres).
- **Cost:** $0 beyond the embedding call this stage depends on — pgvector
  search itself has no metered cost on Supabase's free tier.
- **Alternatives rejected:** a dedicated vector database — see
  `docs/engineering/architecture.md`. Rejected on the same grounds: no measurable
  latency win at this data volume, and a second free-tier account to run out
  of.

### 5a. Real-corpus retrieval evaluation (2026-08 hardening pass)

**Code:** `api/scripts/bench_real_corpus.py`

§4 and §5 above are real and live, not stubbed or projected — but a single
retrieval query proves the pipe isn't broken, not that retrieval quality is
good. This closes that gap with a small, honest, real-corpus measurement:
18 hand-written questions, each checked by a human against the real, stored
`document_chunks` content for the one `chunk_index` that actually answers
it, run through the real production path
(`app.services.rag.retrieve` → the real `match_document_chunks` RPC, scoped
to the real `subspace_id` — not an offline cosine-similarity proxy).

**Corpus, as measured:** 3 real, fully processed documents, 80 real chunks —
a Java variables/typecasting lecture (13 chunks), a reinforcement-learning
lecture (15 chunks), and "Attention Is All You Need" (52 chunks). Model:
BGE-small-en-v1.5, 384-dim, real embeddings (§4).

**Result:** Recall@5 = 0.944, Recall@10 = 0.944, MRR = 0.713 (n=18).
17/18 questions found their gold chunk in the top 5; one missed the top 10
entirely — a question about the Transformer's positional-encoding *formula*
retrieved the two chunks immediately surrounding it (which discuss the
concept but not the equation itself) instead of the chunk with the formula.
That's a real, honest miss, not a fabricated one — recorded rather than
excluded.

**Limitations, stated plainly:** n=18 over 80 chunks is a smoke-eval, not a
statistically powered benchmark — it answers "does retrieval work at all, on
real content, through the real path," not "how does retrieval degrade at
scale." Re-run `bench_real_corpus.py` (or extend its `CASES`) as the real
document corpus grows. Full per-question results:
`api/scripts/bench_real_corpus_results.json`.

### 6. Hybrid search — not built, and here's the actual reasoning

Combining vector similarity with keyword/full-text search (e.g. Postgres
`tsvector` + rank fusion) catches exact-term matches a pure embedding search
sometimes misses — genuinely useful at scale. **Still not worth building —
the reasoning has changed, not the conclusion.** This section originally
deferred the decision until real embeddings existed and retrieval quality
could be measured (§4 was stubbed when this was written). That measurement
now exists (§5a): Recall@5 0.944, MRR 0.713 on real content through the real
path. That doesn't change the call — a `tsvector` generated column plus a
weighted-union query is still real, if genuinely small, implementation cost,
and nothing in §5a's one honest miss (a formula the embedding search placed
adjacent to, not on) looks like something exact-keyword matching would have
caught either. Revisit if the real corpus grows and a future real-corpus eval
shows a *specific, recurring* failure pattern keyword search would fix —
not on effort grounds alone.

### 7. Reranking — not built, same class of reasoning

A cross-encoder rerank pass over the top-20 candidates before returning the
top-4 is a real technique for improving precision at higher retrieval
volumes. At `k=4–6` over a single subspace's chunks (typically dozens to a
few hundred, not thousands), the extra model call's latency and cost are
unlikely to earn back a meaningful quality gain — there usually aren't 20
plausible candidates to rerank between. Revisit if a subspace's chunk count
grows an order of magnitude *and* real embeddings (§4) show precision is
still a measured problem at that volume.

### 8. Context building

**Code:** `api/app/services/rag.py::build_prompt`

- **Purpose:** assemble everything the model needs into one message list —
  voice, grounding rules, sources, history, the question — without letting
  any of it silently balloon.
- **Input:** subspace name, active Skills' instructions, chat history,
  retrieved chunks, the student's `answer_only_from_docs` /
  `always_show_citations` settings, the Student Model's formatted context.
- **Output:** `(messages, citations_meta)` — the message list for the LLM
  call, and a parallel structure the frontend uses to render source cards
  independent of the model's own output.
- **Latency:** pure string assembly, **<5ms**, not a meaningful contributor.
- **Cost:** $0 directly, but this stage determines the token count of the
  *next* stage's LLM call — the real cost lever. History is capped at the
  last 8 turns specifically to bound this.
- **Alternatives rejected:** letting each Skill define its own full system
  prompt (rather than a shared voice + an appended instruction fragment) was
  rejected during the Skills-as-behavior-package redesign
  (`docs/plan.md`'s cross-cutting Voice & Identity note) — a shared
  `COMPANION_VOICE` fragment is what makes every surface sound like one
  mentor instead of a different assistant per feature.

### 9. Reasoning

**Code:** `api/app/services/llm.py::GroqLLM`, `StubLLM`

- **Purpose:** generate the actual response — a chat reply, quiz questions,
  flashcard pairs, an inline note edit.
- **Input:** the message list from §8.
- **Output:** a token stream (chat) or a JSON blob parsed into a typed
  structure (quiz/flashcards).
- **Latency:** Groq's whole product thesis is fast inference on these model
  sizes — **estimated 300–600ms time-to-first-token, then well over
  100 tokens/sec** for the 70B tier on Groq's LPU hardware; the 8B tier is
  faster still. Not measured in this repo, but consistent with Groq's
  published throughput for these model families.
- **Cost:** the real recurring cost of the product. Priced per-tier in
  `docs/operations/performance-and-cost.md` §2.
- **Alternatives rejected:** a single model tier for everything was rejected
  early — `GROQ_MODEL_FAST` (8B) exists specifically so the Home brief and
  subspace-naming calls (short, low-stakes output) don't pay 70B latency
  and quota for work an 8B model handles fine. This tiering *is* the cost
  optimization; see `docs/operations/performance-and-cost.md`.

### 10. Citation validation — built (Phase 0.4)

- **Instruction layer:** the model is told to mark citations as `[[n]]`
  matching the numbered sources block, and explicitly not to invent citations
  (`rag.py::build_prompt`).
- **Enforcement layer:** `rag.strip_invalid_citations()` runs once the stream
  completes and removes any marker outside `1..len(citations_meta)`, tidying
  the whitespace and punctuation the removal leaves behind. An instruction is
  not a guarantee — a model can emit `[[7]]` when four sources were provided,
  and a marker resolving to nothing is worse than no marker at all: it renders
  as a citation the student can't click, which reads as a broken promise.
- **Reconciliation:** tokens stream raw, so a stripped marker would leave the
  client's buffer disagreeing with what was stored. The `done` event carries
  the canonical `content` and `ChatView` prefers it, so the bubble matches
  what a refresh would show.
- **Cost/latency:** one regex pass over text already in memory, after the last
  token. Nothing added to time-to-first-token, no extra model call.
- **Observability:** dropped markers are logged with the source count, so how
  often this actually fires is measurable rather than assumed.
- **Alternatives rejected:** a second LLM call to "verify" citations against
  source text would catch more subtle issues (a citation that's in-range but
  doesn't actually support the claim) but doubles the cost of every chat
  turn for a failure mode that hasn't been observed or measured yet.
  Post-hoc range-checking is the right first move; a verification model call
  is not justified without evidence range-checking isn't enough.
- **That failure mode is now observed, once, and recorded rather than
  fixed (2026-08 hardening pass):** asked "what programming language was the
  Transformer's reference implementation written in?" against the real
  Attention Is All You Need corpus, the model answered "Python, using the
  Tensor2Tensor and TensorFlow libraries [[3]]." Marker 3 correctly resolves
  to a real, topically relevant passage — the paper does credit the
  reference implementation to "our original codebase and tensor2tensor" —
  but that passage never says Python or TensorFlow; those are true facts
  about Tensor2Tensor supplied from the model's outside knowledge, attached
  to a syntactically valid citation. Range-checking cannot catch this by
  construction: the marker *is* in range and *does* point at relevant
  material, so `strip_invalid_citations` correctly leaves it alone. This is
  one observation, not a measured rate, and doesn't on its own justify the
  verification-call cost rejected above — recorded so a future measurement
  pass has a concrete example to test against rather than a hypothetical.
- **The refusal path was also checked, and holds:** asked a question with no
  connection to the corpus at all ("What is the recommended internal
  temperature for cooking chicken?") against the same subspace, the model
  correctly declined — "The sources provided do not cover the topic of
  cooking chicken..." — with zero citation markers, even though `retrieve()`
  still returned its usual k=4 chunks (low similarity, ~0.47–0.49, but
  `retrieve()` doesn't itself threshold on similarity — see §5). The
  `answer_only_from_docs` prompt instruction is what does the actual
  refusing here, and on this real check it worked.

### 11. "Knowledge Object" — deliberately not a stage

The idealized pipeline names a unified "Knowledge Object" between generation
and persistence. This codebase doesn't have one, on purpose: a flashcard, a
quiz, and a note are different enough in shape (SM-2 state vs. a jsonb
question array vs. rich-text content) and different enough in how they're
queried that forcing them through one polymorphic table would be a premature
unification with no current consumer needing to query across artifact
types generically. Each artifact keeps its own table and its own lifecycle.
See `docs/engineering/ai-pipeline.md` for the actual single-source-of-truth model this
codebase uses instead (tagged evidence rows, not a unified object).

### 12. Artifact generation

**Code:** `api/app/routers/flashcards.py::generate_cards`,
`quizzes.py::generate_quiz`, `notes.py` (inline `/ai`)

- **Purpose:** turn a chat session or a topic into something the student can
  study from directly.
- **Input:** a `subspace_id`, real retrieved context (`rag.retrieve`), recent
  chat history, the Student Model's context — never a bare topic string
  handed to the model on faith (`docs/plan.md` §2's grounding fix).
- **Output:** a full deck (N flashcards), a full quiz (N questions, each with
  `answer_index`, `source`, `subtopic`), or an inline note edit.
- **Latency:** one LLM call at the `groq_model` (70B) tier — reasoning over
  real context is treated as genuinely different work from the brief's
  template-filling, and deliberately not downgraded to the fast tier for
  cost reasons without checking output quality first (`docs/plan.md`'s
  explicit note).
- **Cost:** metered at `cost=2` (double a chat turn) via
  `consume_llm_quota` — priced in `docs/operations/performance-and-cost.md` §3.
- **Alternatives rejected:** generating one card per chat reply (the
  original behavior) was rejected and replaced with whole-deck generation —
  "an agent asked for cards should produce a deck," per `PRODUCT.md`'s own
  documented deficiency list.

### 13. Learning state

**Code:** `api/app/services/student_model.py`, `flashcards.py`'s SM-2 fields

- **Purpose:** the durable record of what a student is good at, weak at, and
  how each card is scheduled — the substrate the "twenty-minute verdict"
  (`docs/product/vision.md §3`) is computed from.
- **Where it lives:** distributed across existing tables, not centralized —
  `flashcards.ease/interval_days/reps/due_at` (SM-2 state), `quiz_results`
  (grouped into `TopicSignal` weak/strong areas at read time), `user_settings
  .student_model` (explicit preferences), `daily_activity` (streak). See
  `docs/engineering/ai-pipeline.md` for the full lifecycle of each.
- **Update rule:** every value is computed fresh from stored facts on every
  read (`student_model.get()`) — nothing here is cached in a way that could
  drift from the underlying rows, per the same discipline that keeps
  `/me/brief` honest.
- **Cost:** $0 — pure SQL aggregation, no LLM call.

### 14. Scheduling

**Code:** `api/app/routers/flashcards.py::grade_card` (today);
`docs/plan.md` (exam-aware compression, not yet built)

- **Purpose:** decide when a card comes due again.
- **Algorithm today:** SM-2-lite — ease/interval adjustment per grade
  (`again`/`hard`/`good`/`easy`), no calendar awareness.
- **Planned:** compress the computed interval when it would land after a
  subject's `exam_date` — purely additive, no change to the base algorithm.
- **Cost:** $0 — arithmetic, no LLM call, no new table.

### 15. Response

- **Chat:** Server-Sent Events (`text/event-stream`) — `citation` events
  before generation starts, `token` deltas during, `done`/`error` at the
  end. Chosen specifically so a long reply never sits fully buffered in
  process memory (a real constraint on a 512MB instance).
- **Generation (quiz/flashcards/notes):** plain JSON — these need the full
  parsed, validated structure before the client can render anything useful
  (a half-parsed quiz question isn't renderable), so streaming would add
  complexity without a UX win.
- **Alternatives rejected:** streaming quiz/flashcard generation
  token-by-token (matching chat's pattern) was implicitly rejected by never
  being built — correctly, since the client can't act on a partial JSON
  array until it's valid, unlike chat text which is readable mid-sentence.

---

### Summary table

| Stage | Built? | Latency (measured/estimated) | Marginal cost |
|---|---|---|---|
| Upload | Yes | ~200–800ms (est.) | $0 |
| Parsing | Yes (text); vision path costs an LLM call | 50–300ms text / LLM-call latency for images | $0 text / metered for images |
| Chunking | Yes | <10ms (est.) | $0 |
| Embedding | Local (BGE-small ONNX) wired; **flag off pending the vector(384) migration** | µs (stub) / ~10ms/chunk (real, measured) | $0, permanently |
| Retrieval | Yes | ~300–700ms (2–3 sequential round trips, est.) | $0 |
| Hybrid search | **Not built — sequenced after real embeddings** | — | — |
| Reranking | **Not built — not justified at current scale** | — | — |
| Context building | Yes | <5ms | $0 |
| Reasoning | Yes | 300–600ms TTFT + streaming (est.) | Priced in `docs/operations/performance-and-cost.md` |
| Citation validation | Yes (Phase 0.4) | one regex pass, post-stream | $0 |
| Artifact generation | Yes | one 70B call | 2x a chat turn's quota cost |
| Learning state | Yes | computed at read time | $0 |
| Scheduling | Yes (SM-2); exam-aware compression planned | <1ms | $0 |
| Response | Yes (SSE + JSON) | — | $0 |

---

## Part 2 — What the system knows

---

### 1. There is no "Knowledge Object" table, on purpose

The idealized template names a unified `Knowledge Object` that generation
produces and persistence stores. This model rejects that abstraction for the
same reason `docs/engineering/ai-pipeline.md §11` gives: a flashcard (SM-2 state), a quiz
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

### 2. Evidence — the provenance layer

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

### 3. Tags — the concept substitute

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
| Flashcard | *(none yet)* | Planned, `docs/plan.md` — same pattern, one more field on the generation prompt |
| Quiz choice (distractor) | *(none yet)* | Planned, `docs/plan.md` — required specifically for confusion pairs, see §4 below |
| Note | *(none yet)* | Not scheduled — no current feature needs a note-level tag; add only if one emerges |

**What this deliberately gives up, restated from `docs/product/vision.md §5`:** "Bayes'
theorem" and "Bayes' rule" are different concepts to this model until a
human writes them identically, or a small curated synonym list is added
later. That is an honest, visible limitation of a cheap mechanism — not a
silently-wrong resolved entity from a merge algorithm nobody can audit.

---

### 4. Confusion relationships — the concrete shape

This is the one relationship in the model that needs slightly more schema
than "a tag on a row" — a wrong quiz answer needs to know *which concept the
wrong choice represented*, not just which concept the question was about.

**Planned schema change** (`docs/plan.md`, not yet built):

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

**The read-time query this enables** (conceptually — see `docs/plan.md` Phase 2 for the endpoint):

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

### 4b. The Gap Map is a projection, not a structure

The Gap Map looks like a graph and is worth being precise about, because
"visualization shaped like a graph" and "graph stored in the database" are
easy to conflate — and this model stores neither a `concepts` table (§3) nor
any adjacency structure.

Per [docs/decisions.md](../decisions.md), every part
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

### 5. Learning state and scheduling

Both are fully specified in `docs/engineering/ai-pipeline.md §3` (Learning memory) and
`docs/engineering/ai-pipeline.md §14` (Scheduling) respectively — not repeated here. The one
fact worth restating in a knowledge-model context: **learning state is
always computed from evidence (§2) and tags (§3), never stored as its own
independent opinion.** A "weak area" is a `GROUP BY` over `quiz_results`
joined through `quizzes.topic`; a future "weak concept" is the same query
grouped by normalized `subtopic` instead. Same mechanism, finer grain — not
a new one.

---

### 6. Single source of truth — one table per fact, no exceptions

Every number this product is allowed to show must have exactly one
authoritative source. This table exists so that never has to be re-derived
under time pressure:

| Fact shown to a student | Authoritative source | Computed how |
|---|---|---|
| "You've studied N days in a row" | `daily_activity` | `streaks.py::compute_streak` over `day` rows |
| "You're weak on X" (subspace-level) | `quiz_results` joined through `quizzes` | `student_model.py::_quiz_signals`, min. 2 attempts |
| "You're weak on X" (concept-level, planned) | Same tables, grouped by normalized `subtopic` | `docs/plan.md` |
| "You've confused X with Y N times" (planned) | `quiz_results.answers` + tagged `choices` | §4 above |
| A card is due today | `flashcards.due_at` | Direct column read, no derivation |
| A citation's source | `chat_messages.citations[i]` / an artifact's `source` field | Written at generation time, never after |
| "This subspace relates to that one" | `subspace_links` | Direct row existence — the student created it |
| Every node, edge and thickness on the Gap Map | `quizzes`, `quiz_results`, `flashcards` | Aggregated at render time, never stored — see §4b |
| A Skill's behavior | `skills.instructions` / `memory_scope` / `output_format` / `capabilities` | Direct columns, no runtime inference |

If a future feature wants to show a number that isn't in this table, the
first question is which existing row it derives from — per
`docs/plan.md`'s standing rule, if the honest answer requires inventing
a weighting formula, it doesn't ship until this table can name a row for it.

---

## Part 3 — Memory

Five layers, ordered from most ephemeral to most durable. Each maps onto
real, already-shipped code — this document names what exists, it doesn't
propose a new subsystem.

---

### 1. Conversation memory

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

### 2. Session memory

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

### 3. Learning memory

**What it is:** the durable, per-student model of understanding — the thing
`docs/product/vision.md §4` calls "the mechanism," implemented exactly as tagged evidence
rows, never as a cached derived value.

| | |
|---|---|
| **Storage** | Distributed, not centralized: `flashcards.ease/interval_days/reps/due_at` (SM-2 scheduling state, one row per card); `user_settings.student_model jsonb` (explicit fields: learning style, session length, exam context, teaching preference); computed-on-read `TopicSignal` (weak/strong areas, grouped from `quiz_results` joined through `quizzes`) |
| **Lifetime** | Indefinite for explicit fields and SM-2 state (they're the point — this is what "the app remembers you" means). Computed signals have no independent lifetime at all — see Update rule |
| **Retrieval** | `student_model.py::get()` — three reads (`user_settings`, quiz-grouped signals, activity days) run concurrently via `asyncio.gather`, because unlike the sequential-is-faster pattern elsewhere, these three don't share a request-response dependency chain worth serializing |
| **Update rule** | **Computed signals are never stored — they're recalculated from raw rows on every single read.** This is the same discipline that keeps `/me/brief` honest (`docs/plan.md`'s `fullness()` lesson: an invented or cached metric can silently drift from what's actually true; a query can't). Explicit fields update via `set_explicit()`, a targeted `PATCH` merge into the `student_model jsonb` blob |
| **Expiration** | None. This is the one memory layer that should never expire — it's the whole product's value proposition compounding over a semester |
| **Why it exists** | This is what's injected into every chat/agent/brief prompt (`format_for_prompt()`) so the model always has "what you know about this student" without the student re-explaining themselves each session — the literal implementation of `vision.md`'s "a mentor who remembers," built entirely from facts, never from a model's summary of a conversation |

**What's deliberately *not* in this layer:** a summarized/compressed history
of past conversations. The temptation is an LLM-generated "here's what this
student tends to struggle with" summary, refreshed periodically — rejected,
because it reintroduces exactly the unfalsifiable-model-opinion problem
`docs/product/vision.md §6`'s edge doctrine forbids. Every fact in Learning memory traces to
a real row (a grade, a quiz answer, a setting the student typed), never to a
model's inference about the student.

---

### 4. Project memory

**What it is:** the material itself — documents, and everything generated
from them, scoped to the Subject → Subspace hierarchy.

| | |
|---|---|
| **Storage** | `documents` + `document_chunks` (source material and its embeddings), `notes`, `decks`/`flashcards`, `quizzes`, `skills` attached via `subspace_skills`, and `subspace_links` (explicit cross-subspace references) |
| **Lifetime** | Indefinite, and cascades — every one of these tables has `on delete cascade` to its owning subspace/user, confirmed in `20260803120000_init.sql`. Deleting a subspace deletes everything grown from it; deleting a user's account deletes everything they own, in one Admin API call (`docs/plan.md`'s delete-account note) |
| **Retrieval** | Always subspace-scoped by default (`rag.retrieve`); explicitly widened only via `subspace_links` (`retrieve_with_links`) — a student must have drawn the connection themselves |
| **Update rule** | Documents are write-once-then-reprocessable (a new upload creates a new row; `reprocess` re-derives chunks for an existing one). Notes/cards/quizzes are directly mutable by the student or by an agent call, with no distinction in the editor between the two origins (`docs/plan.md`'s "one editor, two authors" principle) |
| **Expiration** | None — this is the student's actual work product. The only deletions are explicit (student deletes a document/deck/note) or cascading (parent subspace deleted) |
| **Why it exists** | This is the actual "single source of truth" — every citation, every card, every quiz question traces back to a specific row here, which is what makes the product's central claim (`PRODUCT.md` Principle 3) checkable rather than asserted |

---

### 5. Review memory

**What it is:** the historical record of how a student performed — the raw
evidence Learning memory's signals are computed from, and the layer the
../product/vision.md-derived confusion-pair feature reads directly.

| | |
|---|---|
| **Storage** | `quiz_results` — one **immutable, append-only** row per attempt (`answers jsonb`, `score`, `submitted_at`); `daily_activity` — one row per user per day, incrementally bumped (`chat_messages`/`cards_reviewed`/`quizzes_taken`/`study_seconds` counts) |
| **Lifetime** | Indefinite for `quiz_results` — every attempt is kept forever, which is exactly what makes "you've confused these two four times" a real, countable fact rather than an impression. `daily_activity` rows are also kept indefinitely (they're the streak/heatmap's raw material) |
| **Retrieval** | Grouped and aggregated at read time — `student_model.py`'s `_quiz_signals()` for weak/strong areas, `streaks.py::compute_streak` for the activity heatmap, and (once built) `docs/plan.md`'s confusion-pair aggregation over the same `quiz_results` rows |
| **Update rule** | Append-only for quiz attempts — a resubmitted quiz creates a new `quiz_results` row, it does not overwrite the old one. **Asymmetry worth stating plainly:** flashcard grading is the opposite — `grade_card()` overwrites `ease`/`interval_days`/`reps`/`due_at` *in place* on the same row, with no log of past grades kept. This is intentional, not an oversight: no current or planned feature needs a flashcard's grade *history*, only its current SM-2 state (even the P3 "predicted-retention estimate" backlog item only needs current ease + interval + time-since-last-review, not a trend line) |
| **Expiration** | None for either table |
| **Why it exists** | This is the layer that makes the product's flagship claim possible: "you picked the wrong answer three times" is only a fact because every attempt, right or wrong, was kept — not summarized, not overwritten |

---

### Summary table

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
Learning memory honest, and it's the same boundary `docs/product/vision.md`'s edge doctrine
states for a different part of the system — one principle, applied twice.

---

## Part 4 — Request lifecycles

---

### Notes

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
   in the editor, matching `docs/plan.md`'s "one editor, two
   authors" requirement.

**A defensive step worth knowing about if you touch this path:** the model
is instructed to emit plain markdown, never HTML (Tiptap is configured
`html: false`, so a stray `<p>` would otherwise render as literal visible
text in a student's note). `_demote_html()` converts the common tags anyway,
as a second layer — "instructing the model is necessary but not sufficient,"
per its own comment. If you change the inline-AI prompt, keep this function;
it's cheap insurance against a regression that's already happened once.

**Storage shape:** `body_md` stayed a markdown string (see the correction
logged in `docs/plan.md`) — rendered through `tiptap-markdown`, not a
structured `jsonb` document. Every write path above produces markdown.

---

### Flashcards

Two independent lifecycles share one table: **authoring** a deck, and
**reviewing** it.

#### Authoring
- `POST /subspaces/{id}/decks` → empty deck shell, immediate UI feedback.
- `POST /subspaces/{id}/cards/generate` → whole-deck generation in one call
  (grounded in `rag.retrieve` + recent chat + Student Model context),
  producing N cards atomically rather than the one-card-per-reply behavior
  `PRODUCT.md` documents as a fixed deficiency.
- `POST /decks/{id}/cards` / `PATCH /cards/{id}` → manual single-card
  authoring, same table, same shape as a generated card.

#### Review — the one flow with real optimistic UI
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
   scheduling (`docs/plan.md`) must update both copies** — adding
   interval compression only server-side would make every compressed card
   flash the *uncompressed* interval for one round trip before correcting,
   a visible regression of the exact property this comment protects.
5. Server-confirmed grade updates `ease`/`interval_days`/`reps`/`due_at` and
   bumps `daily_activity` — which is what the Home brief and streak reflect
   on next load, via the session cache's explicit invalidation (below).

---

### Quizzes

No optimistic path here — a quiz's questions must be fully valid JSON before
anything renders, so unlike chat, there is nothing meaningful to stream or
optimistically show.

1. `POST /subspaces/{id}/quiz/generate` — same grounding discipline as
   flashcards (real retrieval, real history, typed `NothingIndexed` on empty
   retrieval). Each question is generated with `answer_index`, `source`, and
   `subtopic` in one shot — `subtopic` is the field `docs/plan.md`
   already shipped and `§11`'s confusion-pair work will read from.
2. Student answers client-side, no request per answer.
3. `POST /quizzes/{id}/submit` — the **only** point of server contact after
   generation. Scoring happens server-side (`answer_index` comparison,
   never trust a client-computed score), `quiz_results` gets one new,
   immutable row (never an update — see `docs/engineering/ai-pipeline.md §5`'s append-only
   note), `daily_activity` is bumped.
4. Results render from the response (`score`, `correct[]`) — no second
   fetch needed.

---

### Review & scheduling — how one grade becomes tomorrow's brief

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
Home surfaces "N cards due" and, once ../plan.md §1 ships fully,
a specific suggested next action
```

Nothing here is pushed — every layer re-reads the tables it needs on its own
request. The only thing that makes this feel instant rather than
recomputed-every-time is the session cache (`docs/engineering/ai-pipeline.md §2`), and that
cache is explicitly cleared on exactly the two writes that would make it
lie: card grading and quiz submission (`docs/plan.md`'s Responsiveness
note). This is worth stating as a rule for any new write path: **if a new
endpoint changes a number `/me/stats` or the brief surfaces, it must clear
that cache key, or a student will see a stale number for up to the TTL.**

---

### Error handling, as it actually surfaces per flow

The envelope itself (`{ "error": { "code", "message" } }`) is specified once
in `docs/engineering/architecture.md` and not repeated here. What's specific to each flow
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
