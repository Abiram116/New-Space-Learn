"""Student Model: explicit preferences + signals computed from real stored
data — the shared personalization context every chat/agent/brief prompt draws
from. Same discipline as `/me/brief`: nothing here is model-generated, so
nothing here can drift from what's actually stored.

**What changed, and why it mattered.** This used to read a narrow slice: quiz
averages grouped by subspace, plus a streak. Two things it could not see, both
of which a tutor notices first — a topic the student has *stopped* opening, and
a score that is *falling* rather than merely low. A topic sitting at 55% that
has climbed from 40% needs the opposite advice from one sitting at 70% that has
dropped from 85%, and an average alone cannot tell those apart.

So the unit of the model is now a `TopicView` — one per subspace, across every
subject — carrying its average, its direction of travel, how long since it was
touched, and what is waiting in it. Everything else here is a query over that
list.

**One read pass.** `snapshot()` fetches the whole picture concurrently and every
consumer derives from it. Before this, rendering Home fetched `quiz_results`
twice, `daily_activity` twice and `subspaces` twice, because the brief, the
suggestion and the prompt block each did their own reads over overlapping data.
On a single-worker free-tier instance talking to a remote Postgres, round trips
are the cost that matters — this widened what the model can see while reducing
the number of them.
"""

from __future__ import annotations

import asyncio
import logging
import statistics
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from functools import cached_property
from typing import Any, Literal, NamedTuple

from ..schemas import (
    MisconceptionOut,
    RootCauseOut,
    SlippingOut,
    StudentModelOut,
    StyleSummaryOut,
    TopicSignal,
)
from . import clock, style_bandit, supabase
from .streaks import compute_streak

log = logging.getLogger("space_learn.student_model")

# How long a topic with real history has to sit untouched before it counts as
# gone cold. Ten days is deliberately past a week: a student who studies on
# Sundays should not be told they have abandoned anything on the following
# Tuesday.
COLD_AFTER_DAYS = 10

# Minimum attempts before a per-topic average is trusted at all, and before a
# trend is calculated. Two points make an average; four make a direction.
MIN_ATTEMPTS_FOR_AVERAGE = 2
MIN_ATTEMPTS_FOR_TREND = 4

# A move of less than this between the earlier and later half of a topic's
# attempts is noise, not a trend — quiz scores on five questions move 20 points
# for getting one more right.
TREND_THRESHOLD = 10

# How many recent quizzes to pull `questions` for. The one genuinely large
# payload in this module, so it is bounded: 60 quizzes at ~5 tagged questions
# each is ~300 concept observations, well past what any prompt can use, and
# well under what a 512 MB instance notices.
QUIZ_WINDOW = 60

# Below this many questions asked, a concept's accuracy is a coin flip with
# extra steps. Two questions can only ever read 0%, 50% or 100%.
MIN_QUESTIONS_FOR_CONCEPT = 3

# How many feedback events to replay. Preferences are folded by replaying
# events in order, so this bounds the work; 300 taps is far more than a real
# student produces, and the oldest are the most decayed anyway.
FEEDBACK_WINDOW = 300

# How many of the student's own turns to mine for stated preferences. Their
# messages are short, so this is a small payload; 80 covers weeks of real use
# and the phrasing habits it looks for repeat rather than needing full history.
MESSAGE_WINDOW = 80

# ── Bayesian mastery ─────────────────────────────────────────────────────
#
# Replaces plain means for weak/strong classification (trend keeps its own
# halves-average logic below — a direction of travel and a level are
# different questions). Every quiz question and flashcard review is one
# piece of right/wrong evidence, folded into a Beta(1,1) posterior with a
# recency weight so a topic that was weak in March and has been solid since
# isn't still called weak in September, and so mastery is defined (at the
# uninformative 50%) even before the first attempt rather than needing a
# minimum count to exist at all.
#
#   w = 0.5 ** (age_days / MASTERY_HALF_LIFE_DAYS)
#   alpha = 1 + sum(w * outcome), beta = 1 + sum(w * (1 - outcome))
#   mastery = alpha / (alpha + beta)          # 0..1, exposed as 0..100
#   n = sum(w)                                 # how much of that to trust
#
# `n` travels everywhere `mastery` does: a mastery score without its
# evidence weight cannot be told apart from a coin flip.

#: Half-life, in days, for mastery evidence. Deliberately shorter than
#: preference confidence's 90-day half-life (`preferences.HALF_LIFE_DAYS`):
#: what a student knows changes faster than what teaching style they want.
MASTERY_HALF_LIFE_DAYS = 30.0

#: mastery% below this, with enough evidence to trust it, is weak.
WEAK_MASTERY = 60
#: Minimum recency-weighted evidence before "weak" is asserted at all.
#: 2.5 rather than a round number because two adjacent, still-fresh data
#: points are real evidence; a whole number would either reject that or
#: accept one lone stale one.
WEAK_MASTERY_MIN_N = 2.5
#: mastery% at or above this, with enough evidence, is strong.
STRONG_MASTERY = 80
STRONG_MASTERY_MIN_N = 3.0

#: `card_reviews.grade` outcome, mapped to the same [0,1] scale quiz
#: questions use. The grading endpoint (`routers/flashcards.py`, owned by a
#: different pass on this codebase) writes the standard FSRS/Anki 1-4 scale —
#: Again, Hard, Good, Easy — so this map is the one place to fix if that
#: convention ever changes.
CARD_REVIEW_OUTCOME: dict[int, float] = {1: 0.0, 2: 0.6, 3: 1.0, 4: 1.0}

#: How many recent card reviews to pull for topic-level mastery. Same
#: reasoning as `QUIZ_WINDOW`: bounded, and the oldest are the most decayed
#: anyway.
CARD_REVIEW_WINDOW = 500

#: How far back "what changed lately" looks when working out how much a topic's
#: mastery moved because of new evidence — the brief's "biggest recent change".
RECENT_MASTERY_DAYS = 3
#: Older evidence needed behind a topic before its recent move is reported;
#: without a baseline every first quiz is a "jump from 50%".
MASTERY_DELTA_MIN_BASELINE = 3

#: Feedback chips that speak to whether a CONCEPT is understood, not just how
#: it should be explained. `too_complex` means "I don't get this" (outcome
#: 0); `too_simple` means "I already know this" (outcome 1). Every other
#: chip (length, examples, directness) is a style request, not a knowledge
#: signal, and folding those in would conflate the two — so this is
#: deliberately a subset of `preferences.FEEDBACK_KINDS`, not all of it.
CONCEPT_FEEDBACK_OUTCOME: dict[str, float] = {"too_complex": 0.0, "too_simple": 1.0}

# ── Misconceptions ───────────────────────────────────────────────────────
#
# A wrong answer to a tagged question (`QuizQuestion.misconceptions`, task 1
# in quizzes.py) names what the student actually got confused about, not just
# that they missed it. Tracked the same way as mastery — recency-weighted,
# same 30-day half-life — so a mix-up from three months ago that hasn't
# recurred stops being reported as current.

#: A misconception counts once seen, or is kept once it recurs. Either
#: threshold alone would either bury a single fresh, glaring mix-up or keep a
#: single stale one alive forever — the OR is deliberate.
MISCONCEPTION_MIN_WEIGHT = 1.5
MISCONCEPTION_MIN_SEEN = 2

# ── Recall vs application ────────────────────────────────────────────────
#: Same floor as concept mastery's own thresholds — below this a recall- or
#: application-only score is a coin flip, not a number worth splitting out.
RECALL_SPLIT_MIN_N = 2.0

# ── Slipping ──────────────────────────────────────────────────────────────
#
# `is_falling` (trend) catches a score that is moving down *right now*, over
# its last few attempts. It says nothing about a topic that was aced weeks
# ago and simply hasn't been touched since — decay alone will eventually pull
# that mastery number down, but only once it has already drifted, which is
# too late to be useful advice. `slipping` catches it earlier, by comparing
# what the evidence said three weeks ago against what it says today.

