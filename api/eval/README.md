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
or writes the database. `--answers` uses your Groq key: two calls per question,
paced slowly enough for the free tier (about fifteen minutes for 36), and a
re-run only pays for questions whose sources changed.

## What is in here

| File | What it is |
|---|---|
| `corpus/` | Six Wikipedia articles as PDFs (see `SOURCES.md`), grouped into three topics |
| `questions.json` | 114 questions: direct, reworded, follow-up, exact-term, cross-section and unanswerable |
| `corpus.py` | Loads both, and decides whether a chunk supports an answer |
| `variants.py` | The pipelines being compared. `baseline` is production today |
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

## Adding a pipeline

Subclass `Variant` in `variants.py`, give it a `name` and `description`, add it
to `VARIANTS`, and run it. It appears as a new row in `RESULTS.md` beside the
ones before it.
