"""Learning preferences, with provenance.

A preference is never a bare string in this system. It carries **where it came
from** and **how sure we are**, because those two facts decide whether it is
allowed to change how the student is taught. "Prefers concise explanations" that
the student typed is a different object from the same sentence inferred from six
days of behaviour, and collapsing them is how personalization starts asserting
things nobody said.

## Why there is no `student_preferences` table yet

The v2 design proposed one in Phase 1. Building it revealed it would have
nothing to store: every preference derivable today is a **pure function of data
already in the snapshot**, so a table would be a denormalized cache that can
disagree with its source — the exact failure `decisions.md` rejects for the
concept graph ("computed with GROUP BY at read time") and the Gap Map ("drawn,
not stored").

Storage earns its place the moment a preference depends on **events that cannot
be recomputed** — response feedback and experiment outcomes, which are Phase 2
and 3. At that point `resolve()` gains a persisted layer behind this same
interface and no caller changes. Until then, deriving is both cheaper and more
honest.

## The whitelist is the privacy guarantee

`KEYS` is a closed set. A preference key that is not in it cannot be resolved,
stored or injected into a prompt. That is a structural bound on what this
subsystem can ever model — worth considerably more than an instruction in a
prompt telling a model not to infer sensitive attributes, because it does not
depend on the model complying.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, NamedTuple

Source = Literal["explicit", "observed", "feedback", "experiment"]

#: The closed set of things this system may model about a learner. Adding a key
#: is a deliberate act with a privacy review, not a convenience.
KEYS = frozenset(
    {
        "explanation.length",        # concise | detailed
        "explanation.depth",         # simpler | deeper
        "explanation.opens_with",    # example_first | theory_first
        "explanation.note",          # free text, the student's own words
        "interaction.mode",          # discussion | drilling | testing
        "interaction.answer_mode",   # direct | hints_first
        "session.length_minutes",    # numeric, as text
        "study.goal",                # free text: what they're studying for
    }
)


class FeedbackKind(NamedTuple):
    """What one tap means, declared where the kind is defined.

    The alternative — storing free-form labels and working out later what they
    imply — makes the learning step interpretive instead of mechanical, and
    guarantees the taxonomy and the update rule drift apart. Declaring the
    mapping here means a kind whose key is not in `KEYS` cannot be recorded at
    all, which is the whitelist doing its job at the only door.
    """

    key: str | None
    value: str | None
    #: A short label for the chip. The student reads this, so it is phrased as
    #: what they want, not as a complaint about the model.
    label: str


#: The full taxonomy. `None` key means the signal carries no direction of its
#: own — see `useful` and `regenerate` below.
FEEDBACK_KINDS: dict[str, FeedbackKind] = {
    "too_long": FeedbackKind("explanation.length", "concise", "Too long"),
    "want_detail": FeedbackKind("explanation.length", "detailed", "More detail"),
    "too_complex": FeedbackKind("explanation.depth", "simpler", "Too complicated"),
    "too_simple": FeedbackKind("explanation.depth", "deeper", "Too basic"),
    "need_example": FeedbackKind("explanation.opens_with", "example_first", "Need an example"),
    "want_theory": FeedbackKind("explanation.opens_with", "theory_first", "Theory first"),
    "want_direct": FeedbackKind("interaction.answer_mode", "direct", "Just the answer"),
    # Confirms whatever was already applied rather than pointing anywhere new.
    # Handled separately in `_resolve_feedback`.
    "useful": FeedbackKind(None, None, "This helped"),
    # Dissatisfaction with no stated reason. Only ever LOWERS confidence — a
    # student who regenerates is telling you the current settings are wrong,
    # not which way to move.
    "regenerate": FeedbackKind(None, None, "Regenerate"),
}

#: How much a single piece of evidence from each source is worth. Explicit
#: statement dominates: the student saying it outright should not be
#: outvoted by a fortnight of habit.
SOURCE_WEIGHT: dict[Source, float] = {
    "explicit": 0.6,
    "experiment": 0.35,
    "feedback": 0.25,
    "observed": 0.1,
}

#: Observed preferences are capped below explicit ones no matter how much
#: evidence accumulates, so behaviour can inform but never overrule.
OBSERVED_CEILING = 0.75

#: Below this, a preference is known but not acted on — it stays resolvable
#: (and so recoverable on one confirmation) without reaching a prompt.
ACT_THRESHOLD = 0.35

#: Where a preference starts on its first piece of feedback. Deliberately below
#: `ACT_THRESHOLD`: one tap is an opinion, not a setting, and it should take a
#: second before the app changes how it writes.
FEEDBACK_START = 0.3

#: Contradicting evidence is weighted harder than agreeing evidence. Being
#: wrong about a student costs more than being unsure about them, and a
#: preference that is expensive to acquire but cheap to lose is the one that
#: fails safe.
CONTRADICTION_PENALTY = 1.5

#: When confidence in the leading value falls this low, the contradicting
#: evidence has won: the preference flips rather than sitting at zero. This is
#: what makes preferences reversible instead of merely decayable — a student
#: whose tastes change gets followed, not out-voted by their own history.
FLIP_BELOW = 0.12

#: Confidence half-life. A preference nobody has confirmed for three months is
#: half as trusted, so a stale belief fades instead of being asserted forever.
HALF_LIFE_DAYS = 90.0


@dataclass(frozen=True)
class Preference:
    key: str
    value: str
    source: Source
    confidence: float
    evidence_count: int
    #: Why we believe it, in one clause, for the Settings inspection UI. An
    #: inference the student cannot see the reason for is one they cannot
    #: correct.
    because: str

    @property
    def actionable(self) -> bool:
        return self.confidence >= ACT_THRESHOLD


def observed_confidence(evidence_count: int) -> float:
    """Rises with evidence, saturates below explicit.

    Deliberately not linear in the tail: the difference between two
    observations and six is large, between twenty and thirty is noise.
    """
    raw = 0.3 + SOURCE_WEIGHT["observed"] * evidence_count
    return round(min(OBSERVED_CEILING, raw), 2)


def resolve(snapshot) -> dict[str, Preference]:
    """Every preference we can currently justify, keyed by preference key.

    Explicit beats observed on the same key, always — `_put` enforces it
    rather than relying on call order, so adding a derivation later cannot
    silently start overriding something the student typed.
    """
    out: dict[str, Preference] = {}

    def _put(pref: Preference) -> None:
        if pref.key not in KEYS:
            return  # The whitelist is enforced here, not at the call sites.
        existing = out.get(pref.key)
        if existing and SOURCE_WEIGHT[existing.source] >= SOURCE_WEIGHT[pref.source]:
            return
        out[pref.key] = pref

    _resolve_explicit(snapshot, _put)
    _resolve_feedback(snapshot, _put)
    _resolve_implicit(snapshot, _put)
    _resolve_observed(snapshot, _put)
    return out


# ── Implicit signals: what they already told us, unprompted ────────────
#
# A student who types "can you explain that more simply" has just given the
# clearest possible preference signal, for free, without being asked. Every one
# of these was already sitting in `chat_messages` and the system ignored it —
# and then interrupted them to ask a question they had already answered.
#
# Precision over recall, deliberately. A missed signal costs nothing (there
# will be another). A false one teaches the app something wrong about the
# student and takes several contradicting taps to undo, so every pattern here
# requires a REQUEST framing rather than a bare topic word: "give me an
# example" counts, "what is an example of a monad" does not — the second is a
# question about examples, not a request for one.
_IMPLICIT_PATTERNS: list[tuple[str, str, str]] = [
    # (regex, preference key, value)
    (r"\b(simpl(er|ify|y)|dumb(ed)? down|less technical|plain(er)? (english|terms))\b",
     "explanation.depth", "simpler"),
    (r"\b(i (still )?(don'?t|do not|dont) (understand|get)|makes? no sense|i'?m (lost|confused)|too (complicated|complex|advanced))\b",
     "explanation.depth", "simpler"),
    (r"\b(more (detail|depth)|elaborate|go deeper|in depth|expand on)\b",
     "explanation.length", "detailed"),
    (r"\b(shorter|too long|be brief|briefly|in short|tl;?dr|summar(ise|ize) that)\b",
     "explanation.length", "concise"),
    (r"\b(give|show) (me )?(an|another|a concrete) example|with an example|can you example\b",
     "explanation.opens_with", "example_first"),
    (r"\b(just (tell|give) me|straight answer|just the answer|stop asking)\b",
     "interaction.answer_mode", "direct"),
]

_COMPILED_IMPLICIT = [(re.compile(p, re.I), k, v) for p, k, v in _IMPLICIT_PATTERNS]


def _resolve_implicit(snapshot, put) -> None:
    """Preferences the student stated in passing, mined from their own turns.

    Filed as `observed` rather than `feedback` on purpose. This is language
    interpreted by a regex, not a button someone deliberately pressed — it is
    behaviour we noticed, so it belongs in the tier that is capped below
    explicit statement and cannot overrule a real tap.

    Derived at read time and never stored: the messages are already in the
    database, so a `response_feedback` row for each would be a denormalized
    copy that can disagree with its source. Same rule as concept mastery.
    """
    messages = getattr(snapshot, "user_messages", []) or []
    if not messages:
        return

    hits: dict[tuple[str, str], int] = {}
    for text in messages:
        for pattern, key, value in _COMPILED_IMPLICIT:
            if pattern.search(text):
                hits[(key, value)] = hits.get((key, value), 0) + 1

    # A dimension the student has pulled in both directions is not a
    # preference, it is context-dependence — which is real, but it is Phase
    # P-1's scoped-preference problem, not something to average into one global
    # answer. Dropping it is the honest move.
    by_key: dict[str, list[tuple[str, int]]] = {}
    for (key, value), count in hits.items():
        by_key.setdefault(key, []).append((value, count))

    for key, values in by_key.items():
        if len(values) > 1:
            continue
        value, count = values[0]
        put(
            Preference(
                key,
                value,
                "observed",
                observed_confidence(count),
                count,
                f"you asked for this {count} time{'s' if count != 1 else ''} in chat",
            )
        )


@dataclass
class _Leader:
    """The value currently winning a key, and how sure we are of it."""

    value: str
    confidence: float
    evidence: int
    last_at: str


def _resolve_feedback(snapshot, put) -> None:
    """Fold feedback events into preferences, oldest first.

    Every key in the taxonomy is binary (concise/detailed, simpler/deeper,
    example_first/theory_first, direct/hints_first), so each one is a tug of
    war: agreeing taps raise confidence in the leader, contradicting taps lower
    it, and when it falls far enough the other value takes over. Replaying the
    events rather than storing a running total means the arithmetic is
    reproducible and a deleted event actually undoes its effect.
    """
    events = sorted(
        getattr(snapshot, "feedback", []) or [],
        key=lambda e: str(e.get("created_at") or ""),
    )
    leaders: dict[str, _Leader] = {}

    for event in events:
        spec = FEEDBACK_KINDS.get(str(event.get("kind") or ""))
        if spec is None:
            continue  # An unknown kind never reaches the model.
        at = str(event.get("created_at") or "")

        if spec.key is None:
            _apply_directionless(spec, leaders, at, str(event.get("kind") or ""))
            continue
        if spec.key not in KEYS or spec.value is None:
            continue

        leader = leaders.get(spec.key)
        if leader is None:
            leaders[spec.key] = _Leader(spec.value, FEEDBACK_START, 1, at)
            continue

        leader.evidence += 1
        leader.last_at = at
        if leader.value == spec.value:
            leader.confidence += (1 - leader.confidence) * SOURCE_WEIGHT["feedback"]
        else:
            leader.confidence -= (
                leader.confidence * SOURCE_WEIGHT["feedback"] * CONTRADICTION_PENALTY
            )
            if leader.confidence < FLIP_BELOW:
                # The other side won. Restart it low — the student has changed
                # their mind, which is not the same as having always felt this
                # way.
                leader.value = spec.value
                leader.confidence = FEEDBACK_START

    now = datetime.now(UTC)
    for key, leader in leaders.items():
        put(
            Preference(
                key,
                leader.value,
                "feedback",
                round(_decayed(leader.confidence, leader.last_at, now), 2),
                leader.evidence,
                f"from {leader.evidence} piece{'s' if leader.evidence != 1 else ''} "
                "of feedback you gave",
            )
        )


def _apply_directionless(spec, leaders: dict[str, _Leader], at: str, kind: str) -> None:
    """`useful` and `regenerate` carry no dimension of their own.

    `useful` refreshes recency without raising confidence: it says the answer
    landed, but not *which* setting made it land, and crediting every active
    preference for one success is how a model talks itself into certainty it
    hasn't earned.

    `regenerate` lowers every leader a little. Dissatisfaction with no stated
    reason is real evidence that the current settings are wrong, and no
    evidence at all about what would be better.
    """
    for leader in leaders.values():
        if kind == "useful":
            leader.last_at = at
        else:
            leader.confidence -= leader.confidence * SOURCE_WEIGHT["feedback"]


def _decayed(confidence: float, last_at: str, now: datetime) -> float:
    """Half-life decay from the last confirmation. A belief nobody has
    reinforced in months should not be asserted with the force of a fresh one."""
    try:
        stamp = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
    except ValueError:
        return confidence
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    days = max(0.0, (now - stamp).total_seconds() / 86400)
    return max(0.0, confidence * (0.5 ** (days / HALF_LIFE_DAYS)))


def _resolve_explicit(snapshot, put) -> None:
    """The student's own words, from `user_settings.student_model`.

    High confidence but not 1.0: people describe how they *want* to learn more
    accurately than how they *do*, and Phase 2's feedback needs headroom to
    disagree without arithmetic pinning it in place.
    """
    explicit = dict(snapshot.settings.get("student_model") or {})

    # Both intake answers describe how to explain things, and both used to be
    # `put` separately under the SAME key — which meant only one survived.
    # `_put` refuses to overwrite an equal-or-stronger source, both are
    # "explicit", and `teaching_preference` went first: so `learning_style`
    # was collected, stored, and then silently dropped before it ever reached
    # a prompt. The intake's most considered question — the multi-select, with
    # a live preview telling the student their choice mattered — changed
    # nothing about how the tutor wrote.
    #
    # They are complementary rather than competing, so they are composed into
    # one note instead of racing: the learning style says how to *open* an
    # explanation, the teaching preference says how far to take it. Style
    # leads because that is the order the sentence is read in.
    #
    # Neither is parsed into the structured enums. Mapping "visual" onto
    # `explanation.opens_with` would be the system inventing a structured
    # claim out of an unstructured sentence.
    notes: list[str] = []
    if style := (explicit.get("learning_style") or "").strip():
        notes.append(f"What makes something click for them: {style}.")
    if note := (explicit.get("teaching_preference") or "").strip():
        notes.append(note)
    if notes:
        put(
            Preference(
                "explanation.note", " ".join(notes), "explicit", 0.9, 1, "you set this"
            )
        )
    if goal := (explicit.get("exam_context") or "").strip():
        put(Preference("study.goal", goal, "explicit", 0.9, 1, "you set this"))
    if minutes := explicit.get("session_length_minutes"):
        put(
            Preference(
                "session.length_minutes", str(minutes), "explicit", 0.9, 1, "you set this"
            )
        )


def _resolve_observed(snapshot, put) -> None:
    """Derived from stored activity. Each one names its own evidence."""
    recent = _recent(snapshot)
    if len(recent) < 4:
        return  # Not a habit yet. See `Snapshot.observed_habits`.

    total = len(recent)
    days = {
        "discussion": sum(1 for d in recent if int(d.get("chat_messages") or 0) > 0),
        "drilling": sum(1 for d in recent if int(d.get("cards_reviewed") or 0) > 0),
        "testing": sum(1 for d in recent if int(d.get("quizzes_taken") or 0) > 0),
    }
    # Counted in DAYS, never in raw events — 400 cards against 3 quizzes is a
    # comparison of different units dressed up as a preference.
    top = max(days, key=lambda k: days[k])
    rest = max(v for k, v in days.items() if k != top)
    if days[top] and days[top] >= 2 * rest:
        put(
            Preference(
                "interaction.mode",
                top,
                "observed",
                observed_confidence(days[top]),
                days[top],
                f"you worked this way on {days[top]} of your last {total} active days",
            )
        )

    minutes = [
        round(int(d.get("study_seconds") or 0) / 60)
        for d in recent
        if int(d.get("study_seconds") or 0) > 0
    ]
    if len(minutes) >= 4:
        median = round(statistics.median(minutes))
        put(
            Preference(
                "session.length_minutes",
                str(median),
                "observed",
                observed_confidence(len(minutes)),
                len(minutes),
                f"your median session across {len(minutes)} days",
            )
        )


def _recent(snapshot):
    from .student_model import _recent_days

    return _recent_days(snapshot.activity_days, 30)