#: Evidence more recent than this doesn't count toward "was strong" — it has
#: to have been true for a while, not just on the most recent attempt.
SLIPPING_OLD_CUTOFF_DAYS = 21
#: Last evidence older than this, with nothing since, is "gone quiet" even if
#: today's decayed number hasn't crossed SLIPPING_NOW_BELOW yet.
SLIPPING_STALE_DAYS = 30
#: "Previously strong", read off evidence older than SLIPPING_OLD_CUTOFF_DAYS.
SLIPPING_WAS_STRONG = 80
#: Today's decayed mastery has to have actually dropped below this to call it
#: slipping on the regression branch (as opposed to the staleness branch).
SLIPPING_NOW_BELOW = 70
#: Below this much old evidence, "was strong" is a guess, not a measurement.
SLIPPING_MIN_OLD_N = 2.0


class _QuestionEvent(NamedTuple):
    """One question the student was asked, and whether they got it right —
    the atom both topic and concept mastery are folded from.

    `concept` is `None` for questions asked before `subtopic` tagging
    existed: they still count as topic-level evidence (the student did
    answer a real question), they just cannot be attributed to a concept.
    `kind` and `misconception` are `None` on the same pre-tagging quizzes,
    and on any question the model didn't tag — see `QuizQuestion`'s own
    normalization in `schemas` for why a bad tag drops rather than breaks.
    """

    at: str
    correct: bool
    subspace_id: str
    concept: str | None
    #: "recall" | "apply" | None — which half of the recall/application
    #: split (task 6) this question counts toward.
    kind: str | None
    #: The misconception phrase behind the choice actually picked, when the
    #: question tagged it and the answer was wrong. `None` on a correct
    #: answer regardless of tagging.
    misconception: str | None


@dataclass(frozen=True)
class ConceptView:
    """What the student's answers demonstrate about ONE concept.

    The concept layer that already existed in the data and was never read.
    `quizzes.questions[i].subtopic` has tagged the specific concept behind
    every generated question since quiz tagging shipped, and
    `quiz_results.answers[i]` records what was actually chosen — so
    per-question correctness, per concept, has been reconstructable all along.
    Nothing here needed a migration; it needed someone to do the join.

    This is finer-grained than `TopicView` and that is the point: "Attention"
    scoring 71% is a number you can't act on, while "cross-attention 40%,
    positional encoding 92%" tells you what to open. Per `decisions.md` a
    concept is a normalized tag and never a row, so these are computed per
    request and never stored.
    """

    #: Normalized — `trim().lower()`, the rule from `decisions.md`.
    concept: str
    #: First-seen casing, for showing to a human.
    label: str
    asked: int
    correct: int
    #: Plain accuracy — kept for display text ("73% correct across 12
    #: questions" reads better than a Bayesian mastery score). Weak/strong
    #: classification uses `mastery`, not this; see the two properties below.
    accuracy: int
    #: Recency-weighted Beta-posterior mean, 0-100. Folds in quiz answers AND
    #: (task 4) `too_complex`/`too_simple` feedback tagged with this concept.
    mastery: int
    #: Evidence weight behind `mastery` — `sum(w)` over its evidence, not a
    #: raw count. See module docstring.
    evidence_n: float
    #: Later-half minus earlier-half accuracy. None below the trend threshold.
    trend: int | None
    days_since_seen: int | None
    subspace_ids: tuple[str, ...]
    #: True when this concept was solid three-plus weeks ago and has since
    #: dropped or gone quiet — see the module's "Slipping" section. Computed
    #: at fold time (needs the age-split evidence, not just the final
    #: mastery/n this dataclass otherwise carries) rather than as a property.
    is_slipping: bool = False

    @property
    def is_weak(self) -> bool:
        return self.mastery < WEAK_MASTERY and self.evidence_n >= WEAK_MASTERY_MIN_N

    @property
    def is_strong(self) -> bool:
        """Disjoint from `is_weak` by construction — 60 and 80 don't
        overlap — so, unlike the old top-3/bottom-3 lists, a concept can
        never be reported as both."""
        return self.mastery >= STRONG_MASTERY and self.evidence_n >= STRONG_MASTERY_MIN_N

    @property
    def is_falling(self) -> bool:
        return self.trend is not None and self.trend <= -TREND_THRESHOLD


class QuizAttempt(NamedTuple):
    """One submitted quiz, reduced to what "your latest result" needs — kept
    on the snapshot so the brief can say how the last attempt compared with the
    one before it without another read. `subspace_id` is empty when the quiz
    has since fallen out of the window (its topic is then unknowable)."""

    quiz_id: str
    subspace_id: str
    score: int
    at: str


@dataclass(frozen=True)
class MisconceptionView:
    """One recurring mix-up, folded from `QuizQuestion.misconceptions` ×
    the choice the student actually picked — task 3. Recency-weighted the
    same way mastery is, so a mix-up from months ago that hasn't recurred
    stops being reported as current."""

    text: str
    #: Recency-weighted occurrence count — not a raw count, same `sum(w)`
    #: shape as `evidence_n` elsewhere in this module.
    weight: float
    #: Raw occurrence count, for the `seen >= 2` half of the keep-threshold.
    seen: int
    last_seen: str | None


@dataclass(frozen=True)
class TopicView:
    """Everything known about one subspace, from stored rows only."""

    subspace_id: str
    subject_id: str
    subject: str
    topic: str
    #: Plain mean of quiz scores. Kept for display and for the brief's own
    #: `< 75` suggestion threshold — `weak_areas`/`strong_areas` below use
    #: `mastery`, not this.
    quiz_average: int | None
    quiz_attempts: int
    #: Later-half average minus earlier-half average, or None below
    #: `MIN_ATTEMPTS_FOR_TREND`. Negative means getting worse.
    trend: int | None
    #: None when the topic has never been touched.
    days_since_activity: int | None
    cards_due: int
    cards_total: int
    notes: int
    docs: int
    #: Recency-weighted Beta-posterior mean over quiz questions AND card
    #: reviews in this topic, 0-100. Defaults to the uninformative 50 (no
    #: evidence) so every `TopicView` — including ones built by hand in
    #: tests — has a defined value without needing to state one.
    mastery: int = 50
    #: Evidence weight behind `mastery`. Defaults to 0 evidence, which keeps
    #: `is_weak`/`is_strong` both false until real evidence exists.
    evidence_n: float = 0.0
    #: Top 3 recurring misconceptions in this topic, worst (highest weight)
    #: first — task 3.
    misconceptions: tuple[MisconceptionView, ...] = ()
    #: Mastery split by question `kind` — task 6. `None` until each side has
    #: at least `RECALL_SPLIT_MIN_N` evidence; a coin-flip split is worse
    #: than no split.
    recall_mastery: int | None = None
    application_mastery: int | None = None
    #: Was strong three-plus weeks ago and has since dropped or gone quiet —
    #: task 5. Set at fold time; see `ConceptView.is_slipping`.
    is_slipping: bool = False
    #: Points this topic's mastery moved because of evidence from the last
    #: `RECENT_MASTERY_DAYS` days (positive = improved). `None` without
    #: recent evidence or without enough older evidence to measure against.
    mastery_delta: int | None = None

    @property
    def is_weak(self) -> bool:
        return self.mastery < WEAK_MASTERY and self.evidence_n >= WEAK_MASTERY_MIN_N

    @property
    def is_strong(self) -> bool:
        """Disjoint from `is_weak` by construction, so a topic can never
        land in both `weak_areas` and `strong_areas` at once."""
        return self.mastery >= STRONG_MASTERY and self.evidence_n >= STRONG_MASTERY_MIN_N

    @property
    def has_history(self) -> bool:
        """Has the student actually *done* anything here, as opposed to having
        created the topic and uploaded to it?"""
        return self.quiz_attempts > 0 or self.cards_total > 0 or self.notes > 0

    @property
    def is_cold(self) -> bool:
        return (
            self.has_history
            and self.days_since_activity is not None
            and self.days_since_activity >= COLD_AFTER_DAYS
        )

    @property
    def is_untouched(self) -> bool:
        """Material was added and then nothing happened with it. Distinct from
        cold: nothing has been forgotten here, it was never started."""
        return self.docs > 0 and not self.has_history

    @property
    def is_falling(self) -> bool:
        return self.trend is not None and self.trend <= -TREND_THRESHOLD


