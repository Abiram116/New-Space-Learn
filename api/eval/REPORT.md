# Space Learn: evaluation report

Built 2026-10-04 from the saved results in `eval/results/`. Sections: **1** RAG, **2** agents, **3** system design (cost, caching, capacity, latency, guarantees).

## 1. RAG: finding the right passage, and what the model then says

Production's retrieval (`v2-5-judge`, run 2026-10-04) on all 114 benchmark questions. The questions are direct, reworded, follow-ups, exact-term, cross-section and unanswerable.

| Measure | Result |
|---|---|
| Right passage ranked first | 69.4% |
| …within the top five | 90.8% |
| Evidence reached the model | 93.9% |
| All parts of a multi-part answer reached it | 91.8% |

Graded answers (a sample; the model's own answer judged against a reference):

| Measure | Result |
|---|---|
| Questions sampled | 36 |
| Correct | 91.7% |
| Refused when the documents don't cover it | 50.0% |
| Made an unsupported claim | 8.3% |
| Citations pointing at the right passage | 67.6% |

### A cheaper prompt, and a smaller model

Same questions, same retrieved sources, same judge. Correct / unsupported are shares of the questions graded.

| Arm | Model | Questions | Correct | Refused when uncovered | Unsupported | Citations right |
|---|---|---|---|---|---|---|
| A large, original prompt | `openai/gpt-oss-120b` | 18 | 88.9% | 66.7% | 5.6% | 71.4% |
| B large, current prompt | `openai/gpt-oss-120b` | 18 | 88.9% | 66.7% | 5.6% | 94.1% |
| C small, current prompt | `openai/gpt-oss-20b` | 18 | 88.9% | 66.7% | 11.1% | 79.0% |

Reading it: the shorter prompt costs nothing in correctness here, and citations were no worse. The small model matches on correctness but cites the right passage less often and makes twice the unsupported claims, so chat stays on the large model. 18 questions is a small sample: this can rule a change out; it cannot on its own rule one in. It grades whether answers are right and supported, not how they look.

### Measured and rejected: pruning passages

Idea: send the model only the sentences of each retrieved passage that share terms with the question
(plus the sentence either side, and always the first), to save tokens. Tried on the 98 answerable questions with
production's own retrieval:

| | Before pruning | After pruning |
|---|---|---|
| Evidence reached the model | 90 of 98 (91.8%) | 88 of 98 (89.8%) |
| Characters sent | 391,547 | 362,090 (7.5% fewer) |

It changed the passages for 51 of 98 questions, saved about a twelfth of the text, and lost the evidence for two
(the steps of the three-way handshake, and how cacti take in carbon). Passages here are short and on topic, so there
is little to cut and a real chance of cutting the one sentence that mattered. **Rejected**; worth measuring again
only if chunks get longer.

## 2. Agents

## Agent evaluation

Rebuilt by `python -m eval.agents --report` on 2026-10-04.

### Flashcards

| Topic | Asked | Kept | Question fronts | With a source | Repeated fronts | Grounded in their source | Mean grounded share |
|---|---|---|---|---|---|---|---|
| cs | 8 | 8 | 7 | 8 | 0 | 3 of 8 | 48% |
| systems | 8 | 8 | 8 | 8 | 0 | 5 of 8 | 46% |
| bio | 8 | 8 | 8 | 8 | 0 | 4 of 8 | 50% |

“Grounded” means at least half of the back's own vocabulary appears in the passage it names. Lexical, so a faithful paraphrase can score low; it is for telling made-from-the-passage from made-up.

### Quizzes

| Topic / way | Questions | Graded | Sound (supported and the only right choice) |
|---|---|---|---|
| cs / one prompt | 5 | 5 | 5 |
| cs / workflow | 5 | 5 | 5 |
| systems / one prompt | 5 | 5 | 0 |
| systems / workflow | 5 | 0 | 0 |
| bio / one prompt | 5 | 5 | 5 |
| bio / workflow | 5 | 5 | 5 |

### Notes

Not measured: the prompts are built inside the request handler. See the docstring of `eval/agents.py`.

## 3. System design

## System-design evaluation

Rebuilt by `python -m eval.system` on 2026-10-04. No model calls. Tokens are characters ÷ 4.

### 1. Where the prompt's tokens go

| Piece | Tokens |
|---|---|
| voice | 94 |
| answer shape (full) | 536 |
| answer shape (short) | 104 |
| diagram rule (full) | 208 |
| diagram rule (short) | 36 |
| safety rules | 271 |
| honesty rules | 122 |
| follow-up suggestion | 76 |

| A chat turn with six sources | Instructions | Sources | Total (no history) |
|---|---|---|---|
| plain question ("What is a page fault?") | 980 | 1215 | 2201 |
| question with a shape ("Explain how paging works") | 1414 | 1215 | 2635 |

The short answer shape and short diagram line are what a plainly simple question gets; the full ones are for questions that want structure.

### 2. History sent back to the model

| Messages in the chat | Before the budget | After | Saved |
|---|---|---|---|
| 2 | 472 | 427 | 10% |
| 4 | 944 | 603 | 36% |
| 8 | 1888 | 954 | 49% |
| 20 | 4721 | 2010 | 57% |
| 40 | 9444 | 3418 | 64% |

The free tier allows about 8,000 tokens a minute on the large model. The budget's ceiling is 3500 tokens however many turns a Skill asks for.

### 3. Caches: hit when they should, never when they must not

| Case | Should hit | Hit | |
|---|---|---|---|
| same question | True | True | ok |
| same words, different case and punctuation | True | True | ok |
| a near-identical vector | True | True | ok |
| an unrelated question | False | False | ok |
| the sources changed (a file was edited or removed) | False | False | ok |
| a setting changed (citations off) | False | False | ok |
| another student, same question | False | False | ok |
| another topic, same question | False | False | ok |

Also covered by tests, not here: a regenerate is never served from the cache; a follow-up is never cached; an image is never cached.

### 4. Which model does what (read from the source)

| File | Tasks | Models referenced |
|---|---|---|
| `app/routers/me/brief.py` | brief | small (20B) |
| `app/routers/notes.py` | notes.edit, notes.write | large (120B), small (20B) |
| `app/routers/subspace_chat.py` | chat | large (120B), small (20B), vision |
| `app/services/card_writer.py` | cards.write | large (120B) |
| `app/services/chat_memory.py` | — | small (20B) |
| `app/services/extract.py` | — | vision |
| `app/services/llm.py` | — | large (120B), small (20B) |
| `app/services/ocr.py` | — | vision |
| `app/services/query_resolver.py` | — | small (20B) |
| `app/services/quiz_agent.py` | quiz.repair, quiz.verify, quiz.write | large (120B), small (20B) |
| `app/services/usage.py` | quiz.verify | — |

A scan, not a trace: a file that names two models may use each for a different call. A call that names no model (the chat answer) uses the large one and falls back to the small one if it is unavailable (`services/llm.py`).

### 5. Retrieval speed

`v2-5-judge` over 114 questions: median 9.66 ms, 95th percentile 13.82 ms; embedding one question 16.2 ms. On this machine. Production is a tenth of a CPU, so compare variants with each other, not with Render.

#### Our own code

Building the prompt for a 40-message conversation: 1.13 ms. Looking an answer up in the cache: 0.082 ms. Everything slow is the model and the database, not this code.

#### How many answers the free tier allows, for everyone together

The limit is on the app's one key, shared by every student: 8,000 tokens a minute and 200,000 a day per model. A turn costs its prompt plus its reply, and replies run from about 300 to 800 tokens, so each cell is a range.

| A turn like | Tokens | Answers per minute | Answers per day |
|---|---|---|---|
| plain question ("What is a page fault?") | 2501–3001 | 2.7–3.2 | 66–79 |
| question with a shape ("Explain how paging works") | 2935–3435 | 2.3–2.7 | 58–68 |

When the large model is out, the app falls back to the small one, which has its own allowance, so the real ceiling is higher; the cache and the smaller prompts are what raise it further.

#### Real model latency

| Model | Way | Worked | Median to first word | Median to whole answer | Prompt tokens | Reply tokens |
|---|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | one at a time | 0 | refused: the daily allowance was spent. Re-run `--live` after it frees up | | | |
| `openai/gpt-oss-120b` | three at once | 0 | refused: the daily allowance was spent. Re-run `--live` after it frees up | | | |
| `openai/gpt-oss-20b` | one at a time | 3 of 4 | 0.87 s | 0.92 s | 2562 | 156 |
| `openai/gpt-oss-20b` | three at once (all three took 1.07 s) | 1 of 3 | 0.86 s | 1.05 s | 2562 | 170 |

Measured from this machine to Groq, not from a student's browser through Render.

### 6. Invariants (the backend test suite)

PASS: 822 passed, 1 warning in 49.90s

## Appendix: the retrieval write-ups, in full

### A. Retrieval, one stage added at a time

### Retrieval benchmark results

One row per pipeline, oldest first, on the same documents and questions
(`eval/corpus/`, `eval/questions.json`). Rebuilt by `python -m eval.bench --table`.

#### Retrieval — held-out test questions

Thresholds are only ever tuned on the other questions, so these numbers are honest.

| Pipeline | Found, rank 1 | Found, top 3 | Found, top 5 | Mean rank score | Answer reached the model | …in full | Said “not covered” when it wasn’t | Wrongly said “not covered” | Characters sent | Search ms |
|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 47.2% | 72.2% | 83.3% | 62.9% | 77.8% | 77.8% | 0.0% | 0.0% | 3046 | 0.02 |
| `chunks-v2` | 58.3% | 75.0% | 80.6% | 68.2% | 77.8% | 77.8% | 0.0% | 0.0% | 2784 | 0.02 |
| `v2-1-prefix` | 55.6% | 72.2% | 83.3% | 66.6% | 72.2% | 72.2% | 0.0% | 0.0% | 2788 | 20.16 |
| `v2-2-hybrid` | 61.1% | 72.2% | 83.3% | 69.6% | 83.3% | 83.3% | 0.0% | 0.0% | 2768 | 5.29 |
| `v2-3-resolve` | 63.9% | 75.0% | 83.3% | 72.0% | 83.3% | 83.3% | 0.0% | 0.0% | 2768 | 5.99 |

#### Retrieval — by kind of question (all questions, answer found in the top 5)

| Pipeline | direct | reworded | followup | exact | cross | unanswerable |
|---|---|---|---|---|---|---|
| `baseline` | 88.9% | 81.0% | 55.6% | 84.0% | 85.7% | 0.0% |
| `chunks-v2` | 92.6% | 85.7% | 50.0% | 88.0% | 100.0% | 0.0% |
| `v2-1-prefix` | 100.0% | 81.0% | 55.6% | 88.0% | 100.0% | 0.0% |
| `v2-2-hybrid` | 88.9% | 95.2% | 66.7% | 92.0% | 85.7% | 0.0% |
| `v2-3-resolve` | 88.9% | 95.2% | 72.2% | 92.0% | 85.7% | 0.0% |

For `unanswerable` the figure is how often the pipeline passed no sources.

#### Answers — a graded sample

| Pipeline | Graded | Correct | Refused when not covered | Unsupported claims | Citation precision |
|---|---|---|---|---|---|
| `baseline` | 34 | 88.2% | 80.0% | 5.9% | 70.0% |

#### What each pipeline is

- **`baseline`** — Production today: 900-character chunks, one vector search on the latest message, best 4, no cut-off. (542 chunks; run 2026-10-02)
- **`chunks-v2`** — Structure-aware chunks (sections, pages, heading path embedded with the text); search unchanged. (563 chunks; run 2026-10-02)
- **`v2-1-prefix`** — chunks-v2, plus the embedding model's query prefix on the question. (563 chunks; run 2026-10-02)
- **`v2-2-hybrid`** — …plus keyword search beside the vector search, merged by rank. (563 chunks; run 2026-10-02)
- **`v2-3-resolve`** — …plus follow-ups rewritten into standalone questions before searching. (563 chunks; run 2026-10-02)

### B. Each stage removed in turn

### Ablation: what each stage is worth

Rebuilt by `python -m eval.ablate`. Production's pipeline with one stage removed at a time.

#### Retrieval

| Removed | Ranked first | Reached the model | …held-out test | Follow-ups reached | Exact terms reached | Characters sent |
|---|---|---|---|---|---|---|
| (nothing removed: production) | 64.3% | 92.9% | 88.9% | 83.3% | 92.0% | 3974 |
| query prefix | 62.2% | 90.8% | 86.1% | 83.3% | 92.0% | 3980 |
| keyword search | 62.2% | 83.7% | 88.9% | 72.2% | 80.0% | 3950 |
| follow-up rewrite | 61.2% | 87.8% | 86.1% | 55.6% | 92.0% | 3968 |
| adjacent promotion | 64.3% | 89.8% | 86.1% | 72.2% | 92.0% | 3942 |
| six chunks (back to four) | 64.3% | 85.7% | 83.3% | 83.3% | 88.0% | 2768 |

#### The “doubtful sources” warning (graded answers)

Every question retrieval passed on as doubtful, answered twice.

| | Refused an uncovered question | Unsupported claim on one | Correct on a covered question | Wrongly refused one |
|---|---|---|---|---|
| with the warning | 12 of 13 | 0 of 13 | 9 of 9 | 0 of 9 |
| without it | 2 of 14 | 12 of 14 | 9 of 9 | 0 of 9 |

## How to re-run

```
uv run python -m eval.report --free   # prompt size, caches, tiers, capacity, test suite (seconds, no model)
uv run python -m eval.system --live    # also time the real model (uses the Groq key)
uv run python -m eval.bench --variant v2-5-judge --answers 36     # retrieval + graded answers
uv run python -m eval.route_check --arm B   # --arm C in a second terminal; they use different models
uv run python -m eval.agents --cards
uv run python -m eval.quiz_check --questions
```

Everything that calls a model is paced for a free-tier key and spends from its daily allowance. Use a key that is not the one production runs on.
