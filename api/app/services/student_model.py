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
from typing import Any, NamedTuple

from ..schemas import StudentModelOut, TopicSignal
from . import supabase
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

# What counts as a concept the student is struggling with.
WEAK_CONCEPT_ACCURACY = 60

# How many feedback events to replay. Preferences are folded by replaying
# events in order, so this bounds the work; 300 taps is far more than a real
# student produces, and the oldest are the most decayed anyway.
FEEDBACK_WINDOW = 300

# How many of the student's own turns to mine for stated preferences. Their
# messages are short, so this is a small payload; 80 covers weeks of real use
# and the phrasing habits it looks for repeat rather than needing full history.
MESSAGE_WINDOW = 80


class _ConceptEvent(NamedTuple):
    """One question the student was asked about one concept, and whether they
    got it right. The atom concept mastery is folded from."""

    at: str
    correct: bool
    subspace_id: str


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
    accuracy: int
    #: Later-half minus earlier-half accuracy. None below the trend threshold.
    trend: int | None
    days_since_seen: int | None
    subspace_ids: tuple[str, ...]

    @property
    def is_weak(self) -> bool:
        return self.accuracy < WEAK_CONCEPT_ACCURACY

    @property
    def is_falling(self) -> bool:
        return self.trend is not None and self.trend <= -TREND_THRESHOLD

    @property
    def crosses_subjects(self) -> bool:
        """The same concept tagged in more than one topic. The cheap half of
        cross-subject transfer, available without the Gap Map."""
        return len(self.subspace_ids) > 1


@dataclass(frozen=True)
class TopicView:
    """Everything known about one subspace, from stored rows only."""

    subspace_id: str
    subject_id: str
    subject: str
    topic: str
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

    # ── Concept views ─────────────────────────────────────────────────

    @property
    def weak_concepts(self) -> list[ConceptView]:
        """Worst first. The most directly actionable list in the model — a
        concept is small enough to actually revise in one sitting, which a
        topic average is not."""
        return sorted(
            (c for c in self.concepts if c.is_weak), key=lambda c: c.accuracy
        )

    @property
    def strong_concepts(self) -> list[ConceptView]:
        return sorted(self.concepts, key=lambda c: -c.accuracy)[:3]

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

    # ── Derived views ─────────────────────────────────────────────────

    @property
    def rated(self) -> list[TopicView]:
        """Topics with enough attempts for their average to mean something."""
        return [t for t in self.topics if t.quiz_average is not None]

    @property
    def weak_areas(self) -> list[TopicView]:
        return sorted(self.rated, key=lambda t: t.quiz_average or 0)[:3]

    @property
    def strong_areas(self) -> list[TopicView]:
        return sorted(self.rated, key=lambda t: -(t.quiz_average or 0))[:3]

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
            return (date.today() - date.fromisoformat(str(self.activity_days[0]["day"]))).days
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
        )


def _signal(t: TopicView) -> TopicSignal:
    return TopicSignal(
        subspace_id=t.subspace_id,
        topic=t.topic,
        average=t.quiz_average or 0,
        subject=t.subject,
        trend=t.trend,
        days_since_activity=t.days_since_activity,
    )


# ── The read pass ──────────────────────────────────────────────────────


_warned_no_rpc = False