@dataclass(frozen=True)
class RootCause:
    """A weak concept that keeps showing up as a prerequisite of OTHER weak
    concepts — task 4. `concept`/`because_of` are display labels; `subspace_id`
    is where `next_action` (brief.py) can route to work on it."""

    concept: str
    because_of: tuple[str, ...]
    subspace_id: str | None


@dataclass(frozen=True)
class SlippingItem:
    """One entry in `Snapshot.slipping` — task 5. `kind` distinguishes a
    whole topic from a single concept so a consumer can route to the right
    thing (a topic has one quiz to retake; a concept doesn't on its own).
    `subspace_id` is enough for a caller to look up `subject_id` too, off
    the same `topics` list this snapshot already carries — see
    `brief.next_action`."""

    kind: Literal["topic", "concept"]
    label: str
    subspace_id: str | None
    #: How long since this topic/concept was last touched — `None` when the
    #: slip is a score drop rather than neglect. Carried here (rather than
    #: re-derived at the API boundary) because a concept's own days-since is
    #: `ConceptView.days_since_seen`, not `TopicView.days_since_activity`, and
    #: only this property has both views in scope at once.
    days_since_activity: int | None = None


@dataclass(frozen=True)
class Snapshot:
    """One read pass over everything the student has. Every derived signal in
    this module is a pure function of this."""

    settings: dict
    topics: list[TopicView]
    concepts: list[ConceptView]
    activity_days: list[dict]
    streak_days: int
    #: Raw `response_feedback` rows. The one input that cannot be recomputed,
    #: so it is the one thing here that is genuinely read rather than derived.
    feedback: list[dict] = field(default_factory=list)
    #: The student's own recent chat turns. Mined for preferences they stated
    #: in passing ("explain that more simply") — evidence that costs them
    #: nothing because they already gave it. See `preferences._resolve_implicit`.
    user_messages: list[str] = field(default_factory=list)
    #: concept → its tagged prerequisite concepts (task 4), both normalized.
    #: Built once in `snapshot()` from every `QuizQuestion.prerequisites`
    #: ever written, not just recent ones — a dependency a student stated
    #: months ago is still a real dependency.
    prereq_edges: dict[str, tuple[str, ...]] = field(default_factory=dict)
    #: normalized concept → first-seen display casing, covering BOTH
    #: `subtopic` tags and `prerequisites` names — a prerequisite that has
    #: never itself been asked as a question still needs a human label.
    concept_labels: dict[str, str] = field(default_factory=dict)
    #: Top 3 misconceptions across every topic — task 3. Computed once in
    #: `snapshot()` alongside `concepts`, not as a property: it needs the
    #: flat per-occurrence event list, which isn't reconstructable from
    #: `topics`/`concepts` afterward (each topic only keeps ITS OWN top 3).
    top_misconceptions: tuple[MisconceptionView, ...] = ()
    #: Submitted quizzes, NEWEST first (the same 200-result window the topic
    #: averages come from). Lets the brief compare the latest attempt with the
    #: previous one on the same quiz and know a personal best.
    quiz_attempts: tuple[QuizAttempt, ...] = ()
    #: Flashcards not yet due but coming due within the next 24 hours — the
    #: brief's "due later today". Already-due cards are `cards_due_total`.
    upcoming_due: tuple[datetime, ...] = ()
    #: Documents that finished processing, across every topic.
    docs_ready: int = 0
    #: The most recent `subspaces.last_activity_at`, to the second, where
    #: `days_away` only knows the date. `None` when nothing has been touched.
    last_activity_at: datetime | None = None

    # ── Concept views ─────────────────────────────────────────────────

    @property
    def weak_concepts(self) -> list[ConceptView]:
        """Worst first. The most directly actionable list in the model — a
        concept is small enough to actually revise in one sitting, which a
        topic average is not."""
        return sorted(
            (c for c in self.concepts if c.is_weak), key=lambda c: c.mastery
        )

    @property
    def strong_concepts(self) -> list[ConceptView]:
        """Thresholded, not just top-3 — `is_weak`/`is_strong` are disjoint,
        so (unlike the plain-accuracy version this replaced) a concept can no
        longer show up in both lists at once."""
        return sorted(
            (c for c in self.concepts if c.is_strong), key=lambda c: -c.mastery
        )[:3]

    @property
    def falling_concepts(self) -> list[ConceptView]:
        return sorted(
            (c for c in self.concepts if c.is_falling), key=lambda c: c.trend or 0
        )

    def concepts_in(self, subspace_id: str) -> list[ConceptView]:
        """Concepts seen in one topic, weakest first — what chat and quiz
        generation actually want, since both are scoped to a subspace."""
        return sorted(
            (c for c in self.concepts if subspace_id in c.subspace_ids),
            key=lambda c: c.accuracy,
        )

    @cached_property
    def root_causes(self) -> list[RootCause]:
        """Weak concepts that keep showing up as a PREREQUISITE of other weak
        concepts — task 4. A weak concept is worth revising; a weak
        prerequisite of three other weak concepts is worth revising first.

        `cached_property`, not `property`: `next_action` (brief.py) and
        `personalization` can both read this off the same snapshot, and this
        walks every weak concept's edges to compute it — cheap either way at
        this scale, but there's no reason to redo it per reader.

        A prerequisite counts once it is ITSELF weak (one weak dependant is
        enough — a known weak spot underlying another is already actionable),
        or, when it has never been measured as weak or strong on its own,
        once at least two different weak concepts depend on it (one shared
        guess isn't a pattern; two are).
        """
        weak_by_concept = {c.concept: c for c in self.concepts if c.is_weak}
        if not weak_by_concept or not self.prereq_edges:
            return []
        by_prereq_tag: dict[str, ConceptView] = {c.concept: c for c in self.concepts}

        # prereq tag → tags of the weak concepts that depend on it.
        because_of_tags: dict[str, list[str]] = {}
        for weak_tag, weak_view in weak_by_concept.items():
            for prereq_tag in self.prereq_edges.get(weak_tag, ()):
                because_of_tags.setdefault(prereq_tag, []).append(weak_view.concept)

        out: list[RootCause] = []
        for prereq_tag, dependants in because_of_tags.items():
            prereq_view = by_prereq_tag.get(prereq_tag)
            counts_as_cause = (prereq_view is not None and prereq_view.is_weak) or len(
                dependants
            ) >= 2
            if not counts_as_cause:
                continue
            if prereq_view is not None and prereq_view.subspace_ids:
                subspace_id = prereq_view.subspace_ids[0]
            else:
                # Never measured on its own — route to wherever the first
                # weak concept it underlies actually lives.
                dep_view = weak_by_concept.get(dependants[0])
                subspace_id = (
                    dep_view.subspace_ids[0] if dep_view and dep_view.subspace_ids else None
                )
            out.append(
                RootCause(
                    concept=self.concept_labels.get(prereq_tag, prereq_tag),
                    because_of=tuple(
                        weak_by_concept[tag].label for tag in dependants
                    ),
                    subspace_id=subspace_id,
                )
            )
        return sorted(out, key=lambda r: -len(r.because_of))[:3]

    @cached_property
    def slipping(self) -> list[SlippingItem]:
        """Topics and concepts that were strong three-plus weeks ago and have
        since dropped or gone quiet — task 5. Topics first: a topic has one
        quiz `next_action` can point straight at, which a bare concept
        doesn't. `cached_property` for the same reason as `root_causes`."""
        items = [
            SlippingItem("topic", t.topic, t.subspace_id, t.days_since_activity)
            for t in self.topics
            if t.is_slipping
        ]
        items += [
            SlippingItem(
                "concept",
                c.label,
                c.subspace_ids[0] if c.subspace_ids else None,
                c.days_since_seen,
            )
            for c in self.concepts
            if c.is_slipping
        ]
        return items[:3]

    # ── Derived views ─────────────────────────────────────────────────

    @property
    def rated(self) -> list[TopicView]:
        """Topics with enough attempts for their average to mean something."""
        return [t for t in self.topics if t.quiz_average is not None]

    @property
    def weak_areas(self) -> list[TopicView]:
        """Ranked on `mastery`, not `self.rated` (which is quiz-attempts
        only) — a topic drilled hard with flashcards but never quizzed has
        real evidence behind it too."""
        return sorted(
            (t for t in self.topics if t.is_weak), key=lambda t: t.mastery
        )[:3]

    @property
    def strong_areas(self) -> list[TopicView]:
        return sorted(
            (t for t in self.topics if t.is_strong), key=lambda t: -t.mastery
        )[:3]

    @property
    def falling(self) -> list[TopicView]:
        """Worst decline first — the single most tutor-like thing here."""
        return sorted(
            (t for t in self.topics if t.is_falling), key=lambda t: t.trend or 0
        )

    @property
    def cold(self) -> list[TopicView]:
        """Longest-abandoned first."""
        return sorted(
            (t for t in self.topics if t.is_cold),
            key=lambda t: -(t.days_since_activity or 0),
        )

    @property
    def untouched(self) -> list[TopicView]:
        return [t for t in self.topics if t.is_untouched]

    @property
    def cards_due_total(self) -> int:
        return sum(t.cards_due for t in self.topics)

    @property
    def most_recent(self) -> TopicView | None:
        touched = [t for t in self.topics if t.days_since_activity is not None]
        if not touched:
            return None
        return min(touched, key=lambda t: t.days_since_activity or 0)

    @property
    def days_away(self) -> int:
        """Days since any activity at all, by the activity log rather than by
        `last_activity_at` — the log is what the streak and the heatmap read,
        so the brief agreeing with them matters more than being a day fresher."""
        if not self.activity_days:
            return 0
        try:
            return (clock.today() - date.fromisoformat(str(self.activity_days[0]["day"]))).days
        except (ValueError, KeyError):
            return 0

    @property
    def subjects_studied_recently(self) -> set[str]:
        """Subject ids touched in the last week."""
        return {
            t.subject_id
            for t in self.topics
            if t.days_since_activity is not None and t.days_since_activity <= 7
        }

    @property
    def neglected_subjects(self) -> list[str]:
        """Subject names with material in them that saw nothing this week,
        while some other subject did. Empty when only one subject exists —
        "you haven't studied your only subject" is not an insight."""
        recent = self.subjects_studied_recently
        if not recent:
            return []
        names: dict[str, str] = {}
        for t in self.topics:
            if t.subject_id not in recent and (t.has_history or t.docs > 0):
                names.setdefault(t.subject_id, t.subject)
        return list(names.values())

    # ── Observed habits (never asserted as preference) ────────────────

    @property
    def observed_habits(self) -> list[str]:
        """Plain sentences about what this student actually does, each one
        traceable to a count in `daily_activity`.

        This is the honest half of "personalisation". The tempting version
        infers a *type* — visual learner, deep processor — from behaviour and
        writes it into the student's own preference fields, at which point
        Settings displays a sentence the student never wrote as though they
        had. These are observations, kept separate from the explicit fields
        and labelled as observations in the prompt, because a model may
        propose but may never assert (see docs/decisions.md).
        """
        recent = _recent_days(self.activity_days, 30)
        if len(recent) < 4:
            # Fewer than four active days is not a habit, it's a start.
            return []

        habits: list[str] = []
        chat_days = sum(1 for d in recent if int(d.get("chat_messages") or 0) > 0)
        card_days = sum(1 for d in recent if int(d.get("cards_reviewed") or 0) > 0)
        quiz_days = sum(1 for d in recent if int(d.get("quizzes_taken") or 0) > 0)
        total = len(recent)

        # Counted in DAYS, not in raw events, so the three are comparable.
        # Comparing 400 cards reviewed against 3 quizzes taken would be
        # comparing different units and calling the result a preference.
        if chat_days and chat_days >= 2 * max(card_days, quiz_days):
            habits.append(
                "Works mostly by asking questions — has studied by discussion on "
                f"{chat_days} of their last {total} active days, and tested "
                "themselves on far fewer."
            )
        elif card_days and card_days >= 2 * max(chat_days, quiz_days):
            habits.append(
                f"Drills with flashcards — reviewed cards on {card_days} of their "
                f"last {total} active days."
            )
        if quiz_days == 0 and total >= 6:
            habits.append(
                "Has not taken a quiz recently, so their sense of what they know "
                "is untested."
            )

        minutes = [
            round(int(d.get("study_seconds") or 0) / 60)
            for d in recent
            if int(d.get("study_seconds") or 0) > 0
        ]
        if len(minutes) >= 4:
            habits.append(
                f"Typical session runs about {round(statistics.median(minutes))} minutes."
            )
        return habits

    # ── Projection to the API shape ───────────────────────────────────

    def to_model(self) -> StudentModelOut:
        explicit = dict(self.settings.get("student_model") or {})
        return StudentModelOut(
            learning_style=explicit.get("learning_style"),
            session_length_minutes=explicit.get("session_length_minutes"),
            exam_context=explicit.get("exam_context"),
            teaching_preference=explicit.get("teaching_preference"),
            weak_areas=[_signal(t) for t in self.weak_areas],
            strong_areas=[_signal(t) for t in self.strong_areas],
            streak_days=self.streak_days,
            falling_areas=[_signal(t) for t in self.falling[:3]],
            cold_areas=[_signal(t) for t in self.cold[:3]],
            observed_habits=self.observed_habits,
            top_misconceptions=[
                MisconceptionOut(text=m.text, last_seen=m.last_seen)
                for m in self.top_misconceptions
            ],
            root_causes=[
                RootCauseOut(concept=r.concept, because_of=list(r.because_of))
                for r in self.root_causes
            ],
            slipping=[
                SlippingOut(
                    kind=s.kind, label=s.label, days_since_activity=s.days_since_activity
                )
                for s in self.slipping
            ],
        )


