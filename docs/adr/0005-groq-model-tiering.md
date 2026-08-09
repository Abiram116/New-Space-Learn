# ADR-0005 — One provider, three model tiers

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** `docs/COST_MODEL.md §2`, `api/app/services/llm.py`, `api/app/config.py`

## Context

Every AI feature in the product needs inference, but the work varies enormously
in difficulty: writing a five-question quiz from retrieved course material is
not the same job as producing a two-line re-entry greeting from precomputed
facts, or naming a topic from a page of text.

## Problem

Paying the largest model's latency and quota for trivial work is waste; using
a small model for reasoning over retrieved context produces bad study
material. How many models, from how many providers?

## Decision

**One provider (Groq), one API key, three model tiers selected per request:**

| Setting | Model | Used for |
|---|---|---|
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | RAG chat, quiz/flashcard/note generation |
| `GROQ_MODEL_FAST` | `llama-3.1-8b-instant` | Home brief, subspace-name suggestion |
| `GROQ_MODEL_VISION` | `qwen/qwen3.6-27b` | Image document ingestion |

Both `GroqLLM` and `StubLLM` implement one `stream_chat` protocol, so
swapping providers or degrading gracefully never touches router code.

## Alternatives considered

1. **One model for everything.** Rejected: the brief and subspace-naming
   calls are short, structured, low-stakes — paying 70B latency for them is
   pure waste with no quality gain.
2. **Multiple providers** (e.g. Groq for chat, OpenAI for structured output).
   Rejected: two keys, two failure modes, two rate-limit regimes, two billing
   relationships, for no capability this product needs. Note this decision is
   *already partially forced open* by embeddings — Groq hosts no embedding
   endpoint, so real embeddings require a second provider regardless
   (`AI_ENGINE.md §4`). That's an acknowledged exception, not a reversal.
3. **Local/self-hosted inference.** Rejected outright: 512MB of RAM.
4. **Groq, three tiers.** Chosen — free tier, genuinely fast inference, and
   three sizes on one key.

## Trade-offs

**Cost:** total dependence on one provider's availability and model lifecycle.
Groq retires model ids periodically, so the ids in `config.py` and
`render.yaml` are a maintenance surface — `ARCHITECTURE.md` explicitly says to
confirm current ids against `GET /openai/v1/models` before changing them.

**Benefit:** tiering *is* the primary cost control (`COST_MODEL.md`), and the
`LLM` protocol means provider risk is contained to one file.

**A deliberate restraint worth recording:** `IMPLEMENTATION_PLAN.md` explicitly
forbids downgrading agent generation to the fast tier "for cost reasons
without checking output quality first." Reasoning over real retrieved context
is a genuinely different job from template-filling, and the cheaper tier is
not assumed adequate for it. Cost optimization stops where output quality
starts.

## Consequences

- Graceful degradation is free: with no key, `StubLLM` streams a canned reply
  and the whole UI stays clickable and testable.
- Groq error semantics are mapped to this product's own codes — a 429 becomes
  `rate_limited` (retry), a 401/403 becomes `not_configured` (the user can't
  fix it). Provider error bodies are logged, never surfaced, since they can
  carry account or quota details.
- The vision tier is configured but was only wired into image ingestion, not
  into a general chat-with-image feature.

## Future migration path

Adding a provider means one new class implementing `stream_chat`, plus config
for which tier maps to which provider — no router changes. The embedding
provider (a separate concern, not a `stream_chat` implementation) is the first
real instance of going multi-provider.
