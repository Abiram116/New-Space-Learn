"""Thompson-sampling bandit for explanation style — the one place this app
tries something on a student rather than only reacting to them.

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
(simpler/deeper), `explanation.opens_with` (example_first/theory_first) — if
a chat is about to render with no actionable preference for a key, this
module draws one of its two candidate values via Thompson sampling and
applies it as a `source="experiment"` preference, exactly as if it had been
resolved normally. `personalization._style()` cannot tell the difference,
which is the point: the rendered instruction reads identically either way.

## The loop this closes

1. `sample()` is called once per chat response, per style key with nothing
   actionable yet. It draws `value ~ argmax_v Beta(alpha_v, beta_v).sample()`
   for each candidate value `v` of that key, using this module's own read of
   history (see below) for the posteriors.
2. The caller (`personalization.render_chat`) records which value was
   actually applied to each key on `chat_messages.meta.style` — the ledger
   this module reads back next time.
3. If the student later taps a feedback chip on that message
   (`response_feedback.target_id = chat_messages.id`), the reward is
   `useful` → 1 for every key applied to that message, `regenerate` → 0 for
   all of them (dissatisfaction with no stated reason, same rule
   `preferences._apply_directionless` uses), and a directional chip
   (`too_long`, `want_theory`, ...) → 1 if it agrees with the value that was
   applied, 0 if it contradicts it. Silence is not a reward: a message with
   no feedback contributes nothing, in either direction.
4. Rewards decay with a 60-day half-life, same Beta(1,1)-plus-decayed-
   evidence shape `student_model._mastery_from_evidence` uses for mastery —
   a different posterior over different evidence, but the same reasoning:
   what worked for a student a season ago is weaker evidence than what
   worked last week.

No new table. The ledger is `chat_messages.meta` (already written on every
turn) plus `response_feedback` (already collected) — both computed at read
time, bounded to a recent window, same "derive, don't cache" discipline
`preferences.py`'s own docstring lays out.

## Where exploration stops

Once a key has an actionable preference from any other source (explicit,
feedback, or a strong enough observed pattern), `sample()` skips it
entirely — see the `keys` filter below. The bandit only ever fills a gap; it
never contests a preference the student has actually earned.
"""

from __future__ import annotations

import random
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

#: Reward half-life, in days. Shorter than a mastery half-life would need to
#: be — a style experiment either lands or it doesn't within a few
#: conversations, and stale reward evidence should stop steering it quickly.
REWARD_HALF_LIFE_DAYS = 60.0

#: How many recent feedback rows to read for reward evidence. Bounded for the
#: same reason `student_model.FEEDBACK_WINDOW` is: this runs on chat sends,
#: and the oldest evidence is the most decayed anyway.
FEEDBACK_WINDOW = 200

#: What every arm starts at with no evidence: Beta(1,1), i.e. "no idea yet."
_PRIOR = (1.0, 1.0)


async def sample(
    user_id: str,
    prefs: dict[str, Preference],
    *,
    rng: random.Random | None = None,
) -> dict[str, Preference]:
    """Thompson-sampled `source="experiment"` preferences for style keys
    `prefs` has nothing actionable for.

    Returns only the keys worth filling — often empty, once every dimension
    has a real preference behind it, in which case this makes no DB call at
    all. `rng` is injectable for deterministic tests; production calls it
    with none and gets a fresh `random.Random()`.
    """
    keys = [k for k in ARMS if not (prefs.get(k) and prefs[k].actionable)]
    if not keys:
        return {}

    rng = rng or random.Random()
    posteriors = await _posteriors(user_id)

    out: dict[str, Preference] = {}
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
            # Deliberately not the drawn probability: that number describes
            # how lucky this draw was, not how sure we are of anything.
            # This IS being applied to the response, so it renders and gets
            # recorded exactly like an actionable preference from any other
            # source — see `Preference.actionable` and `_style()`.
            confidence=1.0,
            evidence_count=0,
            because="trying this to see what works for you",
        )
    return out


async def _posteriors(user_id: str) -> dict[tuple[str, str], tuple[float, float]]:
    """`{(key, value): (alpha, beta)}`, folded from recent feedback on recent
    chat messages — no new table, both reads bounded, both computed fresh
    every call per the module docstring.
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
        return {}

    messages = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "id": f"in.({','.join(target_ids)})"},
        select="id,meta",
    )
    style_by_message: dict[str, dict[str, str]] = {
        m["id"]: (m.get("meta") or {}).get("style") or {} for m in messages
    }

    now = datetime.now(UTC)
    posteriors: dict[tuple[str, str], tuple[float, float]] = {}

    def bump(key: str, value: str, reward: float, at: str) -> None:
        w = _decay(at, now)
        alpha, beta = posteriors.get((key, value), _PRIOR)
        posteriors[(key, value)] = (alpha + reward * w, beta + (1.0 - reward) * w)

    for row in feedback_rows:
        style = style_by_message.get(str(row.get("target_id") or ""))
        if not style:
            continue  # Feedback on a message with no recorded style, or an
            # older message from before this shipped — nothing to score.
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
