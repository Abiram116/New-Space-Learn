# Evaluating the student model

The product's central claim is that answers are shaped by how *this* student
said they want to be taught. That is a claim about behaviour, so it needs
measurement rather than assertion — and it had been asserted for months while
being, in fact, broken.

This describes how it is tested, what the numbers mean, and what they do not.

---

## Why this exists

The claim spans four hops:

```
intake  →  stored settings  →  resolved preferences  →  rendered system prompt  →  model output
```

Every one of those hops has failed in production at least once:

| Hop | Failure | How it looked |
|---|---|---|
| intake → storage | `learning_style` capped at 60 chars; two multi-select picks join to ~75 | Whole PATCH 422'd. Because the intake sends **one** patch, session length and teaching preference were discarded too. Silent — the error surfaced as a toast behind a full-screen transition. |
| storage → preferences | `learning_style` and `teaching_preference` both wrote `explanation.note`; the resolver refuses to overwrite an equal-or-stronger source | Whichever was written first won. The multi-select — the intake's most considered question — never reached a prompt. |
| preferences → prompt | A preference below `ACT_THRESHOLD` is stored but never rendered | Indistinguishable from not being stored at all. |

The lesson those share: **every one of them would pass a test that checked
storage.** The data was written correctly and then lost downstream. So the
tests assert on the *end* of the pipeline, not the middle.

---

## Two layers

### 1. Deterministic — `api/tests/test_student_model_benchmark.py`

Runs in CI, no network, no quota. Given a profile fixture, it asserts on the
text actually handed to the LLM:

- **Reaches the prompt.** Each profile's stated style appears in the rendered
  chat prompt. If this fails, the student answered questions that changed
  nothing.
- **Every pick survives.** A multi-select must not silently keep only the
  first — the exact failure above.
- **Profiles are distinguishable.** Two opposite intakes must produce different
  prompts, differing *in the direction asked for*. Identical prompts would mean
  the intake is decoration.
- **Silence for an empty profile.** No preference means no instruction. A
  default dressed as an instruction is worse than none: the model follows a
  guess exactly as hard as it follows a stated preference.
- **Actionable, not merely stored.** The explicit intake must clear
  `ACT_THRESHOLD`.
- **Explicit outranks inferred.** `SOURCE_WEIGHT["explicit"]` must be the
  maximum, so behaviour we guessed at can inform but never overrule what the
  student said.
- **Size.** The block is prepended to every call for its task, so its length is
  a recurring bill. Capped at 1500 chars per task.

### 2. Behavioural — `api/scripts/bench_student_model.py`

Run manually; it spends quota.

```bash
cd api && uv run python scripts/bench_student_model.py --runs 3
```

Asks one fixed, neutral question (`What is a derivative?`) under three profiles
and measures what comes back. Exits non-zero if a preference shows no
measurable effect, so it can gate a release.

---

## The metrics

Two, both deterministic proxies:

**`mean_words`** — words in the answer, averaged over runs. Proxy for the depth
preference.

**Opening classification** — the first two sentences are matched against two
marker sets. `EXAMPLE_MARKERS` ("imagine", "suppose", "think of", "speedometer")
indicate the answer led with a worked case; `FORMAL_MARKERS` ("the derivative
of", "by definition", "the limit") indicate it led with the formal statement.
Matching neither or both classifies as `mixed`. Proxy for the style preference.

### Thresholds

| Check | Verdict |
|---|---|
| depth preference | PASS when `deep.mean_words / short.mean_words >= 1.30` |
| example-first | PASS when example-led > formal-led; **FAIL only when formal-led wins**; INCONCLUSIVE when neither leads and openings were unclassified |
| definition-first | PASS when formal-led > example-led; **FAIL only when example-led wins**; INCONCLUSIVE when neither leads |

The three-state verdict is deliberate and was added after the second run
exposed the two-state version as wrong. That run scored `0 formal-led vs 0
example-led` — every opening classified `mixed` — and the check reported FAIL.
It should not have: the model had not done the opposite of what was asked, the
marker sets simply could not tell. Conflating "the model ignored the
preference" with "the measurement was inconclusive" is how a benchmark trains
you to ignore it, so only the former fails a run now, and the unclassified
count is printed alongside.

The depth threshold is 1.30 rather than something larger because the claim
being tested is *directional* — that the preference has a visible effect — not
that it has a specific magnitude. Observed effect is far above it (see below),
and a threshold set near the observed value would fail on ordinary sampling
variance rather than on a regression.

### What these metrics are not

They are proxies, and it matters to be precise about the limits:

- **They do not read the text.** A 600-word answer that ignores the student
  entirely scores identically to a good one. The benchmark measures *change
  between profiles*, not quality.
- **They can be gamed.** Instructing the model to always say "imagine" would
  pass the style check while teaching nothing.
- **They are sampled.** The model is non-deterministic; one run is an anecdote.
  `--runs 3` or more for anything you intend to act on.

**Why not an LLM judge.** It would read better and would itself be an
unvalidated model whose agreement with a human nobody here has measured —
trading a proxy whose bias is *legible* for one whose bias is not, and adding
quota cost per evaluation. A proxy that is honestly labelled beats a judge that
is quietly trusted.

---

## Recorded results

`--runs 3`, `llama-3.3-70b-versatile`, question `What is a derivative?`:

| Profile | mean words | example-led | formal-led | unclassified |
|---|---|---|---|---|
| `(none)` | 240 | 0/3 | 1/3 | 2/3 |
| `examples + short` | **98** | **3/3** | 0/3 | 0/3 |
| `formal + deep` | **545** | 0/3 | 1/3 | 2/3 |

| Check | Result | Value |
|---|---|---|
| depth preference | PASS | ratio **5.58** (threshold 1.30) |
| example-first | PASS | 3/3 example-led, 0 formal-led |
| definition-first | PASS | 1/3 formal-led, 0 example-led, 2 unclassified |

Across three recorded runs the depth ratio has ranged **5.27 – 6.81**, which is
the sampling variance to expect and the reason the threshold sits at 1.30.

Note the style signal is weaker than the depth signal: the formal profile is
never *example*-led, but often classifies as `mixed`. That is a limitation of
the marker sets, not evidence the preference is being ignored — the honest
reading is "depth is strongly confirmed, style is confirmed in the
never-does-the-opposite sense".

Read: the depth preference produces a five- to sevenfold swing in answer
length, and the example-first student got an example opening in every run. The
no-preference control sits between the two on length and commits to neither
opening, which is what a control should do.

`bench-history.jsonl` next to this file records each run, so a regression shows
as a trend rather than as one bad afternoon.

---

## Running both

```bash
cd api
uv run --extra dev pytest tests/test_student_model_benchmark.py -q   # CI, free
uv run python scripts/bench_student_model.py --runs 3               # manual, quota
```

The deterministic layer is the gate. The behavioural layer is evidence, and it
should be re-run whenever the personalisation prompt, the resolver's weights or
the model tier changes — those are the three things that can break the claim
without breaking a test.
