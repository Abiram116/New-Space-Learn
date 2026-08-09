# Cost Model

Written on the assumption stated in the engineering constitution: **every API
bill is paid personally.** That changes which optimizations are worth doing —
a 30% token reduction on a path that runs a thousand times a month matters;
shaving tokens off a path that runs twice does not.

> **Pricing caveat, stated up front:** Groq's free tier is rate-limited
> rather than metered, and published per-token prices for hosted Llama models
> shift. Every dollar figure below is an **order-of-magnitude planning
> estimate** derived from token counts this codebase actually produces, not a
> quote. The token counts are the durable, useful part; re-check unit prices
> against the provider's current pricing page before making a spend decision.

---

## 1. Embeddings — the one line item that's currently $0 and shouldn't be

**Today: $0.** `USE_STUB_EMBEDDINGS=true` in `render.yaml` means no embedding
provider is called at all (`AI_ENGINE.md §4`). This is not a cost saving —
it's the reason retrieval doesn't actually work semantically.

**Once real.** Groq doesn't host an embedding endpoint on this account, so
this means a second provider (the `TODO` in `embeddings.py` names OpenAI's
`text-embedding-3-small`, which is the right first choice: cheapest
credible option, 1536 dimensions matching the existing `vector(1536)` column
exactly — no migration needed).

Volume, derived from real chunking parameters (`CHUNK_SIZE = 900` chars,
~200 tokens per chunk):

| Scenario | Chunks | Tokens to embed | Est. cost @ ~$0.02/1M tokens |
|---|---|---|---|
| One 20-page lecture PDF (~40k chars) | ~50 | ~10k | **~$0.0002** |
| A semester's material, one subject (20 such PDFs) | ~1,000 | ~200k | **~$0.004** |
| Heavy user, 5 subjects, a full semester | ~5,000 | ~1M | **~$0.02** |
| Every question asked (query-side embedding) | 1 short string each | ~20 tokens | **negligible — ~$0.0000004/question** |

**Conclusion: embedding is effectively free at this product's scale.** The
entire semester of a heavy user costs about two cents. There is no cost
argument for keeping stub embeddings — the only reason it's still stubbed is
that the provider was never wired up. **This is the single highest-value fix
in the whole cost/quality picture: it costs cents and it's the difference
between retrieval working and not working.**

Note the asymmetry that makes this cheap: documents are embedded **once, at
upload**. Questions embed one short string per ask. Nothing re-embeds on a
retry, a page reload, or a new chat turn.

---

## 2. LLM inference — the real recurring cost

Model tiering (`config.py`) is the primary cost control already in place:

| Tier | Model | Used for | Why this tier |
|---|---|---|---|
| Large | `llama-3.3-70b-versatile` | RAG chat, quiz/flashcard/note generation | Reasoning over real retrieved context and producing structured output — quality-sensitive work |
| Fast | `llama-3.1-8b-instant` | Home brief, subspace-name suggestion | Short, low-stakes, template-shaped output. Explicitly *not* used for artifact generation without quality-checking first (`IMPLEMENTATION_PLAN.md`) |
| Vision | `qwen/qwen3.6-27b` | Image document ingestion only | The only image-capable model on the account |

Per-request token estimates, from the actual prompt construction in
`rag.py::build_prompt` and the generation prompts:

| Operation | Input tokens | Output tokens | Notes |
|---|---|---|---|
| Chat turn | ~1,200–2,500 | ~200–600 | Voice fragment + up to 4 retrieved chunks (~200 tok each) + up to 8 history turns + student context |
| Chat turn, Skill with `memory_scope: all` | ~3,000–5,000 | ~200–600 | History window widens to 40 turns — **the single largest prompt this product builds** |
| Quiz generation (5 questions) | ~1,500–2,000 | ~600–1,000 | 6 retrieved chunks + history + structured-output instructions |
| Flashcard generation (10 cards) | ~1,500–2,000 | ~500–800 | Same shape as quiz |
| Note generation | ~1,500–2,000 | ~400–900 | Same shape |
| Inline `/ai` in a note | ~1,500–2,000 | ~100–400 | Uses the large tier — arguably shouldn't always; see §6 |
| Home brief | ~300–600 | ~50–100 | Fast tier, deliberately |
| Subspace-name suggestion | ~1,000 | ~10 | Fast tier; input is capped at 4,000 chars of document text |
| Image ingestion | ~1,000 + image | ~200–800 | Vision tier, once per image upload |

**Monthly projection, one active student** (a realistic study pattern: 20
study sessions/month, 10 chat turns each, 8 quizzes, 8 decks, 10 notes):

| Line item | Volume | Est. tokens | Est. cost @ ~$0.60/1M in, ~$0.80/1M out |
|---|---|---|---|
| Chat | 200 turns | ~400k in, ~80k out | ~$0.30 |
| Quiz generation | 8 | ~14k in, ~6k out | ~$0.01 |
| Flashcard generation | 8 | ~14k in, ~5k out | ~$0.01 |
| Note generation + inline AI | ~30 calls | ~50k in, ~12k out | ~$0.04 |
| Home brief | 20 | ~10k in, ~2k out | ~$0.01 (fast tier, cheaper still) |
| Embeddings | a semester's docs | ~200k | ~$0.004 |
| **Total** | | | **well under $1/student/month** |

