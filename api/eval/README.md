# Retrieval benchmark

Measures how well Space Learn finds the right part of a student's documents,
and what the model then says, so that every change to retrieval is judged by
numbers on the same questions rather than by feel.

```bash
cd api
uv run python -m eval.bench                    # baseline, retrieval only (free)
uv run python -m eval.bench --answers 36       # also grade 36 model answers
uv run python -m eval.bench --table            # rebuild RESULTS.md
```

It runs on this machine against the six documents in `corpus/`. It never reads
or writes the project's database: the pipelines that need PostgreSQL get a
throwaway local one (`pg.py`), with the project's real search migration
applied, so keyword search is measured on the real thing. That needs the
`eval` extra once: `uv sync --extra dev --extra eval`. `--answers` uses your Groq key: two calls per question,
paced slowly enough for the free tier (about fifteen minutes for 36), and a
re-run only pays for questions whose sources changed.

## What is in here

| File | What it is |
|---|---|
| `corpus/` | Six Wikipedia articles as PDFs (see `SOURCES.md`), grouped into three topics |
| `questions.json` | 114 questions: direct, reworded, follow-up, exact-term, cross-section and unanswerable |
| `corpus.py` | Loads both, and decides whether a chunk supports an answer |
| `variants.py` | The pipelines being compared: `baseline` (as first measured), then one stage added at a time up to `v2-5-judge`, which is production's own config |
| `pg.py` | The local PostgreSQL the pipeline variants search |
| `rewrites.py`, `rewrites.json` | Follow-up rewrites already paid for, so runs are free and repeatable |
| `calibrate.py` | Fits the "do the documents cover this?" thresholds on the tune questions |
| `legacy.py` | The first chunker, frozen, so `baseline` stays what was measured |
| `metrics.py` | Retrieval scores |
| `answers.py` | Answer scores, on a sample |
| `bench.py` | Runs a variant, saves `results/<variant>.json`, rebuilds `RESULTS.md` |

## How a question is scored

A question lists short quotes from the document that contain its answer. A
chunk is right if it contains one of them (compared on letters and digits only,
so line breaks and lost spaces in PDF text don't matter). That makes the
questions independent of how documents are chunked — the thing being changed.

- A question with several quote groups needs each group found (cross-section).
- A question with none is one the documents do not answer; the right result is
  to pass no sources.
- Each question is `tune` or `test`. Thresholds may be fitted on `tune` only;
  the headline table is `test`.

## Changing retrieval

Production's retrieval is `app/services/retrieval.py` run with
`RetrievalConfig`'s defaults, and `v2-5-judge` is exactly that. To try a
change, add a `Pipeline` subclass in `variants.py` with a different config,
run it, and compare its row in `RESULTS.md`. Only move the default once the
numbers say so (a test pins the defaults to make that a deliberate act).

## The rest of the evaluation suite

Retrieval is one part of what is measured. **`REPORT.md` is the one file that pulls
everything together** — read or send that. The scripts that feed it:

| Script | Question it answers | Model calls? | Saves |
|---|---|---|---|
| `bench` | Does retrieval find the right passage? (`--answers N` also grades answers) | retrieval: none | `RESULTS.md`, `results/<variant>.json` |
| `ablate` | What is each retrieval stage worth? | `--warning` only | `ABLATION.md`, `results/ablation.json` |
| `route_check` | Can a cheaper prompt, or the small model, answer as well? | yes, paced | `results/route_check_{A,B,C}.json` |
| `agents` | Are flashcards well-formed, distinct and grounded? | `--cards` only | `results/agents.json` |
| `quiz_check` | Do quizzes cover the material, and are their questions sound? | `--questions` only | `results/quizzes.json` |
| `system` | Prompt size, history budget, caches, tiers, capacity, latency, invariants | `--live` only | `results/system.json` |
| `report` | All of the above in one document | none | `REPORT.md` |

`system` and `report` are worth running on every change. The model-backed ones are
paced for a free-tier key and spend from its daily allowance, so use a key that is not
production's. `route_check` arms B and C use different models and can run together.