def _signal(t: TopicView) -> TopicSignal:
    # `average` is the field name every consumer (API schema, web) already
    # has — kept rather than renamed. What it carries changed: Bayesian
    # mastery, not the plain quiz mean, because `weak_areas`/`strong_areas`
    # are now ranked on mastery and showing a different number than the one
    # that produced the ranking would be its own small lie.
    return TopicSignal(
        subspace_id=t.subspace_id,
        topic=t.topic,
        average=t.mastery,
        subject=t.subject,
        trend=t.trend,
        days_since_activity=t.days_since_activity,
        recall_mastery=t.recall_mastery,
        application_mastery=t.application_mastery,
    )


# ── The read pass ──────────────────────────────────────────────────────


_warned_no_rpc = False

#: Shape `student_snapshot` returns. Also the fallback's assembly order.
_SNAPSHOT_KEYS = (
    "settings", "subjects", "subspaces", "quiz_results", "quizzes",
    "daily_activity", "decks", "flashcards", "notes", "documents",
    "response_feedback", "chat_messages", "card_reviews",
)


async def _snapshot_rows(user_id: str) -> dict[str, Any]:
    """Every read the student model needs, preferring one round trip.

    The RPC is the fast path. The twelve-select fallback stays because a
    database that has not taken the migration must still serve the app rather
    than 500 on its most-used read — and because it is the executable
    definition of what the SQL is supposed to return, which is worth keeping
    next to it.
    """
    global _warned_no_rpc
    try:
        payload = await supabase.db_rpc(
            "student_snapshot", {"p_user_id": user_id}, read_only=True
        )
        if isinstance(payload, dict) and all(k in payload for k in _SNAPSHOT_KEYS):
            return payload
        reason = "returned an unexpected shape"
    except Exception as e:
        reason = f"unavailable ({type(e).__name__})"
    # Once per process, not once per call: this runs on nearly every request,
    # and a per-call warning would bury the log it is trying to be visible in.
    if not _warned_no_rpc:
        _warned_no_rpc = True
        log.warning("student_snapshot %s — using the twelve-select fallback", reason)
    return await _snapshot_rows_via_selects(user_id)


