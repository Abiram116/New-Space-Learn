# Retrieval benchmark results

One row per pipeline, oldest first, on the same documents and questions
(`eval/corpus/`, `eval/questions.json`). Rebuilt by `python -m eval.bench --table`.

## Retrieval — held-out test questions

Thresholds are only ever tuned on the other questions, so these numbers are honest.

| Pipeline | Found, rank 1 | Found, top 3 | Found, top 5 | Mean rank score | Answer reached the model | …in full | Said “not covered” when it wasn’t | Wrongly said “not covered” | Doubted an uncovered question | Doubted a covered one | Characters sent | Search ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 47.2% | 72.2% | 83.3% | 62.9% | 77.8% | 77.8% | 0.0% | 0.0% | — | — | 3046 | 0.02 |
| `chunks-v2` | 58.3% | 75.0% | 80.6% | 68.2% | 77.8% | 77.8% | 0.0% | 0.0% | — | — | 2784 | 0.02 |
| `v2-1-prefix` | 55.6% | 72.2% | 83.3% | 66.6% | 72.2% | 72.2% | 0.0% | 0.0% | — | — | 2788 | 20.16 |
| `v2-2-hybrid` | 61.1% | 72.2% | 83.3% | 69.6% | 83.3% | 83.3% | 0.0% | 0.0% | — | — | 2768 | 5.29 |
| `v2-3-resolve` | 63.9% | 75.0% | 83.3% | 72.0% | 83.3% | 83.3% | 0.0% | 0.0% | — | — | 2768 | 5.99 |
| `v2-4-select` | 63.9% | 75.0% | 83.3% | 72.0% | 88.9% | 86.1% | 0.0% | 0.0% | 0.0% | 0.0% | 3996 | 112.44 |
| `v2-6-halfvec` | 69.4% | 83.3% | 88.9% | 77.3% | 88.9% | 86.1% | 0.0% | 0.0% | 83.3% | 11.1% | 4050 | 8.57 |
| `v2-5-judge` | 69.4% | 83.3% | 88.9% | 77.3% | 88.9% | 86.1% | 0.0% | 0.0% | 83.3% | 11.1% | 4040 | 11.51 |
| `v2-5-judge-notes` | 83.3% | 100.0% | 100.0% | 91.7% | 100.0% | 100.0% | 50.0% | 0.0% | 100.0% | 25.0% | 3756 | 4.67 |

## Retrieval — by kind of question (all questions, answer found in the top 5)

| Pipeline | direct | reworded | followup | exact | cross | unanswerable |
|---|---|---|---|---|---|---|
| `baseline` | 88.9% | 81.0% | 55.6% | 84.0% | 85.7% | 0.0% |
| `chunks-v2` | 92.6% | 85.7% | 50.0% | 88.0% | 100.0% | 0.0% |
| `v2-1-prefix` | 100.0% | 81.0% | 55.6% | 88.0% | 100.0% | 0.0% |
| `v2-2-hybrid` | 88.9% | 95.2% | 66.7% | 92.0% | 85.7% | 0.0% |
| `v2-3-resolve` | 88.9% | 95.2% | 72.2% | 92.0% | 85.7% | 0.0% |
| `v2-4-select` | 88.9% | 95.2% | 72.2% | 92.0% | 85.7% | 0.0% |
| `v2-6-halfvec` | 92.6% | 95.2% | 77.8% | 92.0% | 100.0% | 0.0% |
| `v2-5-judge` | 92.6% | 95.2% | 77.8% | 92.0% | 100.0% | 0.0% |
| `v2-5-judge-notes` | 100.0% | 100.0% | 100.0% | 100.0% | 75.0% | 20.0% |

For `unanswerable` the figure is how often the pipeline passed no sources.

## Answers — a graded sample

| Pipeline | Graded | Correct | Refused when not covered | Unsupported claims | Citation precision |
|---|---|---|---|---|---|
| `baseline` | 34 | 88.2% | 80.0% | 5.9% | 70.0% |
| `v2-5-judge` | 36 | 91.7% | 66.7% | 8.3% | 87.5% |
| `v2-5-judge-notes` | 12 | 91.7% | 100.0% | 8.3% | 81.8% |

## What each pipeline is

- **`baseline`** — Production today: 900-character chunks, one vector search on the latest message, best 4, no cut-off. (542 chunks; run 2026-10-02)
- **`chunks-v2`** — Structure-aware chunks (sections, pages, heading path embedded with the text); search unchanged. (563 chunks; run 2026-10-02)
- **`v2-1-prefix`** — chunks-v2, plus the embedding model's query prefix on the question. (563 chunks; run 2026-10-02)
- **`v2-2-hybrid`** — …plus keyword search beside the vector search, merged by rank. (563 chunks; run 2026-10-02)
- **`v2-3-resolve`** — …plus follow-ups rewritten into standalone questions before searching. (563 chunks; run 2026-10-02)
- **`v2-4-select`** — …plus selection: up to six chunks within a size budget, a chunk's direct continuation promoted. (563 chunks; run 2026-10-02)
- **`v2-6-halfvec`** — Production with vectors at half precision (halfvec), half the vector storage. (532 chunks; run 2026-10-03)
- **`v2-5-judge`** — …plus judging coverage: nothing passed when clearly uncovered, a warning when doubtful. This is production. (532 chunks; run 2026-11-07)
- **`v2-5-judge-notes`** — …plus judging coverage: nothing passed when clearly uncovered, a warning when doubtful. This is production. (topic notes only) (555 chunks; run 2026-11-07)
