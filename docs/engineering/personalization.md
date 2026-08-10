# Personalization

How the app builds an evidence-backed picture of one student and uses it to
teach them better. This is the subsystem behind "a tutor rather than a CRUD
app" — everything here exists to change what the model writes, and anything
that doesn't change what the model writes doesn't belong here.

Four layers, each with one job:

```
Layer 1  KNOWLEDGE     what does the student know?
                       concept mastery · weak · falling · cold · untouched

Layer 2  PREFERENCES   how do they like to be taught?
                       explicit · observed · feedback — each with confidence

Layer 3  CONTEXT       what matters for THIS request?
                       personalization.render(snapshot, task)

Layer 4  SKILLS        how should a teaching mode use all of it?
                       Skill defines the mode; the model parameterises it
```

---

## The rule everything obeys

**A model may propose; it may never assert.** Every claim the app makes about a
student traces to a stored row. Nothing on these four layers is model-generated,
so nothing here can drift from what actually happened.

This has a sharp consequence worth stating plainly: **an inference is never
written into the student's own settings.** `user_settings.student_model` holds
what they typed and is shown back to them in Settings; writing a guess there
would display a sentence they never wrote as though they had. Inferences live
separately, are labelled as observations in prompts, and are inspectable and
resettable.

---

## Layer 1 — Knowledge

`services/student_model.py`. One concurrent read pass, `snapshot(user_id)`,
which every other layer derives from.

### The unit is a concept, not a topic

`ConceptView` is built by joining `quizzes.questions[i].subtopic` against
`quiz_results.answers[i]`. Both have existed since quiz tagging shipped; the
join is what was missing. It matters because a topic average is not actionable:

```
Attention — 71%                         ← nothing to do with this
  ├─ cross-attention        40%   ↓     ← open this
  ├─ positional encoding    92%
  └─ softmax scaling        78%   ↑
```

Concepts are **normalized tags, never rows** (`normalize_concept` →
`trim().lower()`), computed per request. Nothing is stored, so nothing goes
stale — the same rule the Gap Map follows.

| Signal | Means |
|---|---|
| `weak_concepts` | below 60% accuracy |
| `falling_concepts` | later-half accuracy is ≥10 points below earlier-half |
| `cold` | real history, then nothing for ≥10 days |
| `untouched` | material uploaded, never used |
| `neglected_subjects` | a subject that lost the week to another |

**Weak and falling are different things.** A concept climbing from 40% to 55%
and one sliding from 85% to 70% need opposite advice, and an average cannot
separate them. That distinction is why this layer exists at all.

### Gates against noise

Every signal has a floor, because a confident wrong claim is worse than
silence: 3 questions before a concept has an accuracy, 4 attempts before it has
a trend, 10 points before a move counts as a direction, 4 active days before
behaviour counts as a habit.

---

## Layer 2 — Preferences

`services/preferences.py`. A preference is never a bare string — it carries
where it came from and how sure we are, because those decide whether it is
allowed to change how the student is taught.

```
Preference
├─ key           explanation.length
├─ value         concise
├─ source        explicit | observed | feedback | experiment
├─ confidence    0.0 – 1.0
├─ evidence      11
└─ because       "from 11 pieces of feedback you gave"
```

### Precedence

`explicit > experiment > feedback > observed`, enforced in `_put` rather than by
call order, so a derivation added later cannot silently start overriding
something the student typed. Observed preferences are additionally capped at
0.75 confidence — behaviour informs, it never overrules.

### How confidence moves

```
agreeing evidence      c += (1 − c) × w(source)
contradicting evidence c −= c × w(source) × 1.5
decay                  c ×= 0.5 ^ (days_since_confirmed / 90)
```

Contradiction is weighted **1.5× harder than confirmation**. Being wrong about a
student costs more than being unsure about them, so a preference is expensive to
acquire and cheap to lose — it fails safe.

When confidence in the leading value falls below 0.12 the preference **flips**
rather than sitting at zero. A student whose taste changes gets followed, not
out-voted by their own history.

Below `ACT_THRESHOLD` (0.35) a preference is known but changes nothing. One tap
is an opinion; it takes a second before the app writes differently.