async def _snapshot_rows_via_selects(user_id: str) -> dict[str, Any]:
    """The pre-RPC read path, kept as a fallback and as the spec for the SQL."""
    (
        settings_rows, subjects, subspaces, quiz_results, quizzes, daily_activity,
        decks, flashcards, notes, documents, response_feedback, chat_messages,
        card_reviews,
    ) = await asyncio.gather(
        supabase.db_select("user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1),
        supabase.db_select(
            "subjects",
            filters={"user_id": f"eq.{user_id}"},
            select="id,name",
            order="id.asc",
        ),
        supabase.db_select(
            "subspaces",
            filters={"user_id": f"eq.{user_id}"},
            select="id,subject_id,name,last_activity_at",
            order="id.asc",
        ),
        supabase.db_select(
            "quiz_results",
            filters={"user_id": f"eq.{user_id}"},
            select="score,submitted_at,quiz_id,answers",
            order="submitted_at.desc",
            limit=200,
        ),
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user_id}"},
            select="id,subspace_id,questions",
            order="created_at.desc",
            limit=QUIZ_WINDOW,
        ),
        supabase.db_select(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}"},
            select="day,chat_messages,cards_reviewed,quizzes_taken,study_seconds",
            order="day.desc",
            limit=200,
        ),
        supabase.db_select(
            "decks",
            filters={"user_id": f"eq.{user_id}"},
            select="id,subspace_id",
            order="id.asc",
        ),
        supabase.db_select(
            "flashcards",
            filters={"user_id": f"eq.{user_id}"},
            select="deck_id,due_at",
            order="id.asc",
        ),
        supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user_id}"},
            select="subspace_id",
            order="id.asc",
        ),
        supabase.db_select(
            "documents",
            filters={"user_id": f"eq.{user_id}"},
            select="subspace_id,status",
            order="id.asc",
        ),
        supabase.db_select(
            "response_feedback",
            filters={"user_id": f"eq.{user_id}"},
            select="kind,concept,created_at",
            order="created_at.desc",
            limit=FEEDBACK_WINDOW,
        ),
        supabase.db_select(
            "chat_messages",
            filters={"user_id": f"eq.{user_id}", "role": "eq.user"},
            select="content",
            order="created_at.desc",
            limit=MESSAGE_WINDOW,
        ),
        # `subspace_id, grade, reviewed_at` is all mastery needs — see
        # `CARD_REVIEW_OUTCOME`. Owned by the FSRS pass on this codebase;
        # read here rather than joined because this module cannot assume
        # anything about that table beyond the columns the task spec gives.
        supabase.db_select(
            "card_reviews",
            filters={"user_id": f"eq.{user_id}"},
            select="subspace_id,grade,reviewed_at",
            order="reviewed_at.desc",
            limit=CARD_REVIEW_WINDOW,
        ),
    )
    return {
        "settings": settings_rows[0] if settings_rows else {},
        "subjects": subjects,
        "subspaces": subspaces,
        "quiz_results": quiz_results,
        "quizzes": quizzes,
        "daily_activity": daily_activity,
        "decks": decks,
        "flashcards": flashcards,
        "notes": notes,
        "documents": documents,
        "response_feedback": response_feedback,
        "chat_messages": chat_messages,
        "card_reviews": card_reviews,
    }


