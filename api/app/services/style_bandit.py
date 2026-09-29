"""Thompson-sampling bandit for explanation style and teaching strategy — the
one place this app tries something on a student rather than only reacting to
them.

## Why this exists

`preferences.py` can only ever tell you what a student has already revealed,
by typing, tapping a chip, or behaving a certain way for weeks. A student who
has done none of those for `explanation.length` gets silence: no line in the
chat prompt, the model picks whatever it picks. That is honest — nothing here
fabricates a preference — but it also means the app never actively learns
which value tends to land better for THIS student versus which one they simply
haven't complained about yet.

So: for the three style dimensions the feedback chips drive —
`explanation.length` (concise/detailed), `explanation.depth`
(simpler/deeper), `explanation.opens_with` (example_first/theory_first) — and
for one strategic dimension, `teaching.strategy` (which of six ways to open an
explanation, learned per subject — see below), if a chat is about to render
with no actionable preference for a key, this module draws a candidate value
via Thompson sampling and applies it as a `source="experiment"` preference,
exactly as if it had been resolved normally. `personalization._style()`
cannot tell the difference, which is the point: the rendered instruction
reads identically either way.

## The loop this closes

1. `sample()` is called once per chat response, per key with nothing
   actionable yet. It draws `value ~ argmax_v Beta(alpha_v, beta_v).sample()`
   for each candidate value `v`, using this module's own read of history (see
   below) for the posteriors.
2. The caller (`personalization.render_chat`) records which value was
   actually applied to each key on `chat_messages.meta.style` — the ledger
   this module reads back next time.
3. If the student later taps a feedback chip on that message
   (`response_feedback.target_id = chat_messages.id`), the reward is
   `useful` → 1 for every key applied to that message, `regenerate` → 0 for
   all of them (dissatisfaction with no stated reason, same rule
   `preferences._apply_directionless` uses), and for the three STYLE arms a
   directional chip (`too_long`, `want_theory`, ...) → 1 if it agrees with the
   value that was applied, 0 if it contradicts it. Silence is not a reward: a
   message with no feedback contributes nothing, in either direction.
4. Rewards decay with a 60-day half-life, same Beta(1,1)-plus-decayed-
   evidence shape `student_model._mastery_from_evidence` uses for mastery —
   a different posterior over different evidence, but the same reasoning:
   what worked for a student a season ago is weaker evidence than what
   worked last week.

No new table. The ledger is `chat_messages.meta` (already written on every
turn) plus `response_feedback` (already collected) — both computed at read
time, bounded to a recent window, same "derive, don't cache" discipline
`preferences.py`'s own docstring lays out (`## The read cache` below is an
optimisation over WHEN that read happens, not a second source of truth).

## Where exploration stops

Once a key has an actionable preference from any other source (explicit,
feedback, or a strong enough observed pattern), `sample()` skips it
entirely — see the `keys` filter below. The bandit only ever fills a gap; it
never contests a preference the student has actually earned.

## Teaching strategy: learned per subject, not per student

`teaching.strategy` is a different kind of arm from the three style knobs
above, in three ways:

- **Six arms, not two**: `example_first`, `analogy_first`, `step_by_step`,
  `theory_first`, `code_first`, `socratic` — see `STRATEGY_ARMS`.
- **`code_first` starts pessimistic**: `Beta(1, 2)` instead of `Beta(1, 1)`.
  Nothing here special-cases "this subject is programming" — that would be a
  heuristic pretending to be a model. Instead the prior mildly discourages
  trying code-first on a subject where it might make no sense at all, and
  lets real reward evidence overturn that quickly if it turns out to fit.
- **Context is the subject, not just the student.** A strategy that lands in
  Linear Algebra says little about what will land in History. So posteriors
  are per `(subject_id, arm)`, blended hierarchically with the student's
  global tendency across all subjects:

      posterior = Beta(prior) + 0.3 × (decayed reward evidence, ANY subject)
                              + 1.0 × (decayed reward evidence, THIS subject)

  A brand-new subject starts from a damped read of what has worked for this
  student everywhere else (`GLOBAL_STRATEGY_WEIGHT = 0.3`) and specialises as
  its own evidence accumulates, weighted a full point each
  (`SUBJECT_STRATEGY_WEIGHT = 1.0`) — so a subject with real history quickly
  outweighs the inherited global prior rather than being permanently diluted
  by it.
- **Reward mapping is simpler.** For the three style arms, a directional chip
  (`too_long`, `want_theory`, ...) scores 1 or 0 depending on whether it
  argues for the exact value that was applied — `too_long` agrees with
  `concise`, contradicts `detailed`. `teaching.strategy` skips that: every
  directional chip means "this didn't land," full stop, so it scores 0 for
  whichever strategy arm was in force, same as `regenerate`. Only `useful`
  scores 1. Trying to map "wanted an example" onto "was the *strategy*
  wrong, specifically" would be reading a signal the chip was never designed
  to carry — the chips describe the STYLE of the explanation, not which of
  six ways it opened.

**Gating**: explored only when (a) `teaching.strategy` itself has nothing
actionable yet, (b) the caller has a subject to explore *within* — no
subject, no context, nothing to learn from, so `sample()` skips it rather
than drawing blind — and (c) the student hasn't already told the app how to
teach them in their own words. That third condition is `explanation.note`:
the free-text fold of `learning_style` / `teaching_preference` from intake
(`preferences._resolve_explicit`). The simplest honest rule available is "an
explicit statement about how to teach this student, in general, counts as
covering the strategy dimension too" — a note whose whole content is
literally what opening move to use. It is coarser than trying to parse
whether the note *specifically* names an opening strategy (which would need
another regex taxonomy, guessing at intent from free text — the exact thing
`preferences.py`'s own docstring warns against), but it fails on the safe
side: it under-explores rather than contradicting something the student
explicitly asked for.

## The read cache

The two SELECTs this module needs (`response_feedback`, then
`chat_messages` for the messages that feedback points at) run on `send_chat`,
the highest-traffic request in the app, on a 0.1 vCPU / 512 MB box. Almost
every consecutive chat turn from the same student asks the identical
question of the identical evidence — nothing about a single turn changes
`response_feedback` — so re-reading it every turn buys nothing but latency
and DB load.

`_cached_reads` memoizes the two SELECTs (not the folded posteriors — the
fold is microseconds over ≤200 rows and re-running it keeps the caching
surface small) per user for `_READ_CACHE_TTL_S`. `invalidate()` drops a
user's entry immediately when `/feedback` records or deletes an event, so a
tap is reflected on the very next turn rather than waiting out the TTL — the
TTL is a safety net bounding staleness from any path that doesn't call
`invalidate()`, not the freshness mechanism itself (same split `me/brief.py`
draws for its own cache).

`sample()` still makes zero DB calls when nothing needs exploring: the
gating check runs first and short-circuits before either `_posteriors` or
`_strategy_evidence` — and therefore `_cached_reads` — is ever touched.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from . import supabase
from .preferences import FEEDBACK_KINDS, Preference

#: The three style keys the feedback chips drive, and the two values each
#: can take. Mirrors the keys `preferences.FEEDBACK_KINDS` maps chips onto —
#: every arm here is a value some chip can actually argue for, so a sampled
#: experiment always lands somewhere a future tap can score.
ARMS: dict[str, tuple[str, str]] = {
    "explanation.length": ("concise", "detailed"),
    "explanation.depth": ("simpler", "deeper"),
    "explanation.opens_with": ("example_first", "theory_first"),
}

#: The preference key `teaching.strategy` lives under, and its six candidate
#: values. See the module docstring's "Teaching strategy" section for why
#: this arm is shaped so differently from the three above.
STRATEGY_KEY = "teaching.strategy"
STRATEGY_ARMS: tuple[str, ...] = (
    "example_first",
    "analogy_first",
    "step_by_step",
    "theory_first",
    "code_first",
    "socratic",
)

#: Per-arm prior. Every arm starts at the uninformative `Beta(1, 1)` except
#: `code_first`, which starts mildly skeptical — see the module docstring.
STRATEGY_PRIOR: dict[str, tuple[float, float]] = {arm: (1.0, 1.0) for arm in STRATEGY_ARMS}
STRATEGY_PRIOR["code_first"] = (1.0, 2.0)

#: How much a subject's OWN decayed reward evidence counts, versus the
#: student's decayed evidence from every OTHER subject too. See the
#: hierarchical formula in the module docstring.
SUBJECT_STRATEGY_WEIGHT = 1.0
GLOBAL_STRATEGY_WEIGHT = 0.3

#: Reward half-life, in days. Shorter than a mastery half-life would need to
#: be — a style experiment either lands or it doesn't within a few
#: conversations, and stale reward evidence should stop steering it quickly.
REWARD_HALF_LIFE_DAYS = 60.0

#: How many recent feedback rows to read for reward evidence. Bounded for the
#: same reason `student_model.FEEDBACK_WINDOW` is: this runs on chat sends,
#: and the oldest evidence is the most decayed anyway.
FEEDBACK_WINDOW = 200

#: What every style arm starts at with no evidence: Beta(1,1), i.e. "no idea
#: yet." (`teaching.strategy` uses `STRATEGY_PRIOR` instead.)
_PRIOR = (1.0, 1.0)

#: Human-readable phrasing of each `STRATEGY_ARMS` value, for a read-only UI
#: surface (Profile's "How you learn best"). One sentence describing the
#: student, distinct from `personalization._STRATEGY_INSTRUCTIONS`, which
#: instructs the model rather than describing the person.
ARM_DISPLAY: dict[str, str] = {
    "example_first": "Learns best through examples",
    "analogy_first": "Learns best through analogies",
    "step_by_step": "Learns best working through it step by step",
    "theory_first": "Learns best starting from the theory",
    "code_first": "Learns best from working code",
    "socratic": "Learns best being asked questions rather than told answers",
}

#: Below this many effective (decayed) observations, a subject's strategy
#: posterior is "we're still guessing," not a fact worth surfacing in a UI —
#: see `strategy_summary`.
MIN_SUMMARY_EVIDENCE = 5.0


async def sample(
    user_id: str,
    prefs: dict[str, Preference],
    *,
    subject_id: str | None = None,
    subject_by_subspace: dict[str, str] | None = None,
    rng: random.Random | None = None,
) -> dict[str, Preference]:
    """Thompson-sampled `source="experiment"` preferences for whichever keys
    `prefs` has nothing actionable for — the three style arms plus, when a
    subject is given, `teaching.strategy`.

    `subject_id` is the subject of the subspace this chat turn is in
    (`None` skips `teaching.strategy` entirely — see the module docstring's
    gating rule). `subject_by_subspace` is `{subspace_id: subject_id}` for
    every subspace this student has, used to bucket PAST reward evidence by
    subject; callers already hold this for free from
    `student_model.Snapshot.topics`, so passing it costs no extra read.

    Returns only the keys worth filling — often empty, once every dimension
    has a real preference behind it, in which case this makes no DB call at
    all. `rng` is injectable for deterministic tests; production calls it
    with none and gets a fresh `random.Random()`.
    """
    keys = [k for k in ARMS if not (prefs.get(k) and prefs[k].actionable)]
    explore_strategy = bool(subject_id) and not (
        (prefs.get(STRATEGY_KEY) and prefs[STRATEGY_KEY].actionable)
        or (prefs.get("explanation.note") and prefs["explanation.note"].actionable)
    )
    if not keys and not explore_strategy:
        return {}

    rng = rng or random.Random()
    out: dict[str, Preference] = {}

    if keys:
        posteriors = await _posteriors(user_id)
        for key in keys:
            draws = {
                value: rng.betavariate(*posteriors.get((key, value), _PRIOR))
                for value in ARMS[key]
            }
            chosen = max(draws, key=lambda v: draws[v])
            out[key] = Preference(
                key=key,
                value=chosen,
                source="experiment",
                # Deliberately not the drawn probability: that number
                # describes how lucky this draw was, not how sure we are of
                # anything. This IS being applied to the response, so it
                # renders and gets recorded exactly like an actionable
                # preference from any other source — see
                # `Preference.actionable` and `_style()`.
                confidence=1.0,
                evidence_count=0,
                because="trying this to see what works for you",
            )

    if explore_strategy:
        strategy_posteriors = await _strategy_posteriors(
            user_id, subject_id, subject_by_subspace
        )
        draws = {
            arm: rng.betavariate(*strategy_posteriors[arm]) for arm in STRATEGY_ARMS
        }
        chosen = max(draws, key=lambda v: draws[v])
        out[STRATEGY_KEY] = Preference(
            key=STRATEGY_KEY,
            value=chosen,
            source="experiment",
            confidence=1.0,
            evidence_count=0,
            because="trying this teaching approach to see what lands for this subject",
        )

    return out


async def _posteriors(user_id: str) -> dict[tuple[str, str], tuple[float, float]]:
    """`{(key, value): (alpha, beta)}` for the three STYLE arms, folded from
    recent feedback on recent chat messages.

    `teaching.strategy` entries on `chat_messages.meta.style` are
    deliberately ignored here — that arm has its own prior, its own
    hierarchical blend and its own (simpler) reward mapping, folded
    separately by `_strategy_evidence`. Folding it into this generic
    `useful`/`regenerate` loop too would double-apply `_PRIOR` instead of
    `STRATEGY_PRIOR` and skip the per-subject split entirely.
    """
    feedback_rows, by_id = await _cached_reads(user_id)
    if not by_id:
        return {}

    now = datetime.now(UTC)
    posteriors: dict[tuple[str, str], tuple[float, float]] = {}

    def bump(key: str, value: str, reward: float, at: str) -> None:
        w = _decay(at, now)
        alpha, beta = posteriors.get((key, value), _PRIOR)
        posteriors[(key, value)] = (alpha + reward * w, beta + (1.0 - reward) * w)

    for row in feedback_rows:
        entry = by_id.get(str(row.get("target_id") or ""))
        if not entry:
            continue  # Feedback on a message with no recorded style, or an
            # older message from before this shipped — nothing to score.
        style = {k: v for k, v in entry["style"].items() if k in ARMS}
        if not style:
            continue
        kind = str(row.get("kind") or "")
        at = str(row.get("created_at") or "")

        if kind == "useful":
            # Confirms every dimension that was in force on this message —
            # same reasoning as `preferences._apply_directionless`, applied
            # per-arm instead of per-key.
            for key, value in style.items():
                bump(key, value, 1.0, at)
        elif kind == "regenerate":
            # Dissatisfaction with no stated reason: real evidence the
            # applied settings were wrong, no evidence about what would be
            # better — penalise every arm this message used.
            for key, value in style.items():
                bump(key, value, 0.0, at)
        else:
            spec = FEEDBACK_KINDS.get(kind)
            if spec is None or spec.key not in ARMS or spec.value is None:
                continue
            applied = style.get(spec.key)
            if applied:
                bump(spec.key, applied, 1.0 if applied == spec.value else 0.0, at)

    return posteriors


async def _strategy_evidence(
    user_id: str, subject_by_subspace: dict[str, str] | None
) -> tuple[dict[str, tuple[float, float]], dict[str, dict[str, tuple[float, float]]]]:
    """Decayed `(reward, 1 - reward)` evidence sums for `teaching.strategy`,
    split into `(global, by_subject)` — evidence only, no prior baked in
    (unlike `_posteriors`, whose dict already has `_PRIOR` folded into every
    bumped entry). `_strategy_posteriors` adds `STRATEGY_PRIOR` and the
    hierarchical weights on top; `strategy_summary` reads the per-subject
    half directly, unblended, for exactly the reason explained there.

    Reward mapping: `useful` → 1, everything else recognised (`regenerate`,
    every directional chip) → 0 — see the module docstring for why this is
    simpler than the style arms' agree/contradict mapping.
    """
    feedback_rows, by_id = await _cached_reads(user_id)
    subject_by_subspace = subject_by_subspace or {}
    now = datetime.now(UTC)

    global_evid: dict[str, tuple[float, float]] = {}
    by_subject: dict[str, dict[str, tuple[float, float]]] = {}

    def bump(store: dict[str, tuple[float, float]], arm: str, reward: float, w: float) -> None:
        a, b = store.get(arm, (0.0, 0.0))
        store[arm] = (a + reward * w, b + (1.0 - reward) * w)

    for row in feedback_rows:
        entry = by_id.get(str(row.get("target_id") or ""))
        if not entry:
            continue
        arm = entry["style"].get(STRATEGY_KEY)
        if not arm or arm not in STRATEGY_PRIOR:
            continue
        kind = str(row.get("kind") or "")
        if kind not in FEEDBACK_KINDS:
            continue
        reward = 1.0 if kind == "useful" else 0.0
        w = _decay(str(row.get("created_at") or ""), now)

        bump(global_evid, arm, reward, w)
        subject_id = subject_by_subspace.get(entry.get("subspace_id") or "")
        if subject_id:
            bump(by_subject.setdefault(subject_id, {}), arm, reward, w)

    return global_evid, by_subject


async def _strategy_posteriors(
    user_id: str, subject_id: str | None, subject_by_subspace: dict[str, str] | None
) -> dict[str, tuple[float, float]]:
    """`{arm: (alpha, beta)}` for `teaching.strategy`, blended per the
    hierarchical formula in the module docstring."""
    global_evid, by_subject = await _strategy_evidence(user_id, subject_by_subspace)
    subject_evid = by_subject.get(subject_id or "", {})

    out: dict[str, tuple[float, float]] = {}
    for arm in STRATEGY_ARMS:
        prior_a, prior_b = STRATEGY_PRIOR[arm]
        ga, gb = global_evid.get(arm, (0.0, 0.0))
        sa, sb = subject_evid.get(arm, (0.0, 0.0))
        out[arm] = (
            prior_a + GLOBAL_STRATEGY_WEIGHT * ga + SUBJECT_STRATEGY_WEIGHT * sa,
            prior_b + GLOBAL_STRATEGY_WEIGHT * gb + SUBJECT_STRATEGY_WEIGHT * sb,
        )
    return out


@dataclass(frozen=True)
class StrategySummary:
    """One subject's best-performing `teaching.strategy` arm, for a
    read-only UI surface later (Settings, or a card on the subject page) —
    see `strategy_summary`."""

    subject_id: str
    arm: str
    #: Posterior mean, 0-1: roughly "how often this has worked when tried."
    mean: float
    #: Effective (decayed) observation count behind `mean` — how much of
    #: this is real evidence versus the prior. Always `>= MIN_SUMMARY_EVIDENCE`.
    evidence: float


async def strategy_summary(
    user_id: str, subject_by_subspace: dict[str, str] | None
) -> list[StrategySummary]:
    """Best `teaching.strategy` arm per subject — e.g. "learns best through
    examples" — for subjects with enough evidence to say so honestly.

    Deliberately reads the RAW per-subject evidence from `_strategy_evidence`
    rather than the hierarchical blend `_strategy_posteriors` samples from.
    The blend exists so a new subject can borrow the student's global
    tendency to decide what to TRY next — that borrowed 0.3 weight is a
    reasonable basis for an experiment, but not for a claim shown back to the
    student. "You learn ML best through examples" must be backed by ML's own
    evidence, not by five other subjects' worth of borrowed signal wearing
    ML's name. A subject below `MIN_SUMMARY_EVIDENCE` effective observations
    is left out entirely rather than reported with padded confidence.
    """
    _, by_subject = await _strategy_evidence(user_id, subject_by_subspace)

    out: list[StrategySummary] = []
    for subject_id, evid in by_subject.items():
        best: StrategySummary | None = None
        for arm in STRATEGY_ARMS:
            prior_a, prior_b = STRATEGY_PRIOR[arm]
            a_evid, b_evid = evid.get(arm, (0.0, 0.0))
            n = a_evid + b_evid
            if n < MIN_SUMMARY_EVIDENCE:
                continue
            mean = (prior_a + a_evid) / (prior_a + prior_b + n)
            if best is None or mean > best.mean:
                best = StrategySummary(subject_id, arm, round(mean, 3), round(n, 1))
        if best is not None:
            out.append(best)
    return out


def _decay(at: str, now: datetime, half_life_days: float = REWARD_HALF_LIFE_DAYS) -> float:
    """Half-life decay from `at` to `now`. Unparsable timestamps decay to
    (effectively) nothing rather than raising."""
    try:
        stamp = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    days = max(0.0, (now - stamp).total_seconds() / 86400)
    return 0.5 ** (days / half_life_days)


# ── Read cache ───────────────────────────────────────────────────────────
#
# In-process, not a database table, same reasoning as `me/brief.py`'s own
# cache: one worker, a lost cache on restart costs one re-read per student,
# far cheaper than persisting it. See the module docstring's "The read
# cache" section for why this exists and what it does and doesn't cover.

_READ_CACHE_TTL_S = 600.0
_READ_CACHE_MAX = 2048
#: `{user_id: (cached_at, feedback_rows, {message_id: {"style", "subspace_id"}})}`
_read_cache: dict[str, tuple[float, list[dict], dict[str, dict]]] = {}


async def _cached_reads(user_id: str) -> tuple[list[dict], dict[str, dict]]:
    """The two SELECTs every fold in this module reads from, memoized per
    user for `_READ_CACHE_TTL_S`.

    Both reads stay exactly as bounded as before caching existed —
    `FEEDBACK_WINDOW` rows, three columns off `response_feedback`, three off
    `chat_messages` keyed by the feedback's own target ids — a cache hit just
    means most chat turns skip them entirely.
    """
    now = time.monotonic()
    entry = _read_cache.get(user_id)
    if entry is not None:
        cached_at, feedback_rows, by_id = entry
        if now - cached_at <= _READ_CACHE_TTL_S:
            return feedback_rows, by_id

    feedback_rows, by_id = await _reads(user_id)

    if len(_read_cache) >= _READ_CACHE_MAX and user_id not in _read_cache:
        # Evict the oldest entry — insertion order is preserved by dict, and
        # the pop+reinsert below moves a refreshed key to the end, so the
        # first key really is the least recently (re)read.
        _read_cache.pop(next(iter(_read_cache)))
    _read_cache.pop(user_id, None)
    _read_cache[user_id] = (now, feedback_rows, by_id)
    return feedback_rows, by_id


def invalidate(user_id: str) -> None:
    """Drop this user's cached reads.

    Called from `/feedback`'s POST and DELETE handlers the moment the
    evidence actually changes, so a tap is reflected on the student's very
    next chat turn rather than waiting out `_READ_CACHE_TTL_S`. Harmless to
    call for a user with nothing cached.
    """
    _read_cache.pop(user_id, None)


async def _reads(user_id: str) -> tuple[list[dict], dict[str, dict]]:
    """The uncached read pass: recent feedback, plus the recorded style (and
    originating subspace) of every message that feedback points at.

    `by_id` is `{message_id: {"style": {...}, "subspace_id": "..."}}` — the
    one shape every fold in this module reads from, so a schema change here
    (a new column, say) only touches this one function.
    """
    feedback_rows = await supabase.db_select(
        "response_feedback",
        filters={"user_id": f"eq.{user_id}"},
        select="kind,target_id,created_at",
        order="created_at.desc",
        limit=FEEDBACK_WINDOW,
    )
    target_ids = sorted({r["target_id"] for r in feedback_rows if r.get("target_id")})
    if not target_ids:
        return feedback_rows, {}

    messages = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "id": f"in.({','.join(target_ids)})"},
        select="id,meta,subspace_id",
    )
    by_id = {
        m["id"]: {
            "style": (m.get("meta") or {}).get("style") or {},
            "subspace_id": m.get("subspace_id"),
        }
        for m in messages
    }
    return feedback_rows, by_id