### What may be modelled

`preferences.KEYS` is a **closed whitelist**. A key not on it cannot be
resolved, recorded or injected into a prompt. This is a structural bound on what
the subsystem can ever learn — worth more than a prompt instruction telling a
model not to infer sensitive attributes, because it does not depend on the model
complying. Nothing on it touches health, beliefs, demographics or anything else
outside how someone likes to be taught.

---

## Layer 3 — Context

`services/personalization.py`. One function per task, each returning a small
block. The budget is ~6 lines.

This layer exists because all six consumers previously received an *identical*
block: chat paid tokens for cold-topic lists it cannot act on, and quiz
generation was told the student's preferred tone, which changes nothing about a
multiple-choice question.

| Task | Gets | Deliberately excluded |
|---|---|---|
| `chat` | explanation prefs, local weak concepts, falling concepts | streaks, other subjects, cold topics |
| `quiz` | weak concepts, already-solid concepts, exam goal | tone, explanation style |
| `cards` | weak concepts, exam goal | explanation style |
| `notes` | structure and depth prefs, concepts needing room | quiz scores, streak |
| `brief` | the cross-subject picture | explanation preferences |

`render(snapshot, task)` is pure; `build(user_id, task)` does the read pass.
Callers already holding a snapshot use `render` so Home doesn't pay for the read
twice.

---

## Layer 4 — Skills

A Skill defines a **teaching mode** (instructions, output format, memory scope,
capabilities). The student model **parameterises** it.

```
Socratic Tutor  +  weak on Bellman equations
                =  Socratic questions aimed at Bellman equations
```

`personalization.for_skill()` composes them into one instruction. Previously the
skill fragment and the student block were appended as separate system
paragraphs, and nothing told the model the second should shape the first.

---

## The feedback loop

The one input that is genuinely **collected** rather than derived — an opinion
about an answer is an event, and an unrecorded event is gone. That is what earns
`response_feedback` a table when nothing else here has one.

### Taxonomy

Each kind declares which preference key it is evidence for **at definition
time**, so learning is mechanical rather than interpretive:

| Tap | Key | Evidence for |
|---|---|---|
| Too long | `explanation.length` | `concise` |
| More detail | `explanation.length` | `detailed` |
| Too complicated | `explanation.depth` | `simpler` |
| Too basic | `explanation.depth` | `deeper` |
| Need an example | `explanation.opens_with` | `example_first` |
| Theory first | `explanation.opens_with` | `theory_first` |
| Just the answer | `interaction.answer_mode` | `direct` |
| This helped | — | refreshes recency only |
| Regenerate | — | lowers confidence, points nowhere |

`useful` deliberately does **not** raise confidence: it says the answer landed,
not which of five settings made it land, and crediting them all is how a system
talks itself into certainty it hasn't earned. `regenerate` is the mirror —
dissatisfaction with no stated direction.

### Signals, in order of how much they cost the student

```
Implicit   (free)      language in their own turns · regenerate · behaviour
Passive    (one tap)   👍 / 👎, always available, never asks
Active     (a question) only on genuine uncertainty — see below
```

**Most evidence should never require asking.** A student who types "can you
explain that more simply" has given the clearest possible signal for free.
`preferences._resolve_implicit` mines those turns and files them as `observed`,
so a regex reading phrasing can inform but never outrank a deliberate tap. High
precision by design — a missed signal costs nothing, a false one teaches the app
something wrong and takes several contradicting taps to undo.

A dimension pulled both ways is **dropped**, not averaged: that is
context-dependence, which is a scoped-preference problem, not a global verdict.

### When it asks

The principle is **not** "when did we last ask" but **"is asking worth the
interruption"**. Concretely, an active question fires only when the dimension is
unknown *or* the evidence is contradictory, *and* it matters for what is
happening right now.

Two things that must never trigger a question: **a new chat, and a new topic.**
New chat ≠ new student; new topic ≠ new preference. The model is global and
carries over.

Concretely, in `web/src/features/chat/feedbackPolicy.ts`:

| Trigger | Why it earns the interruption |
|---|---|
| **Confusion with no direction** — "I don't get it", "I'm lost" | They are stuck and haven't said *how*. Which dimension is wrong is genuinely unknown. |
| **A second consecutive regeneration** | Asking again says the settings are wrong without saying what to change. One is noise; two is signal. |
| **A contested dimension** | Evidence exists and disagrees with itself, so it will not resolve on its own — more of the same signal keeps cancelling. |

And what must never trigger one:

| Non-trigger | Why |
|---|---|
| **A directed request** — "explain simpler", "more detail" | Already said, already recorded by `_resolve_implicit`. Asking after would be asking a question the student just answered. |
| **A new chat, topic or subject** | New chat ≠ new student; new topic ≠ new preference. Nothing in the policy observes these events, so they cannot become triggers by accident. |
| **Time passing** | Named explicitly because it was the original rule. |

`MIN_TURNS_BETWEEN_OFFERS` and `AFTER_FEEDBACK_GAP` survive as **floors** under
those triggers — they can suppress an ask, never cause one. `isSettled` retires
a dimension once another tap would not move it, so asking fades out as the model
gets sure.

> **Status:** built, both halves. The passive thumbs render under every
> completed answer and record on one tap; the reason chips appear only on a
> thumbs-down (an ask the student invited) or on one of the three triggers
> above. A thumbs-down deliberately records *nothing* by itself — "wrong" with
> no direction would lower every leading preference on no information — it
> opens the chips, and the chip carries the signal.
>
> Not built: the A/B experiment arm (`source: "experiment"`), and the
> regenerate control itself. The `regenerate` kind exists in the taxonomy and
> the backend already knows what to do with it, but no UI can send one — see
> `plan.md` N18.

### Interpretability

`chat_messages.meta` records what shaped each answer —
`{chars, had_sources, skill_ids, prefs_applied}` — so feedback about a response
can be attributed to the settings that produced it.

### Control

`GET /me/preferences` returns everything believed, with source, confidence and a
plain-language reason. Settings renders it and offers a reset that clears
collected feedback while leaving explicit settings (yours) and observed
behaviour (recomputed anyway) alone.

---

## Performance

Free-tier discipline applies here like everywhere else.

- `snapshot()` is **10 selects**, gathered. `quizzes` is read *flat* rather than
  nested onto `quiz_results`, because a nested select repeats the whole
  `questions` blob once per attempt — a quiz taken four times would ship its
  questions four times.
- `preference_context()` is a **3-select** read for callers that only need
  preferences. `/me/preferences` runs on every chat mount to drive the ask
  policy, so serving it from the full snapshot made a UI affordance the most
  expensive read in the app.
- Chat, quiz, cards and notes generation all **gather** their independent reads.
  Chat's pre-model path went from six sequential round trips to two waves.
- Bounded windows: 200 quiz results, 60 quizzes, 300 feedback events.
- All aggregation is dict-and-list folding in Python. Nothing loads a model or
  holds a large buffer.

---

## What is not built

Deliberately, with the reasoning recorded so it isn't re-litigated:

- **No `student_preferences` table.** Every preference derivable today is a pure
  function of the snapshot, so storing it would be a cache that can disagree
  with its source. Feedback *events* are stored because they cannot be
  recomputed; the resolved preferences on top of them are not.
- **No A/B teaching experiments yet.** Two generations per question doubles
  token cost on the highest-traffic endpoint and burns the rate limiter's
  budget. It needs evidence that single-signal feedback is insufficient — see
  `plan.md`.
- **No time-of-day modelling.** `daily_activity` is keyed by day with no
  timestamps, so it isn't supported by the schema, and it is the weakest signal
  on the list.
- **No scoped (subject/topic) preferences.** `response_feedback.concept` is
  *recorded* so scoping is possible later without a backfill, but resolution is
  global. Precedence is cheap to define and expensive to populate; let the data
  justify each level.
- **No feedback on inline `/ai`.** It returns a fragment that is inserted into a
  document the student then edits — whether they kept it already answers the
  question, and persisting a row purely to enable a thumbs-up is the wrong
  trade.