async def snapshot(user_id: str) -> Snapshot:
    """Everything, concurrently. Ten small selects rather than one join,
    because the httpx/PostgREST wrapper has no join builder and aggregating a
    few hundred rows in Python is far cheaper than the round trips would be.

    `flashcards` is fetched whole (two columns) rather than filtered to due
    ones. It costs a few hundred rows and removes a dependency: filtering by
    `deck_id in (…)` requires the deck ids first, which would serialise this
    gather into two waves for one boolean per row we can evaluate here.

    **`quizzes` is read separately rather than joined onto `quiz_results`.**
    Concept mastery needs `questions`, which is by far the largest payload in
    this module — and a nested `quizzes(questions)` select repeats that whole
    blob once per *result*, so a quiz taken four times ships its questions four
    times. Read flat and joined in Python, each quiz's questions cross the wire
    exactly once. That is why this is eleven selects and not ten (`card_reviews`
    makes twelve), and it is smaller on the wire than joining would have been.
    """
    # ONE round trip, not thirteen.
    #
    # These were thirteen concurrent `db_select`s (twelve before mastery needed
    # `card_reviews` too). Concurrency was not the problem and `gather` was not
    # the fix: against a remote Supabase every extra connection pays its own
    # TLS handshake, which costs more than the overlap saves — measured in
    # `_bulk_counts`'s note in routers/spaces.py. Thirteen round trips is
    # several hundred ms of network however it is scheduled, and this function
    # is the read behind the brief, chat personalisation, note and quiz
    # generation and the feedback policy. So it asks once.
    #
    # `student_snapshot` mirrors every window, ordering and projection below.
    # Falls back to the thirteen reads if the function is missing, so a
    # database that has not taken the migration still serves rather than 500s.
    snap_rows = await _snapshot_rows(user_id)
    settings_rows = [snap_rows["settings"]] if snap_rows.get("settings") else []
    subject_rows = snap_rows["subjects"]
    subspace_rows = snap_rows["subspaces"]
    results = snap_rows["quiz_results"]
    quizzes = snap_rows["quizzes"]
    activity_days = snap_rows["daily_activity"]
    decks = snap_rows["decks"]
    cards = snap_rows["flashcards"]
    notes = snap_rows["notes"]
    documents = snap_rows["documents"]
    feedback = snap_rows["response_feedback"]
    user_message_rows = snap_rows["chat_messages"]
    card_reviews = snap_rows["card_reviews"]

    settings_row = settings_rows[0] if settings_rows else {}
    subject_names = {s["id"]: s.get("name") or "Untitled" for s in subject_rows}
    deck_subspace = {d["id"]: d.get("subspace_id") for d in decks}
    quiz_by_id = {q["id"]: q for q in quizzes}
    today = clock.today()
    now = datetime.now(UTC)

    # ── Fold every list down to per-subspace counts ────────────────────
    #
    # One pass, oldest-first, doing double duty: the per-topic score series
    # AND the flat per-question evidence list mastery is folded from. Both
    # need the same rows in the same order, so walking `results` twice would
    # buy nothing.
    scores: dict[str, list[int]] = {}
    question_events: list[_QuestionEvent] = []
    attempts_oldest_first: list[QuizAttempt] = []
    for r in sorted(results, key=lambda r: str(r.get("submitted_at") or "")):
        quiz = quiz_by_id.get(r.get("quiz_id"))
        if isinstance(r.get("score"), int | float):
            attempts_oldest_first.append(
                QuizAttempt(
                    quiz_id=str(r.get("quiz_id") or ""),
                    subspace_id=str((quiz or {}).get("subspace_id") or ""),
                    score=int(r["score"]),
                    at=str(r.get("submitted_at") or ""),
                )
            )
        if not quiz:
            # Older than the quiz window, or a quiz since deleted. The score is
            # unattributable without it, so it is skipped rather than guessed.
            continue
        subspace_id = quiz.get("subspace_id")
        if subspace_id:
            scores.setdefault(subspace_id, []).append(int(r["score"]))
        _fold_questions(r, quiz, question_events)

    # Two views of the same flat list: every question is topic evidence
    # (mastery doesn't require a concept tag), only tagged ones are concept
    # evidence. Grouping once here, rather than inside `_fold_questions`,
    # keeps that function a pure "one result → events" step.
    topic_question_events: dict[str, list[_QuestionEvent]] = {}
    concept_events: dict[str, list[_QuestionEvent]] = {}
    # Misconceptions: which wrong choice the student actually picked, per
    # topic and overall — task 3. Same one pass over `question_events`.
    topic_misconception_events: dict[str, dict[str, list[str]]] = {}
    overall_misconception_events: dict[str, list[str]] = {}
    for ev in question_events:
        if ev.subspace_id:
            topic_question_events.setdefault(ev.subspace_id, []).append(ev)
        if ev.concept:
            concept_events.setdefault(ev.concept, []).append(ev)
        if ev.misconception:
            overall_misconception_events.setdefault(ev.misconception, []).append(ev.at)
            if ev.subspace_id:
                topic_misconception_events.setdefault(ev.subspace_id, {}).setdefault(
                    ev.misconception, []
                ).append(ev.at)

    # Card reviews: topic-level mastery evidence only — `card_reviews` has no
    # concept column, and grading a card is not scoped to a question the way
    # a quiz answer is.
    topic_review_events: dict[str, list[tuple[float, str]]] = {}
    for cr in card_reviews:
        subspace_id = cr.get("subspace_id")
        outcome = CARD_REVIEW_OUTCOME.get(int(cr.get("grade") or 0))
        if subspace_id and outcome is not None:
            topic_review_events.setdefault(subspace_id, []).append(
                (outcome, str(cr.get("reviewed_at") or ""))
            )

    # Feedback that speaks to a CONCEPT rather than a style ("too complex" /
    # "too simple", tagged with what it was about) — task 4: the `concept`
    # column has been recorded since feedback shipped and never read.
    concept_feedback_events: dict[str, list[tuple[float, str]]] = {}
    for f in feedback:
        concept = f.get("concept")
        outcome = CONCEPT_FEEDBACK_OUTCOME.get(str(f.get("kind") or ""))
        if concept and outcome is not None:
            concept_feedback_events.setdefault(concept, []).append(
                (outcome, str(f.get("created_at") or ""))
            )

    cards_due: dict[str, int] = {}
    cards_total: dict[str, int] = {}
    upcoming_due: list[datetime] = []
    horizon = now + timedelta(hours=24)
    for c in cards:
        subspace_id = deck_subspace.get(c.get("deck_id"))
        if not subspace_id:
            continue
        cards_total[subspace_id] = cards_total.get(subspace_id, 0) + 1
        due_dt = _parse_dt(c.get("due_at"))
        if due_dt is None:
            continue
        if due_dt <= now:
            cards_due[subspace_id] = cards_due.get(subspace_id, 0) + 1
        elif due_dt <= horizon:
            upcoming_due.append(due_dt)

    note_counts: dict[str, int] = {}
    for n in notes:
        subspace_id = n.get("subspace_id")
        if subspace_id:
            note_counts[subspace_id] = note_counts.get(subspace_id, 0) + 1

    doc_counts: dict[str, int] = {}
    for d in documents:
        subspace_id = d.get("subspace_id")
        if subspace_id and d.get("status") == "ready":
            doc_counts[subspace_id] = doc_counts.get(subspace_id, 0) + 1
    docs_ready = sum(doc_counts.values())

    topics: list[TopicView] = []
    for s in subspace_rows:
        subspace_id = s["id"]
        attempts = scores.get(subspace_id, [])
        average = (
            round(sum(attempts) / len(attempts))
            if len(attempts) >= MIN_ATTEMPTS_FOR_AVERAGE
            else None
        )
        topic_events = topic_question_events.get(subspace_id, [])
        review_evidence = topic_review_events.get(subspace_id, [])
        raw_evidence = [
            (1.0 if e.correct else 0.0, e.at) for e in topic_events
        ] + review_evidence
        mastery, evidence_n = _mastery_from_evidence(_weighted(raw_evidence, today))
        days_since_activity = _days_since(s.get("last_activity_at"), today)

        # Recall vs application (task 6): card reviews count toward recall —
        # a flashcard drill IS recall practice — quiz questions split by
        # their own `kind` tag. Untagged questions (no `kind`, e.g. every
        # quiz predating the field) count toward neither side rather than
        # being guessed at.
        recall_evidence = review_evidence + [
            (1.0 if e.correct else 0.0, e.at) for e in topic_events if e.kind == "recall"
        ]
        apply_evidence = [
            (1.0 if e.correct else 0.0, e.at) for e in topic_events if e.kind == "apply"
        ]
        mastery_delta = _recent_mastery_delta(raw_evidence, mastery, today)
        recall_mastery, recall_n = _mastery_from_evidence(_weighted(recall_evidence, today))
        application_mastery, application_n = _mastery_from_evidence(
            _weighted(apply_evidence, today)
        )

        topics.append(
            TopicView(
                subspace_id=subspace_id,
                subject_id=s.get("subject_id") or "",
                subject=subject_names.get(s.get("subject_id"), "Untitled"),
                topic=s.get("name") or "Untitled",
                quiz_average=average,
                quiz_attempts=len(attempts),
                trend=_trend(attempts),
                days_since_activity=days_since_activity,
                cards_due=cards_due.get(subspace_id, 0),
                cards_total=cards_total.get(subspace_id, 0),
                notes=note_counts.get(subspace_id, 0),
                docs=doc_counts.get(subspace_id, 0),
                mastery=mastery,
                evidence_n=round(evidence_n, 2),
                misconceptions=tuple(
                    _top_misconceptions(
                        topic_misconception_events.get(subspace_id, {}), today
                    )
                ),
                recall_mastery=recall_mastery if recall_n >= RECALL_SPLIT_MIN_N else None,
                application_mastery=(
                    application_mastery if application_n >= RECALL_SPLIT_MIN_N else None
                ),
                is_slipping=_is_slipping(raw_evidence, today, mastery, days_since_activity),
                mastery_delta=mastery_delta,
            )
        )

    # Display casing for each normalized tag, taken from however it was first
    # written. The model normalizes to compare and de-normalizes to speak.
    # Covers both `subtopic` (a concept actually asked about) and (task 4)
    # `prerequisites` (a concept named as a dependency, which may never have
    # been asked about directly — it still needs a label to show a human).
    concept_labels: dict[str, str] = {}
    prereq_edges: dict[str, set[str]] = {}
    for quiz in quizzes:
        for question in quiz.get("questions") or []:
            if not isinstance(question, dict):
                continue
            raw = str(question.get("subtopic") or "").strip()
            if raw:
                concept_labels.setdefault(normalize_concept(raw), raw)
            concept = normalize_concept(raw) if raw else ""
            prereqs = question.get("prerequisites")
            if not concept or not isinstance(prereqs, list):
                continue
            for p in prereqs:
                if not isinstance(p, str) or not p.strip():
                    continue
                prereq_tag = normalize_concept(p)
                if not prereq_tag or prereq_tag == concept:
                    continue
                concept_labels.setdefault(prereq_tag, p.strip())
                prereq_edges.setdefault(concept, set()).add(prereq_tag)

    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = compute_streak(
        [r["day"] for r in activity_days], today, freeze=freeze
    )

    return Snapshot(
        settings=settings_row,
        topics=topics,
        concepts=_build_concepts(
            concept_events, concept_labels, today, concept_feedback_events
        ),
        activity_days=activity_days,
        streak_days=streak_days,
        feedback=feedback,
        user_messages=[r.get("content") or "" for r in user_message_rows],
        prereq_edges={c: tuple(sorted(ps)) for c, ps in prereq_edges.items()},
        concept_labels=concept_labels,
        top_misconceptions=tuple(_top_misconceptions(overall_misconception_events, today)),
        quiz_attempts=tuple(reversed(attempts_oldest_first)),
        upcoming_due=tuple(sorted(upcoming_due)),
        docs_ready=docs_ready,
        last_activity_at=max(
            filter(None, (_parse_dt(s.get("last_activity_at")) for s in subspace_rows)),
            default=None,
        ),
    )


async def preference_context(user_id: str) -> Snapshot:
    """The three tables `preferences.resolve()` actually reads, and no more.

    `snapshot()` is thirteen selects because the concept and topic models need
    them.
    Preference resolution touches only `settings`, `activity_days` and
    `feedback` — so serving `/me/preferences` from a full snapshot was doing
    seven reads whose results were then discarded. That endpoint is called on
    every chat mount to drive the feedback ask policy, which turned a UI
    affordance into the most expensive read in the app.

    Returns a `Snapshot` with the rest left empty rather than a separate type:
    every consumer already accepts one, and a second near-identical struct is
    how the two drift.
    """
    settings_rows, activity_days, feedback, user_message_rows = await asyncio.gather(
        supabase.db_select("user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1),
        supabase.db_select(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}"},
            select="day,chat_messages,cards_reviewed,quizzes_taken,study_seconds",
            order="day.desc",
            limit=60,
        ),
        supabase.db_select(
            "response_feedback",
            filters={"user_id": f"eq.{user_id}"},
            select="kind,concept,created_at",
            order="created_at.desc",
            limit=FEEDBACK_WINDOW,
        ),
        supabase.db_select(
            "chat_messages",
            filters={"user_id": f"eq.{user_id}", "role": "eq.user"},
            select="content",
            order="created_at.desc",
            limit=MESSAGE_WINDOW,
        ),
    )
    return Snapshot(
        settings=settings_rows[0] if settings_rows else {},
        topics=[],
        concepts=[],
        activity_days=activity_days,
        # Streak is not computed here: nothing reading a preference needs it,
        # and computing it would mean pulling the full activity history back.
        streak_days=0,
        feedback=feedback,
        user_messages=[r.get("content") or "" for r in user_message_rows],
    )