#: Shape `student_snapshot` returns. Also the fallback's assembly order.
_SNAPSHOT_KEYS = (
    "settings", "subjects", "subspaces", "quiz_results", "quizzes",
    "daily_activity", "decks", "flashcards", "notes", "documents",
    "response_feedback", "chat_messages",
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
        payload = await supabase.db_rpc("student_snapshot", {"p_user_id": user_id})
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
    ) = await asyncio.gather(
        supabase.db_select("user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1),
        supabase.db_select("subjects", filters={"user_id": f"eq.{user_id}"}, select="id,name"),
        supabase.db_select(
            "subspaces",
            filters={"user_id": f"eq.{user_id}"},
            select="id,subject_id,name,last_activity_at",
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
        supabase.db_select("decks", filters={"user_id": f"eq.{user_id}"}, select="id,subspace_id"),
        supabase.db_select(
            "flashcards", filters={"user_id": f"eq.{user_id}"}, select="deck_id,due_at"
        ),
        supabase.db_select("notes", filters={"user_id": f"eq.{user_id}"}, select="subspace_id"),
        supabase.db_select(
            "documents", filters={"user_id": f"eq.{user_id}"}, select="subspace_id,status"
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
    exactly once. That is why this is ten selects and not nine, and it is
    smaller on the wire than the nine-select version would have been.
    """
    # ONE round trip, not twelve.
    #
    # These were twelve concurrent `db_select`s. Concurrency was not the
    # problem and `gather` was not the fix: against a remote Supabase every
    # extra connection pays its own TLS handshake, which costs more than the
    # overlap saves — measured in `_bulk_counts`'s note in routers/spaces.py.
    # Twelve round trips is ~500ms of network however it is scheduled, and this
    # function is the read behind the brief, chat personalisation, note and
    # quiz generation and the feedback policy. So it asks once.
    #
    # `student_snapshot` mirrors every window, ordering and projection below.
    # Falls back to the twelve reads if the function is missing, so a database
    # that has not taken the migration still serves rather than 500s.
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

    settings_row = settings_rows[0] if settings_rows else {}
    subject_names = {s["id"]: s.get("name") or "Untitled" for s in subject_rows}
    deck_subspace = {d["id"]: d.get("subspace_id") for d in decks}
    quiz_by_id = {q["id"]: q for q in quizzes}
    today = date.today()
    now = datetime.now(UTC)

    # ── Fold every list down to per-subspace counts ────────────────────
    #
    # One pass, oldest-first, doing double duty: the per-topic score series
    # AND the per-concept correctness series. Both need the same rows in the
    # same order, so walking `results` twice would buy nothing.
    scores: dict[str, list[int]] = {}
    concept_events: dict[str, list[_ConceptEvent]] = {}
    for r in sorted(results, key=lambda r: str(r.get("submitted_at") or "")):
        quiz = quiz_by_id.get(r.get("quiz_id"))
        if not quiz:
            # Older than the quiz window, or a quiz since deleted. The score is
            # unattributable without it, so it is skipped rather than guessed.
            continue
        subspace_id = quiz.get("subspace_id")
        if subspace_id:
            scores.setdefault(subspace_id, []).append(int(r["score"]))
        _fold_concepts(r, quiz, concept_events)

    cards_due: dict[str, int] = {}
    cards_total: dict[str, int] = {}
    for c in cards:
        subspace_id = deck_subspace.get(c.get("deck_id"))
        if not subspace_id:
            continue
        cards_total[subspace_id] = cards_total.get(subspace_id, 0) + 1
        if _due(c.get("due_at"), now):
            cards_due[subspace_id] = cards_due.get(subspace_id, 0) + 1

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

    topics: list[TopicView] = []
    for s in subspace_rows:
        subspace_id = s["id"]
        attempts = scores.get(subspace_id, [])
        average = (
            round(sum(attempts) / len(attempts))
            if len(attempts) >= MIN_ATTEMPTS_FOR_AVERAGE
            else None
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
                days_since_activity=_days_since(s.get("last_activity_at"), today),
                cards_due=cards_due.get(subspace_id, 0),
                cards_total=cards_total.get(subspace_id, 0),
                notes=note_counts.get(subspace_id, 0),
                docs=doc_counts.get(subspace_id, 0),
            )
        )

    # Display casing for each normalized tag, taken from however it was first
    # written. The model normalizes to compare and de-normalizes to speak.
    concept_labels: dict[str, str] = {}
    for quiz in quizzes:
        for question in quiz.get("questions") or []:
            if not isinstance(question, dict):
                continue
            raw = str(question.get("subtopic") or "").strip()
            if raw:
                concept_labels.setdefault(normalize_concept(raw), raw)

    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = compute_streak(
        [r["day"] for r in activity_days], today, freeze=freeze
    )

    return Snapshot(
        settings=settings_row,
        topics=topics,
        concepts=_build_concepts(concept_events, concept_labels, today),
        activity_days=activity_days,
        streak_days=streak_days,
        feedback=feedback,
        user_messages=[r.get("content") or "" for r in user_message_rows],
    )


async def preference_context(user_id: str) -> Snapshot:
    """The three tables `preferences.resolve()` actually reads, and no more.

    `snapshot()` is ten selects because the concept and topic models need them.
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
    return (await snapshot(user_id)).to_model()


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


def _due(due_at: str | None, now: datetime) -> bool:
    parsed = _parse_dt(due_at)
    return parsed is not None and parsed <= now


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
    writes. Kept as a named function so the Gap Map and confusion pairs use
    literally this one when they land, rather than a second copy that
    almost agrees."""
    return " ".join(str(tag or "").split()).lower()


def _fold_concepts(
    result: dict, quiz: dict, into: dict[str, list[_ConceptEvent]]
) -> None:
    """Turn one quiz result into per-concept right/wrong events.

    `answers` is the list of chosen indices, positionally aligned with
    `questions`. A result whose length disagrees with the quiz's is not
    discarded wholesale — the overlapping prefix is still sound, and quizzes
    are regenerated often enough that a stale-length row is a real case rather
    than a hypothetical one.
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
        concept = normalize_concept(question.get("subtopic") or "")
        if not concept:
            # Untagged question. Older quizzes predate `subtopic`, and a
            # question with no concept contributes to the topic average but
            # cannot contribute here.
            continue
        into.setdefault(concept, []).append(
            _ConceptEvent(
                at=at,
                correct=chosen == question.get("answer_index"),
                subspace_id=subspace_id,
            )
        )


def _build_concepts(
    events: dict[str, list[_ConceptEvent]], labels: dict[str, str], today: date
) -> list[ConceptView]:
    out: list[ConceptView] = []
    for concept, evs in events.items():
        if len(evs) < MIN_QUESTIONS_FOR_CONCEPT:
            continue
        evs = sorted(evs, key=lambda e: e.at)
        correct = sum(1 for e in evs if e.correct)
        out.append(
            ConceptView(
                concept=concept,
                label=labels.get(concept, concept),
                asked=len(evs),
                correct=correct,
                accuracy=round(100 * correct / len(evs)),
                trend=_trend([100 if e.correct else 0 for e in evs]),
                days_since_seen=_days_since(evs[-1].at, today),
                # Sorted so the tuple is comparable and stable across runs —
                # set iteration order is not.
                subspace_ids=tuple(sorted({e.subspace_id for e in evs if e.subspace_id})),
            )
        )
    return out


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
    cutoff = date.today() - timedelta(days=window)
    out = []
    for row in activity_days:
        try:
            day = date.fromisoformat(str(row.get("day")))
        except (ValueError, TypeError):
            continue
        if day >= cutoff:
            out.append(row)
    return out
