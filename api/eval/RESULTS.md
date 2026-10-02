# Retrieval benchmark results

One row per pipeline, oldest first, on the same documents and questions
(`eval/corpus/`, `eval/questions.json`). Rebuilt by `python -m eval.bench --table`.

## Retrieval — held-out test questions

Thresholds are only ever tuned on the other questions, so these numbers are honest.

| Pipeline | Found, rank 1 | Found, top 3 | Found, top 5 | Mean rank score | Answer reached the model | …in full | Said “not covered” when it wasn’t | Wrongly said “not covered” | Characters sent | Search ms |
|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 47.2% | 72.2% | 83.3% | 62.9% | 77.8% | 77.8% | 0.0% | 0.0% | 3046 | 0.02 |

## Retrieval — by kind of question (all questions, answer found in the top 5)

| Pipeline | direct | reworded | followup | exact | cross | unanswerable |
|---|---|---|---|---|---|---|
| `baseline` | 88.9% | 81.0% | 55.6% | 84.0% | 85.7% | 0.0% |

For `unanswerable` the figure is how often the pipeline passed no sources.

## Answers — a graded sample

| Pipeline | Graded | Correct | Refused when not covered | Unsupported claims | Citation precision |
|---|---|---|---|---|---|
| `baseline` | 34 | 88.2% | 80.0% | 5.9% | 70.0% |

## What each pipeline is

- **`baseline`** — Production today: 900-character chunks, one vector search on the latest message, best 4, no cut-off. (542 chunks; run 2026-10-02)
