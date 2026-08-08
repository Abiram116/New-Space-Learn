# AI Engine

The complete pipeline, stage by stage, as it actually exists in this codebase
— not an idealized template. Where a commonly-templated stage (hybrid search,
reranking, a formal "Knowledge Object") isn't built, that's stated explicitly
with the reasoning, per `SOUL.md`'s standing rule: don't build the
impressive-sounding thing without a real, current consumer for it.

Latency figures marked "measured" come from comments already in the code
(`plan-backend.md`'s responsiveness work). Figures marked "estimated" are
reasoned from Groq's published inference characteristics and this stack's
known request shape, not measured in this project — treat them as planning
numbers, not SLAs, until someone times them for real.

---

## Pipeline overview

```
Upload → Parse → Chunk → Embed → Retrieve → [Hybrid Search: not built] → Context Build
   → Reason → [Citation Validation: partially built] → Artifact Generation
   → Learning State Update → [Scheduling] → Response
```

`[Knowledge Object]` from the idealized template doesn't appear as its own
stage — see §11 for why.

---

## 1. Upload

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

## 2. Parsing

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

## 3. Chunking

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

## 4. Embedding — the pipeline's actual weak point

**Code:** `api/app/services/embeddings.py::embed_texts`, `_stub_embedding`

- **Purpose:** turn each chunk into a vector that captures its meaning, so
  semantically similar text is geometrically close.
- **Input:** a batch of chunk strings.
- **Output:** a `vector(1536)` per chunk.
- **Status (updated 2026-08-09): the provider is wired; the switch is off.**
  Phase 0.1 replaced the `TODO` with a real OpenAI-compatible client
  (batching, index-ordered results, dimension checking, typed errors), but
  `USE_STUB_EMBEDDINGS=true` remains set in the local `.env`, `.env.example`,
  and `render.yaml` because **no `EMBEDDING_API_KEY` is provisioned in any
  environment**. Until one is, every call still routes through
  `_stub_embedding()` — a deterministic hash, explicitly "not semantically
  meaningful" — so **retrieval returns chunks in an arbitrary-but-consistent
  order, not by relevance.**
- **Turning it on:** set `EMBEDDING_API_KEY`, set `USE_STUB_EMBEDDINGS=false`,
  then run `api/scripts/reembed_documents.py` once — documents ingested under
  the stub keep their meaningless vectors otherwise, and nothing about them
  looks broken from the outside.
- **Fails safe by design:** `Settings.real_embeddings_enabled` requires the
  flag *and* a key. Flipping the flag alone logs a loud one-time warning and
  keeps using the stub, rather than failing every upload after the file is
  already stored.
- **Latency (stub):** microseconds, pure hashing. **Latency (real, once
  wired):** a network call to an embedding provider — **estimated
  100–300ms** for a small batch, run once per uploaded document (not per
  chat turn — only the *question* needs embedding at query time, which is a
  single short string).
- **Cost (stub):** $0. **Cost (real):** priced in `COST_MODEL.md` §1 — this
  is the one stage where "free" and "real" are currently in direct tension,
  because Groq doesn't host an embedding endpoint on this account.
- **Alternatives rejected:** none yet seriously evaluated in-repo beyond the
  `TODO` pointing at OpenAI's `text-embedding-3-small` — the right first
  move, priced in `COST_MODEL.md`, not an architecture decision requiring
  its own ADR.

## 5. Retrieval

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
  `SYSTEM_ARCHITECTURE.md §5`'s note on why `asyncio.gather` is *slower*
  against this specific remote Postgres).
- **Cost:** $0 beyond the embedding call this stage depends on — pgvector
  search itself has no metered cost on Supabase's free tier.
- **Alternatives rejected:** a dedicated vector database — see
  `SYSTEM_ARCHITECTURE.md §4`. Rejected on the same grounds: no measurable
  latency win at this data volume, and a second free-tier account to run out
  of.

## 6. Hybrid search — not built, and here's the actual reasoning

Combining vector similarity with keyword/full-text search (e.g. Postgres
`tsvector` + rank fusion) catches exact-term matches a pure embedding search
sometimes misses — genuinely useful at scale. **Not worth building yet, for
a reason that has nothing to do with effort:** the embeddings feeding
today's vector search are stubbed (§4). Adding a second retrieval signal on
top of a broken first one solves the wrong problem — it would make bad
retrieval feel *slightly* less bad without fixing why it's bad. **Sequence
matters: fix §4 first, measure real retrieval quality, and only then decide
whether hybrid search earns its (genuinely small) implementation cost** — a
`tsvector` generated column plus a weighted-union query, no new
infrastructure. Don't build this before that measurement exists.

## 7. Reranking — not built, same class of reasoning

A cross-encoder rerank pass over the top-20 candidates before returning the
top-4 is a real technique for improving precision at higher retrieval
volumes. At `k=4–6` over a single subspace's chunks (typically dozens to a
few hundred, not thousands), the extra model call's latency and cost are
unlikely to earn back a meaningful quality gain — there usually aren't 20
plausible candidates to rerank between. Revisit if a subspace's chunk count
grows an order of magnitude *and* real embeddings (§4) show precision is
still a measured problem at that volume.