async def get(user_id: str) -> StudentModelOut:
    """The full `StudentModelOut`, including `style_summaries` — the one
    field `Snapshot.to_model()` can't fill in by itself, since the
    teaching-strategy bandit's evidence lives in `style_bandit`, not in this
    snapshot. Reads the bandit's own read-through cache
    (`style_bandit._cached_reads`), so this costs no additional query on a
    warm cache — see that module's read-cache section."""
    snap = await snapshot(user_id)
    model = snap.to_model()

    subject_by_subspace = {t.subspace_id: t.subject_id for t in snap.topics if t.subject_id}
    subject_names = {t.subject_id: t.subject for t in snap.topics if t.subject_id}
    summaries = await style_bandit.strategy_summary(user_id, subject_by_subspace)
    style_summaries = [
        StyleSummaryOut(
            subject=subject_names[s.subject_id],
            strategy_summary=style_bandit.ARM_DISPLAY.get(s.arm, s.arm),
        )
        for s in summaries
        if s.subject_id in subject_names
    ]
    return model.model_copy(update={"style_summaries": style_summaries})


async def set_explicit(user_id: str, patch: dict) -> StudentModelOut:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    existing = dict((rows[0] if rows else {}).get("student_model") or {})
    existing.update(patch)
    await supabase.db_update(
        "user_settings",
        filters={"user_id": f"eq.{user_id}"},
        patch={"student_model": existing, "updated_at": datetime.now(UTC).isoformat()},
    )
    return await get(user_id)


def format_for_prompt(sm: StudentModelOut) -> str:
    """**Deprecated — use `personalization.build(user_id, task)`.**

    Kept because it is the shape every consumer used before the context layer
    existed, and because it takes a `StudentModelOut` rather than a `Snapshot`,
    which makes it the only entry point available to a caller holding just the
    API model. No router uses it any more.

    The reason it is not the interface: it returns the same block regardless of
    what is being generated, so chat paid tokens for cold-topic lists and quiz
    generation was told the student's preferred tone. See `personalization.py`.
    """

    lines: list[str] = []
    if sm.teaching_preference:
        lines.append(f"- Prefers explanations like this: {sm.teaching_preference}")
    if sm.learning_style:
        lines.append(f"- Learning style, in their words: {sm.learning_style}")
    if sm.session_length_minutes:
        lines.append(f"- Typical session length: {sm.session_length_minutes} minutes")
    if sm.exam_context:
        lines.append(f"- Studying for: {sm.exam_context}")

    # A falling score outranks a low one: it is the thing the student is least
    # likely to have noticed themselves.
    if sm.falling_areas:
        lines.append(
            "- Scores are DROPPING in: "
            + ", ".join(
                f"{a.topic}{f' (down {abs(a.trend)} points)' if a.trend else ''}"
                for a in sm.falling_areas
            )
        )
    if sm.weak_areas:
        lines.append(
            "- Weaker areas (lower quiz averages): "
            + ", ".join(a.topic for a in sm.weak_areas)
        )
    if sm.strong_areas:
        lines.append(
            "- Stronger areas (higher quiz averages): "
            + ", ".join(a.topic for a in sm.strong_areas)
        )
    if sm.cold_areas:
        lines.append(
            "- Not opened in a while: "
            + ", ".join(
                f"{a.topic}{f' ({a.days_since_activity} days)' if a.days_since_activity else ''}"
                for a in sm.cold_areas
            )
        )
    for habit in sm.observed_habits:
        lines.append(f"- Observed (not something they told you): {habit}")

    if not lines:
        return ""
    return "What you know about this student:\n" + "\n".join(lines)


# ── Small helpers ──────────────────────────────────────────────────────


def _days_since(timestamp: str | None, today: date) -> int | None:
    parsed = _parse_dt(timestamp)
    if parsed is None:
        return None
    return max(0, (today - parsed.date()).days)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Postgres renders `+00:00`, but a trailing `Z` shows up often enough
        # from other producers to be worth accepting rather than dropping the
        # row silently.
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def normalize_concept(tag: str) -> str:
    """`trim(t).lowercase()` — the concept normalization rule from
    `decisions.md`, applied to the `subtopic` tags quiz generation already
    writes. Kept as a named function so any future consumer of these tags
    uses literally this one, rather than a second copy that almost agrees."""
    return " ".join(str(tag or "").split()).lower()


def _fold_questions(result: dict, quiz: dict, into: list[_QuestionEvent]) -> None:
    """Turn one quiz result into per-question right/wrong events.

    `answers` is the list of chosen indices, positionally aligned with
    `questions`. A result whose length disagrees with the quiz's is not
    discarded wholesale — the overlapping prefix is still sound, and quizzes
    are regenerated often enough that a stale-length row is a real case rather
    than a hypothetical one.

    Every question becomes an event, tagged or not: an untagged one is still
    real topic-level evidence (`concept=None`), it just can't be attributed to
    a concept. The caller groups this flat list both ways — see `snapshot()`.
    """
    questions = quiz.get("questions") or []
    answers = result.get("answers") or []
    if not isinstance(questions, list) or not isinstance(answers, list):
        return
    at = str(result.get("submitted_at") or "")
    subspace_id = quiz.get("subspace_id") or ""

    # `strict=False` is the documented behaviour above, not an oversight: the
    # overlapping prefix of a length-mismatched pair is still sound evidence.
    for question, chosen in zip(questions, answers, strict=False):
        if not isinstance(question, dict):
            continue
        correct = chosen == question.get("answer_index")
        kind = question.get("kind")
        into.append(
            _QuestionEvent(
                at=at,
                correct=correct,
                subspace_id=subspace_id,
                concept=normalize_concept(question.get("subtopic") or "") or None,
                kind=kind if kind in ("recall", "apply") else None,
                misconception=_chosen_misconception(question, chosen, correct),
            )
        )


def _chosen_misconception(question: dict, chosen: Any, correct: bool) -> str | None:
    """The misconception phrase behind the wrong choice actually picked, or
    `None` when the answer was right, unanswered, out of range, or the
    question wasn't tagged. `QuizQuestion`'s validator already guarantees a
    present `misconceptions` list lines up 1:1 with `choices` and reads
    `None` at the correct index — this just indexes into it defensively for
    quizzes that predate the field or that failed that normalization."""
    if correct:
        return None
    misconceptions = question.get("misconceptions")
    if not isinstance(misconceptions, list) or not isinstance(chosen, int):
        return None
    if chosen < 0 or chosen >= len(misconceptions):
        return None
    text = misconceptions[chosen]
    return text if isinstance(text, str) and text.strip() else None


def _build_concepts(
    events: dict[str, list[_QuestionEvent]],
    labels: dict[str, str],
    today: date,
    feedback_events: dict[str, list[tuple[float, str]]] | None = None,
) -> list[ConceptView]:
    feedback_events = feedback_events or {}
    out: list[ConceptView] = []
    for concept, evs in events.items():
        # The existence gate stays a raw count, not a weighted one: two
        # questions can only ever read 0%, 50% or 100% regardless of how
        # recent they are, so this is a floor on the sample size, not on
        # mastery's own evidence weight (`WEAK_MASTERY_MIN_N` etc. below).
        if len(evs) < MIN_QUESTIONS_FOR_CONCEPT:
            continue
        evs = sorted(evs, key=lambda e: e.at)
        correct = sum(1 for e in evs if e.correct)
        raw_evidence = [(1.0 if e.correct else 0.0, e.at) for e in evs]
        raw_evidence += feedback_events.get(concept, [])
        mastery, evidence_n = _mastery_from_evidence(_weighted(raw_evidence, today))
        days_since_seen = _days_since(evs[-1].at, today)
        out.append(
            ConceptView(
                concept=concept,
                label=labels.get(concept, concept),
                asked=len(evs),
                correct=correct,
                accuracy=round(100 * correct / len(evs)),
                mastery=mastery,
                evidence_n=round(evidence_n, 2),
                trend=_trend([100 if e.correct else 0 for e in evs]),
                days_since_seen=days_since_seen,
                # Sorted so the tuple is comparable and stable across runs —
                # set iteration order is not.
                subspace_ids=tuple(sorted({e.subspace_id for e in evs if e.subspace_id})),
                is_slipping=_is_slipping(raw_evidence, today, mastery, days_since_seen),
            )
        )
    return out