**The headline:** at single-digit user counts this product costs cents per
month, and Groq's free tier likely absorbs all of it. The cost model only
becomes interesting at ~1,000 users, where the same pattern projects to
roughly **$300–500/month** — dominated almost entirely by chat, which is
exactly where §6's optimizations should be aimed if that day comes.

---

## 3. Storage and bandwidth

| Resource | Free-tier limit | What consumes it | Projection |
|---|---|---|---|
| Supabase Postgres | 500MB | `document_chunks` dominates — each row is a `vector(1536)` (~6KB) plus its ~900 chars of text | ~7KB/chunk → **~70,000 chunks before the ceiling**, i.e. roughly 1,400 lecture-sized PDFs total across all users |
| Supabase Storage | 1GB | Original uploaded files, kept so `reprocess` works without re-upload | ~50 × 20MB files, or many more typical-sized ones |
| Vercel bandwidth | 100GB/mo | Static assets, 245KB gzipped per cold visit | Effectively unreachable at this scale |
| Render | 750 instance-hours/mo | One service, spins down when idle | Sufficient for one always-warm-ish service |

**The binding constraint is Postgres at 500MB, and the embedding vector — not
the text — is what fills it.** Worth knowing before "optimizing" chunk sizes
to save space: halving chunk text saves ~1KB/row while doubling row count and
therefore doubling the ~6KB vector cost. Larger chunks are *cheaper* per
document in storage terms, which cuts against retrieval precision — a real
trade-off, currently settled at 900 chars, and one that shouldn't be adjusted
for storage reasons without acknowledging the retrieval cost.

---

## 4. Cost per feature, ranked

| Feature | Marginal cost per use | Assessment |
|---|---|---|
| Reading notes/cards/decks/quiz history | $0 | Pure DB reads |
| Grading a card | $0 | Arithmetic + one write |
| Submitting a quiz | $0 | Server-side comparison, no LLM |
| Streak/heatmap/stats | $0 | SQL aggregation |
| **Confusion pairs (`IMPLEMENTATION_PLAN.md`)** | **$0** | `GROUP BY` over existing rows, no LLM call — worth restating, since this is the product's flagship differentiator and it costs *nothing* per use |
| **Exam-aware scheduling (§12)** | **$0** | Arithmetic |
| **Gap Map (§13)** | **$0** | Aggregation over existing rows |
| Home brief | ~$0.0005 | Fast tier |
| Chat turn | ~$0.0015 | The volume driver |
| Artifact generation | ~$0.002 each | Infrequent per student |
| Image ingestion | ~$0.002 | Infrequent |

**The strategically important row:** all three SOUL.md-derived flagship
features cost $0 per use. The redesign that replaced the concept graph with
tag aggregation didn't just avoid schema complexity — it kept the product's
most differentiating features entirely off the metered path. A graph that
needed an LLM call to derive `co-cited` edges during retrieval would have
added recurring cost to *every single chat turn*, which is precisely the
highest-volume operation in the product. That's a cost argument for the
approved architecture that `SOUL.md §6` only made implicitly.

---

## 5. Rate limiting as cost control

`ratelimit.py`'s token bucket (20 burst, 20/min refill, chat=1,
generation=2) is a **spend cap, not just an abuse guard** — its docstring
names the real risk: "one stuck retry loop or an open tab hammering chat can
burn the daily token budget." Worth noting that the one previously-unmetered
LLM endpoint (subspace-name suggestion) was found and closed during an
earlier audit — the lesson being that **every new LLM-backed endpoint must
call `consume_llm_quota`**, and reviewing for that should be part of adding
one. There is no automated check enforcing this today.

---

## 6. Optimization recommendations, ranked by value

1. **Wire real embeddings (~2¢/semester/user).** Not an optimization — a
   correctness fix that happens to be nearly free. Highest priority in this
   document and in `AI_ENGINE.md`.
2. **Reconsider the large tier for inline `/ai` in notes.** It currently uses
   `groq_model` (70B) for what is often a short continuation or a
   reformatting request. The fast tier may be sufficient for a large share of
   these. **Test output quality before switching** — the same caution
   `IMPLEMENTATION_PLAN.md` applies to agents applies here; don't downgrade a
   tier on cost reasoning alone.
3. **Watch `memory_scope: all` Skills.** A 40-turn history window builds the
   largest prompt in the product (~3–5k input tokens per turn) on the
   highest-volume operation. Currently fine — and it's a real behavior
   dimension, not waste — but if chat cost ever needs reducing, capping this
   (or summarizing older turns) is the single biggest lever. Do not
   pre-optimize it now; there's one user.
4. **Don't add per-retrieval LLM calls, ever.** Anything that puts a model
   call inside the retrieval path multiplies the product's highest-volume
   operation. This is the concrete cost reason `co-cited` edge derivation was
   killed (`SOUL.md §6`) and the standing reason to be suspicious of any
   future "enrich the context automatically" proposal.
5. **Leave chunk size alone at 900 chars** unless retrieval quality (not
   storage) motivates a change — see §3's note on why smaller chunks cost
   *more* storage, not less.