## 8. Context building

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
  (`plan-backend.md`'s cross-cutting Voice & Identity note) — a shared
  `COMPANION_VOICE` fragment is what makes every surface sound like one
  mentor instead of a different assistant per feature.

## 9. Reasoning

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
  `COST_MODEL.md` §2.
- **Alternatives rejected:** a single model tier for everything was rejected
  early — `GROQ_MODEL_FAST` (8B) exists specifically so the Home brief and
  subspace-naming calls (short, low-stakes output) don't pay 70B latency
  and quota for work an 8B model handles fine. This tiering *is* the cost
  optimization; see `COST_MODEL.md`.

## 10. Citation validation — built (Phase 0.4)

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

## 11. "Knowledge Object" — deliberately not a stage

The idealized pipeline names a unified "Knowledge Object" between generation
and persistence. This codebase doesn't have one, on purpose: a flashcard, a
quiz, and a note are different enough in shape (SM-2 state vs. a jsonb
question array vs. rich-text content) and different enough in how they're
queried that forcing them through one polymorphic table would be a premature
unification with no current consumer needing to query across artifact
types generically. Each artifact keeps its own table and its own lifecycle.
See `KNOWLEDGE_MODEL.md` for the actual single-source-of-truth model this
codebase uses instead (tagged evidence rows, not a unified object).

## 12. Artifact generation

**Code:** `api/app/routers/flashcards.py::generate_cards`,
`quizzes.py::generate_quiz`, `notes.py` (inline `/ai`)

- **Purpose:** turn a chat session or a topic into something the student can
  study from directly.
- **Input:** a `subspace_id`, real retrieved context (`rag.retrieve`), recent
  chat history, the Student Model's context — never a bare topic string
  handed to the model on faith (`plan-backend.md` §2's grounding fix).
- **Output:** a full deck (N flashcards), a full quiz (N questions, each with
  `answer_index`, `source`, `subtopic`), or an inline note edit.
- **Latency:** one LLM call at the `groq_model` (70B) tier — reasoning over
  real context is treated as genuinely different work from the brief's
  template-filling, and deliberately not downgraded to the fast tier for
  cost reasons without checking output quality first (`plan-backend.md`'s
  explicit note).
- **Cost:** metered at `cost=2` (double a chat turn) via
  `consume_llm_quota` — priced in `COST_MODEL.md` §3.
- **Alternatives rejected:** generating one card per chat reply (the
  original behavior) was rejected and replaced with whole-deck generation —
  "an agent asked for cards should produce a deck," per `PRODUCT.md`'s own
  documented deficiency list.

## 13. Learning state

**Code:** `api/app/services/student_model.py`, `flashcards.py`'s SM-2 fields

- **Purpose:** the durable record of what a student is good at, weak at, and
  how each card is scheduled — the substrate the "twenty-minute verdict"
  (`SOUL.md §3`) is computed from.
- **Where it lives:** distributed across existing tables, not centralized —
  `flashcards.ease/interval_days/reps/due_at` (SM-2 state), `quiz_results`
  (grouped into `TopicSignal` weak/strong areas at read time), `user_settings
  .student_model` (explicit preferences), `daily_activity` (streak). See
  `MEMORY_ENGINE.md` for the full lifecycle of each.
- **Update rule:** every value is computed fresh from stored facts on every
  read (`student_model.get()`) — nothing here is cached in a way that could
  drift from the underlying rows, per the same discipline that keeps
  `/me/brief` honest.
- **Cost:** $0 — pure SQL aggregation, no LLM call.

## 14. Scheduling

**Code:** `api/app/routers/flashcards.py::grade_card` (today);
`plan-backend.md §12` (exam-aware compression, not yet built)

- **Purpose:** decide when a card comes due again.
- **Algorithm today:** SM-2-lite — ease/interval adjustment per grade
  (`again`/`hard`/`good`/`easy`), no calendar awareness.
- **Planned:** compress the computed interval when it would land after a
  subject's `exam_date` — purely additive, no change to the base algorithm.
- **Cost:** $0 — arithmetic, no LLM call, no new table.

## 15. Response

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

## Summary table

| Stage | Built? | Latency (measured/estimated) | Marginal cost |
|---|---|---|---|
| Upload | Yes | ~200–800ms (est.) | $0 |
| Parsing | Yes (text); vision path costs an LLM call | 50–300ms text / LLM-call latency for images | $0 text / metered for images |
| Chunking | Yes | <10ms (est.) | $0 |
| Embedding | Provider wired; **flag off pending a key** | µs (stub) | $0 (stub); real cost priced in `COST_MODEL.md` |
| Retrieval | Yes | ~300–700ms (2–3 sequential round trips, est.) | $0 |
| Hybrid search | **Not built — sequenced after real embeddings** | — | — |
| Reranking | **Not built — not justified at current scale** | — | — |
| Context building | Yes | <5ms | $0 |
| Reasoning | Yes | 300–600ms TTFT + streaming (est.) | Priced in `COST_MODEL.md` |
| Citation validation | Yes (Phase 0.4) | one regex pass, post-stream | $0 |
| Artifact generation | Yes | one 70B call | 2x a chat turn's quota cost |
| Learning state | Yes | computed at read time | $0 |
| Scheduling | Yes (SM-2); exam-aware compression planned | <1ms | $0 |
| Response | Yes (SSE + JSON) | — | $0 |