def _top_misconceptions(
    events: dict[str, list[str]], today: date, limit: int = 3
) -> list[MisconceptionView]:
    """`{text: [timestamps]}` → the top `limit` by recency-weighted count —
    task 3. Kept ones clear `MISCONCEPTION_MIN_WEIGHT` (still relevant) OR
    `MISCONCEPTION_MIN_SEEN` (a genuine repeat, even if the repeats are old):
    either alone would either bury a fresh, glaring mix-up seen once, or keep
    a single stale one alive forever."""
    out: list[MisconceptionView] = []
    for text, timestamps in events.items():
        weight = sum(_evidence_weight(t, today) for t in timestamps)
        seen = len(timestamps)
        if weight < MISCONCEPTION_MIN_WEIGHT and seen < MISCONCEPTION_MIN_SEEN:
            continue
        out.append(
            MisconceptionView(
                text=text,
                weight=round(weight, 2),
                seen=seen,
                last_seen=max(timestamps) if timestamps else None,
            )
        )
    return sorted(out, key=lambda m: -m.weight)[:limit]


def _is_slipping(
    raw_evidence: list[tuple[float, str]],
    today: date,
    mastery_now: int,
    days_since_last: int | None,
) -> bool:
    """True when this topic/concept read strong (`SLIPPING_WAS_STRONG`+) on
    evidence older than `SLIPPING_OLD_CUTOFF_DAYS`, and has since either
    actually dropped (today's decayed `mastery_now` below
    `SLIPPING_NOW_BELOW`) or gone quiet (`days_since_last` past
    `SLIPPING_STALE_DAYS`) — task 5.

    Distinct from `is_falling`: a trend needs several recent attempts moving
    the wrong way, which is silent for a topic that was simply never
    retested. This looks at what the OLD evidence alone said and compares it
    to now, so it can flag decay before a fresh attempt ever reveals it.
    """
    old_evidence = [
        (o, t)
        for o, t in raw_evidence
        if (d := _days_since(t, today)) is not None and d > SLIPPING_OLD_CUTOFF_DAYS
    ]
    if not old_evidence:
        return False
    mastery_old, n_old = _mastery_from_evidence(_weighted(old_evidence, today))
    if n_old < SLIPPING_MIN_OLD_N or mastery_old < SLIPPING_WAS_STRONG:
        return False
    if mastery_now < SLIPPING_NOW_BELOW:
        return True
    return days_since_last is not None and days_since_last > SLIPPING_STALE_DAYS


def difficulty_mix(mastery: int | None, count: int) -> dict[str, int]:
    """Easy/medium/hard counts for a `count`-question quiz, aimed at roughly
    a 75% expected success rate given this topic's current mastery — task 2.
    Pure so quiz generation (`routers/quizzes.py`) can call it directly off
    the snapshot it already has, no extra read.

    `None` mastery (a topic with no evidence yet) gets the middle band's
    mix — an unmeasured topic is treated as "don't know", not "assume they
    know it" or "assume they don't".
    """
    m = 62 if mastery is None else mastery
    if m < 50:
        weights = (0.6, 0.3, 0.1)
    elif m <= 75:
        weights = (0.25, 0.55, 0.2)
    else:
        weights = (0.1, 0.4, 0.5)
    return _apportion(weights, count)


def _apportion(weights: tuple[float, float, float], count: int) -> dict[str, int]:
    """Largest-remainder rounding of `weights` (easy, medium, hard) over
    `count` items — the three integers always sum to exactly `count`, which
    plain per-band rounding doesn't guarantee."""
    labels = ("easy", "medium", "hard")
    raw = [w * count for w in weights]
    base = [int(x) for x in raw]
    remainder = count - sum(base)
    order = sorted(range(len(labels)), key=lambda i: raw[i] - base[i], reverse=True)
    for i in order[:remainder]:
        base[i] += 1
    return dict(zip(labels, base, strict=True))


def _evidence_weight(at: str | None, today: date) -> float:
    """Recency weight for one piece of mastery evidence: halves every
    `MASTERY_HALF_LIFE_DAYS`. An unparsable timestamp contributes nothing
    rather than being treated as infinitely old or infinitely fresh."""
    days = _days_since(at, today)
    if days is None:
        return 0.0
    return 0.5 ** (max(0, days) / MASTERY_HALF_LIFE_DAYS)


def _weighted(
    evidence: list[tuple[float, str]], today: date
) -> list[tuple[float, float]]:
    """`(outcome, timestamp)` pairs → `(outcome, weight)` pairs, ready for
    `_mastery_from_evidence`."""
    return [(outcome, _evidence_weight(at, today)) for outcome, at in evidence]


def _mastery_from_evidence(evidence: list[tuple[float, float]]) -> tuple[int, float]:
    """Beta(1,1)-Bernoulli posterior mean over recency-weighted evidence.

    `evidence` is `(outcome in [0,1], weight)` pairs, weight already decayed.
    `alpha = 1 + sum(w*o)`, `beta = 1 + sum(w*(1-o))`, mastery = alpha /
    (alpha+beta). Returns `(mastery as 0-100, n = sum(w))` — `n` is the
    evidence weight the caller needs to decide whether to trust the score at
    all (see `WEAK_MASTERY_MIN_N` / `STRONG_MASTERY_MIN_N`).

    With no evidence this is Beta(1,1)'s own mean: 50%, `n=0` — the
    uninformative prior, not a claim about the student.
    """
    w_sum = sum(w for _, w in evidence)
    wo_sum = sum(o * w for o, w in evidence)
    alpha = 1.0 + wo_sum
    beta = 1.0 + (w_sum - wo_sum)
    return round(100 * alpha / (alpha + beta)), w_sum


def _recent_mastery_delta(
    evidence: list[tuple[float, str]], current: int, today: date
) -> int | None:
    """How far new evidence moved this topic's mastery: today's score minus the
    score computed from only the evidence older than `RECENT_MASTERY_DAYS`.

    Both sides use today's recency weights, so the difference is attributable to
    the new answers alone rather than to old ones ageing. `None` unless there
    is BOTH something recent and a real baseline behind it.
    """
    older: list[tuple[float, float]] = []
    recent = 0
    for outcome, at in evidence:
        days = _days_since(at, today)
        if days is None:
            continue  # unparsable: contributes nothing, as in `_evidence_weight`
        if days <= RECENT_MASTERY_DAYS:
            recent += 1
        else:
            older.append((outcome, 0.5 ** (days / MASTERY_HALF_LIFE_DAYS)))
    if not recent or len(older) < MASTERY_DELTA_MIN_BASELINE:
        return None
    before, _ = _mastery_from_evidence(older)
    return current - before


def _trend(attempts: list[int]) -> int | None:
    """Later half minus earlier half, in points, over attempts in time order.

    Halves rather than first-vs-last: two individual scores are dominated by
    which questions came up, and a five-question quiz moves 20 points per
    question. Averaging each half is the cheapest thing that survives that.
    """
    if len(attempts) < MIN_ATTEMPTS_FOR_TREND:
        return None
    mid = len(attempts) // 2
    earlier = attempts[:mid]
    later = attempts[mid:]
    return round(sum(later) / len(later) - sum(earlier) / len(earlier))


def _recent_days(activity_days: list[dict], window: int) -> list[dict]:
    """Activity rows inside the last `window` days. The rows only exist for
    days something happened, so this is a list of ACTIVE days, not a calendar."""
    cutoff = clock.today() - timedelta(days=window)
    out = []
    for row in activity_days:
        try:
            day = date.fromisoformat(str(row.get("day")))
        except (ValueError, TypeError):
            continue
        if day >= cutoff:
            out.append(row)
    return out
