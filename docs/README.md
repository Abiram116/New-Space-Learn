# Space Learn — documentation

Seven documents and a file of decisions. Read the one that matches what you
are trying to do.

```
docs/
├── plan.md                    what's left to build, in order
├── product/
│   └── vision.md              what this is trying to be, and why
├── engineering/
│   ├── architecture.md        how the system fits together
│   ├── ai-pipeline.md         retrieval, prompts, memory, request flows
│   ├── personalization.md     the Student Model and the feedback loop
│   └── security.md            auth, guards, injection, open gaps
├── operations/
│   ├── setup.md               run it locally, deploy it
│   └── performance-and-cost.md  latency budgets and what it costs
└── decisions.md               why things are the way they are
```

| Doc | Read it when you want to know… |
|---|---|
| [plan.md](plan.md) | What to build next and in what order. **Start here to pick up work.** |
| [product/vision.md](product/vision.md) | What the product is for, and the thesis behind the design. Everything else is judged against this. |
| [engineering/architecture.md](engineering/architecture.md) | Repo shape, the Subjects → Subspaces model, the error contract, service boundaries, what breaks first under scale. |
| [engineering/ai-pipeline.md](engineering/ai-pipeline.md) | How a question becomes a grounded answer: retrieval, prompt construction, what's remembered, and each feature's request lifecycle. |
| [engineering/security.md](engineering/security.md) | The guards-over-RLS model, prompt injection, upload validation, and the ranked list of known gaps. |
| [engineering/personalization.md](engineering/personalization.md) | The Student Model: concept mastery, preferences with confidence, per-task context, and the feedback loop. |
| [operations/setup.md](operations/setup.md) | Getting it running, and applying migrations with the Supabase CLI. |
| [operations/performance-and-cost.md](operations/performance-and-cost.md) | Latency budgets, cold starts, and real per-operation cost. |
| [decisions.md](decisions.md) | Why a major choice was made — including the ones that were rejected, so settled arguments stay settled. |

## What happened to the other files

This was twenty-seven files. Most of the reduction was structural rather
than deletion:

- **Four documents described one subsystem.** `AI_ENGINE`,
  `KNOWLEDGE_MODEL`, `MEMORY_ENGINE` and `REQUEST_PIPELINE` each opened by
  explaining which of the other three it did not repeat, which costs a
  reader four decisions before they learn anything. They are now the four
  parts of `engineering/ai-pipeline.md`.
- **`SOUL.md` and `vision.md`** were always read and edited together — one
  held the north star, the other the argument for reaching it. They are
  `product/vision.md`.
- **`PERFORMANCE.md` and `COST_MODEL.md`** trade against each other on
  nearly every decision, so they sit in one document.
- **`CHECKPOINT.md` was deleted outright.** It was a dated snapshot of
  project state, which means its job was to become wrong — and it had,
  within a day. Its live findings moved into `plan.md`, which is the only
  place work should be tracked.

- **Thirteen ADRs became one `decisions.md`.** The ADR format — context,
  alternatives, consequences, status, one file per decision — is built for
  teams where the people who made a choice will have left before it is
  questioned. This is two people on a capstone; the ceremony cost more than
  it returned. The *reasons* were kept, because without them someone
  re-litigates "why not a vector database" every few weeks. The originals
  are in git history if the long form is ever wanted:
  `git show HEAD:docs/adr/0012-local-embeddings-bge-small.md`.
