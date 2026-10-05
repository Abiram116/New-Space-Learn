"""Pydantic request/response models — grouped by domain for readability."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

Tone = Literal["brand", "sky", "mint", "sun", "coral", "azure", "jade"]


# ── Spaces ─────────────────────────────────────────────────────────────
class SubspaceOut(BaseModel):
    id: str
    subject_id: str
    name: str
    last_activity_at: datetime | None = None
    counts: dict[str, int] = Field(default_factory=dict)


class SpaceOut(BaseModel):
    id: str
    name: str
    tone: Tone
    # Pinned subjects sort to the top of the rail. Defaulted rather than
    # required so a response built before the column existed still validates.
    pinned: bool = False
    subspaces: list[SubspaceOut] = []


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tone: Tone = "brand"


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    tone: Tone | None = None
    pinned: bool | None = None


class SubspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SubspaceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


#: Every row id is a UUID (36 characters). Ids arriving in a body are bounded
#: like any other text, so a megabyte "id" is refused before it reaches a query.
ID_MAX = 64


class SubspaceLinkCreate(BaseModel):
    linked_subspace_id: str = Field(min_length=1, max_length=ID_MAX)


# ── Chat ───────────────────────────────────────────────────────────────
class Citation(BaseModel):
    marker: int
    document_id: str
    document_name: str
    locator: str
    snippet: str


class ChatMessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    citations: list[Citation] | None = None
    created_at: datetime
    #: The follow-up question that came with this answer, if it had a good one.
    suggestion: str | None = None


class ChatSend(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    #: Pasted or picked images, as `data:` URLs.
    #:
    #: Sent inline rather than uploaded first because a pasted screenshot has
    #: no filename, no permanence and no reason to become a `document` — it is
    #: part of one question, not material to be indexed and cited later.
    #:
    #: The caps are the interesting part. Three images because the vision model
    #: degrades sharply with more, and ~1.5MB each because a data URL travels
    #: base64-encoded in a JSON body: the wire cost is ~4/3 of the raw bytes,
    #: and a single free-tier worker holding several of those in memory while
    #: it streams a response is how the 512MB ceiling gets hit.
    images: list[str] = Field(default_factory=list, max_length=3)
    #: True when this is a fresh attempt at a question already on the record —
    #: the student clicked Regenerate rather than typing something new. The
    #: question is not re-stored: it is already in `chat_messages` from the
    #: first attempt, and inserting it again would show the same question
    #: twice for one answer that changed. The answer itself is always stored,
    #: regenerated or not — nothing about a student's history disappears,
    #: only the redundant restatement of the question is skipped.
    regenerate: bool = False

    @model_validator(mode="before")
    @classmethod
    def _no_nul(cls, data: Any) -> Any:
        """PostgreSQL text cannot hold a NUL character: a message containing
        one (a paste from a binary file, a malformed client) failed to save and
        the student saw an error. Removed rather than refused."""
        if isinstance(data, dict) and isinstance(data.get("text"), str) and "\x00" in data["text"]:
            return {**data, "text": data["text"].replace("\x00", "")}
        return data


# ── Documents ──────────────────────────────────────────────────────────
DocStatus = Literal["uploading", "processing", "ready", "failed"]


class DocumentOut(BaseModel):
    id: str
    name: str
    mime_type: str | None
    size_bytes: int | None
    status: DocStatus
    error: str | None = None
    created_at: datetime
    ready_at: datetime | None = None
    # 0-1 while this process is embedding it; None otherwise.
    progress: float | None = None


# ── Notes ──────────────────────────────────────────────────────────────
class NoteOut(BaseModel):
    id: str
    title: str
    body_md: str
    origin: Literal["user", "agent", "doc"]
    source_ids: list[str] | None = None
    updated_at: datetime
    # `origin` only ever records who created the row. These two track who has
    # actually touched the content since — independent, not "last touched
    # by", because an AI-created note a student then edits belongs in BOTH
    # the AI and Mine filters, not just one or the other.
    touched_by_user: bool = False
    touched_by_agent: bool = False
    # Where the note lives. Only populated by the cross-topic listing, which
    # shows notes from everywhere and so has to say where each one came from —
    # a title alone is ambiguous once you are looking at every subject at once.
    subspace_id: str | None = None
    subspace_name: str | None = None
    subject_name: str | None = None


# Images live inside a note as data URLs (the editor allows 4MB each), so this is
# a payload ceiling, not a writing limit. It only stops an unbounded body from
# being written to the database and re-read on every snapshot.
NOTE_BODY_MAX = 5_000_000


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    body_md: str = Field(default="", max_length=NOTE_BODY_MAX)
    origin: Literal["user", "agent", "doc"] = "user"


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=140)
    body_md: str | None = Field(default=None, max_length=NOTE_BODY_MAX)
    # Set by the editor on the one PATCH that immediately follows accepting
    # an `/ai` inline suggestion into the note — every other save (ordinary
    # typing) leaves this unset. Never clears `touched_by_user`: a student
    # who typed `/ai` and accepted the result still edited the note.
    ai_touched: bool = False


class NoteGenerate(BaseModel):
    topic: str | None = Field(default=None, max_length=140)
    # Free text, in the student's own words: "just bullet points", "make it a
    # checklist", "go deep, I have an exam". A fixed enum of styles was the
    # obvious alternative and the wrong one — it can only ever offer the
    # shapes someone thought of in advance, and the model handles the long
    # tail of phrasings fine.
    instructions: str | None = Field(default=None, max_length=500)


class NoteAiInline(BaseModel):
    """A prompt typed inline as `/ai <prompt>` in the notes editor — returns
    a fragment to insert at the cursor, not a whole new note."""

    # Two very different callers share this field: the typed `/ai <prompt>`
    # box (short by construction, and separately capped client-side at 500 —
    # see `LIMITS.notePrompt`), and the selection actions in `toolbar.ts`
    # (Rewrite, Simplify, Example, Quiz), which wrap a selected PASSAGE
    # inside ~250 characters of instruction boilerplate and send the whole
    # thing here. 500 was sized for the first caller only — any selection
    # past a sentence or two blew straight through it. Sized to comfortably
    # fit a selected paragraph plus the boilerplate.
    prompt: str = Field(min_length=1, max_length=4000)
    
    #: The note's own markdown as it stands right now. Optional so an empty
    #: note still validates, but load-bearing whenever the command has no
    #: selection to fall back on ("Summarise the note so far") — without it
    #: the model is asked to summarise a note it was never shown, which is
    #: what made Summarise/Explain/Expand/Key points look broken on any note
    #: whose own words never entered the indexed material or chat history
    #: (every AI-generated note started via the "AI note" dialog, not chat).
    note_text: str = Field(default="", max_length=8000)


class NoteAiInlineOut(BaseModel):
    content_md: str
    #: What the answer was actually built from.
    #:
    #: The retrieval already happened to build the prompt — throwing the
    #: provenance away afterwards is what made an AI paragraph in a note
    #: indistinguishable from one the student wrote, in a product whose whole
    #: claim is that every statement traces to a source. Chat has carried
    #: these since it shipped; notes did not.
    citations: list[Citation] = []


# ── Flashcards ─────────────────────────────────────────────────────────
Grade = Literal["again", "hard", "good", "easy"]


class DeckOut(BaseModel):
    id: str
    name: str
    total: int
    due: int
    known_pct: int
    # Only populated by the cross-topic listing — see NoteOut's identical
    # fields for why (a title alone is ambiguous once every subject is
    # visible at once).
    subspace_id: str | None = None
    subspace_name: str | None = None
    subject_name: str | None = None


class DeckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class FlashcardOut(BaseModel):
    id: str
    deck_id: str
    front: str
    back: str
    source: str | None
    ease: float
    interval_days: int
    reps: int
    due_at: datetime
    # FSRS state. `None` for a card that has never been graded — the SM-2-lite
    # columns above still carry it until its first FSRS review sets these.
    stability: float | None = None
    difficulty: float | None = None
    last_review_at: datetime | None = None


#: A card's "where this came from" line ("notes.pdf · p. 4").
CARD_SOURCE_MAX = 300


class FlashcardCreate(BaseModel):
    front: str = Field(min_length=1, max_length=500)
    back: str = Field(min_length=1, max_length=2000)
    source: str | None = Field(default=None, max_length=CARD_SOURCE_MAX)


class GradeIn(BaseModel):
    grade: Grade
    #: A one-time id the client makes up per grade, so it can safely re-send a
    #: grade whose reply it never received: the server applies each id once.
    review_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class FlashcardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=500)
    back: str | None = Field(default=None, min_length=1, max_length=2000)
    source: str | None = Field(default=None, max_length=CARD_SOURCE_MAX)


class CardsGenerate(BaseModel):
    """Ask the model for a whole deck, not the single card the old flow made."""

    topic: str | None = Field(default=None, max_length=120)
    count: int = Field(default=8, ge=3, le=20)
    deck_name: str | None = Field(default=None, max_length=80)
    # Optional seed text (e.g. the assistant reply the user just read).
    source_text: str | None = Field(default=None, max_length=8000)


_VALID_DIFFICULTY = {"easy", "medium", "hard"}
_VALID_KIND = {"recall", "apply"}
_MISCONCEPTION_MAX_CHARS = 80


# ── Quizzes ────────────────────────────────────────────────────────────
class QuizQuestion(BaseModel):
    q: str
    choices: list[str]
    answer_index: int
    #: Where the question came from, as the student sees it ("notes.pdf · p. 4 · Momentum").
    source: str | None = None
    #: The chunk it was written from. What later quizzes read to cover new
    #: ground instead of the same pages again (`services/coverage.py`).
    source_chunk: str | None = None
    #: True when a second model confirmed the answer is supported by that
    #: source and is the only right choice; False when that check could not be
    #: made. None on quizzes from before it existed.
    checked: bool | None = None
    subtopic: str | None = None
    # Why the right answer is right, shown the moment the student commits to a
    # choice rather than at the end of the quiz. Optional because every quiz
    # generated before this field existed has none, and a tolerant reader is
    # the documented alternative to a data migration.
    explanation: str | None = None
    #: "easy" | "medium" | "hard" — how hard this question was written to be,
    #: used to target the ~75%-expected-success mix (`student_model.difficulty_mix`).
    #: None on every quiz generated before this field existed, or on anything
    #: the model got wrong — normalized away below rather than failing the
    #: question over it.
    difficulty: Literal["easy", "medium", "hard"] | None = None
    #: "recall" (asks for a fact/definition) vs "apply" (asks the student to
    #: use it) — feeds the recall/application mastery split in
    #: `student_model.py`.
    kind: Literal["recall", "apply"] | None = None
    #: One entry per `choices`, same order: a short phrase naming the
    #: misconception behind that WRONG choice, `null` for the correct one.
    #: `None` (not a per-choice list of `None`s) whenever the model didn't
    #: supply one, or supplied one that doesn't line up with `choices` —
    #: normalized below rather than trusted as-is.
    misconceptions: list[str | None] | None = None
    #: 0-2 short concept names this question depends on, for the
    #: concept→prerequisite graph `student_model.py` builds from these.
    prerequisites: list[str] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_optional_fields(cls, data: Any) -> Any:
        """Defensive normalization for the fields an LLM fills in: a bad
        value drops just that field rather than failing the whole question
        (the caller, `quiz_agent`'s checks, already drops a
        question outright on a genuinely broken `q`/`choices`/`answer_index`
        — this is for the softer, additive fields only)."""
        if not isinstance(data, dict):
            return data
        data = dict(data)

        if data.get("difficulty") not in _VALID_DIFFICULTY:
            data.pop("difficulty", None)
        if data.get("kind") not in _VALID_KIND:
            data.pop("kind", None)

        choices = data.get("choices")
        n_choices = len(choices) if isinstance(choices, list) else None
        misconceptions = data.get("misconceptions")
        if (
            n_choices is None
            or not isinstance(misconceptions, list)
            or len(misconceptions) != n_choices
            or not all(m is None or isinstance(m, str) for m in misconceptions)
        ):
            data.pop("misconceptions", None)
        else:
            answer_index = data.get("answer_index")
            data["misconceptions"] = [
                None
                if i == answer_index or not isinstance(m, str) or not m.strip()
                else m.strip()[:_MISCONCEPTION_MAX_CHARS]
                for i, m in enumerate(misconceptions)
            ]

        prereqs = data.get("prerequisites")
        if isinstance(prereqs, list):
            cleaned = [p.strip() for p in prereqs if isinstance(p, str) and p.strip()][:2]
            if cleaned:
                data["prerequisites"] = cleaned
            else:
                data.pop("prerequisites", None)
        else:
            data.pop("prerequisites", None)
        return data


class QuizOut(BaseModel):
    id: str
    topic: str | None
    questions: list[QuizQuestion]
    created_at: datetime
    # Only populated by the cross-topic listing — see NoteOut's identical
    # fields for why.
    subspace_id: str | None = None
    subspace_name: str | None = None
    subject_name: str | None = None
    #: Best score over this user's attempts at this quiz, and how many there
    #: have been. `None` / 0 until the first attempt.
    best_score: int | None = None
    attempts: int = 0


class QuizGenerate(BaseModel):
    topic: str | None = Field(default=None, max_length=140)
    count: int = Field(default=5, ge=1, le=20)


class QuizSubmit(BaseModel):
    #: One per question; a quiz has at most 20 (`QuizGenerate.count`).
    answers: list[int] = Field(max_length=100)
    #: Wall-clock seconds the student spent on the quiz. Client-reported and
    #: therefore advisory — it is a study signal, never a grade input.
    duration_seconds: int | None = Field(default=None, ge=0, le=24 * 3600)


class QuizResultOut(BaseModel):
    score: int
    correct: list[bool]
    duration_seconds: int | None = None
    #: Highest score over this user's EARLIER attempts at this quiz — `None`
    #: on a first attempt. A personal best is `previous_best is not None and
    #: score > previous_best`; computing it here keeps it per-quiz and
    #: identical on every device.
    previous_best: int | None = None
    #: Attempts at this quiz including this one.
    attempts: int = 1


# ── Skills ─────────────────────────────────────────────────────────────
# A Skill is a behavior package, not just a system-prompt string:
#   reasoning style  → `instructions` (unrenamed — no data loss on migration)
#   memory scope     → `memory_scope`: how much chat history it draws on
#   output format    → `output_format`: a formatting instruction, optional
#   allowed tools    → `capabilities`: which agents/context it may use
MemoryScope = Literal["session", "topic", "all"]


class SkillOut(BaseModel):
    id: str
    name: str
    icon: str
    tone: Tone
    description: str | None
    instructions: str
    capabilities: list[str]
    memory_scope: MemoryScope
    output_format: str | None
    is_library: bool


#: Bounds on the parts of a Skill that are free text. Its instructions reach
#: every prompt in a topic it is switched on for, so none of it is unbounded.
SKILL_ICON_MAX = 40
SKILL_CAPABILITIES_MAX = 10
SkillCapability = Field(min_length=1, max_length=40)


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    #: An Icon name in the frontend set, never an emoji.
    icon: str = Field(default="skill", min_length=1, max_length=SKILL_ICON_MAX)
    tone: Tone = "brand"
    description: str | None = Field(default=None, max_length=500)
    instructions: str = Field(min_length=1, max_length=4000)
    capabilities: list[Annotated[str, SkillCapability]] = Field(
        default_factory=lambda: ["docs", "quiz"], max_length=SKILL_CAPABILITIES_MAX
    )
    memory_scope: MemoryScope = "session"
    output_format: str | None = Field(default=None, max_length=300)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, min_length=1, max_length=SKILL_ICON_MAX)
    tone: Tone | None = None
    description: str | None = Field(default=None, max_length=500)
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    capabilities: list[Annotated[str, SkillCapability]] | None = Field(
        default=None, max_length=SKILL_CAPABILITIES_MAX
    )
    memory_scope: MemoryScope | None = None
    output_format: str | None = Field(default=None, max_length=300)


# ── Stats / settings ───────────────────────────────────────────────────
class HeatmapCell(BaseModel):
    day: date
    intensity: int  # 0..3, relative shading only
    # The real figure behind the shading. Without this the UI can only draw an
    # abstract bar and had nothing concrete to show when a day is inspected.
    minutes: int


class ForecastDay(BaseModel):
    """Cards falling due on one upcoming day.

    `day` 0 is today and includes anything already overdue, because a card
    that was due last Tuesday is work you have *now*, not history.
    """

    day: date
    count: int


class StudyComposition(BaseModel):
    """What the last seven days were actually spent on.

    `daily_activity` has counted these three since the app shipped and nothing
    ever read them — the app could report how long you studied but not what you
    did. They cost no extra query: the row is already selected in full.
    """

    chat_messages: int
    cards_reviewed: int
    quizzes_taken: int


class Badge(BaseModel):
    """A foil seal. `tier` drives how precious it looks; `hint` tells an
    unearned badge how to be earned, so a locked slot is never a dead end."""

    id: str
    label: str
    icon: str  # an Icon name in the frontend set, never an emoji
    tone: Tone
    tier: Literal["common", "rare", "elite"]
    earned: bool
    hint: str
    #: Where the student actually stands against the threshold, e.g. 7 of 10
    #: days. Every badge is a threshold on a figure this endpoint already
    #: computes, so this is arithmetic on data in hand, not another read.
    #:
    #: A hint alone ("Study ten days in a row") tells you the rule but not
    #: whether you are one day away or have never started — which is the
    #: difference between a target and a wall. Clamped to `target` so a
    #: 40-day streak reports 30 of 30 rather than 40 of 30.
    progress: int = 0
    target: int = 1


class StudentModelIn(BaseModel):
    """Explicit, student-set fields only — computed fields (weak/strong
    areas, streak) are never accepted from the client."""

    # 60 was sized for a single phrase and silently broke first-run intake the
    # moment onboarding became multi-select. Two picks join to ~75 characters,
    # which 422'd the whole PATCH — and because the intake sends one patch, the
    # session length and teaching preference were discarded along with it. The
    # student answered every question, watched the sample answer rewrite itself,
    # and nothing was saved. 240 holds all four options joined (163) with room
    # for rewording. Stored as JSON in `settings`, so there is no column width
    # behind this number — it was the only thing enforcing the old ceiling.
    learning_style: str | None = Field(default=None, max_length=240)
    session_length_minutes: int | None = Field(default=None, ge=5, le=180)
    exam_context: str | None = Field(default=None, max_length=140)
    teaching_preference: str | None = Field(default=None, max_length=400)
    #: Set by the phone intake, which deliberately leaves out the two
    #: "how do you like it explained" questions (they are about the chat
    #: tutor, which lives on desktop). Desktop reads it to offer those two
    #: questions once, and clears it when they are answered or dismissed.
    #: Stored in the same `student_model` JSON as the fields above — no column.
    intake_skipped_style: bool | None = None


# ── Response feedback ──────────────────────────────────────────────────
class FeedbackIn(BaseModel):
    """One tap on a generated response.

    `kind` is validated against `preferences.FEEDBACK_KINDS` in the handler
    rather than by a Literal here: the taxonomy and its mapping onto preference
    keys live together in one place, and a second copy in the schema layer is
    exactly the duplication that lets them drift.
    """

    surface: Literal["chat", "note", "quiz", "cards"]
    target_id: str = Field(min_length=1, max_length=ID_MAX)
    subspace_id: str = Field(min_length=1, max_length=ID_MAX)
    kind: str = Field(min_length=1, max_length=40)
    concept: str | None = Field(default=None, max_length=120)


class PreferenceOut(BaseModel):
    """A resolved preference, with everything needed to inspect and question
    it. Confidence and evidence are shown to the student because a preference
    they cannot see the basis for is one they cannot correct."""

    key: str
    value: str
    source: Literal["explicit", "observed", "feedback", "experiment"]
    confidence: float
    evidence_count: int
    because: str
    #: False when it's known but below the threshold to change any output.
    actionable: bool


class TopicSignal(BaseModel):
    subspace_id: str
    topic: str
    average: int
    #: Which subject the topic sits under. The model reads across every
    #: subject now, so "Attention" alone is ambiguous once two subjects both
    #: have one.
    subject: str | None = None
    #: Later-half minus earlier-half quiz average, in points. Negative means
    #: getting worse. None when there aren't enough attempts to say.
    trend: int | None = None
    days_since_activity: int | None = None
    #: Mastery split by question `kind` (task 6) — `None` until each side has
    #: enough evidence on its own; a coin-flip split is worse than none. Lets
    #: a UI show "good at recall, shaky on application" instead of one blended
    #: number that hides the split.
    recall_mastery: int | None = None
    application_mastery: int | None = None


class MisconceptionOut(BaseModel):
    """One recurring mix-up, for a read-only UI surface. `last_seen` is the
    timestamp of the most recent occurrence, not the first — a mix-up that
    hasn't recurred in months is the least useful one to lead with."""

    text: str
    last_seen: str | None = None


class RootCauseOut(BaseModel):
    """A weak concept that keeps showing up as a prerequisite of other weak
    concepts — the "likely because of" behind a cluster of symptoms."""

    concept: str
    because_of: list[str]


class SlippingOut(BaseModel):
    """A topic or concept that was solid a few weeks ago and has since
    dropped or gone quiet."""

    kind: Literal["topic", "concept"]
    label: str
    days_since_activity: int | None = None


class StyleSummaryOut(BaseModel):
    """How this student learns best in one subject, per the teaching-strategy
    bandit — only present once there's enough evidence to say it honestly
    (see `style_bandit.strategy_summary`)."""

    subject: str
    strategy_summary: str


class StudentModelOut(BaseModel):
    learning_style: str | None
    session_length_minutes: int | None
    exam_context: str | None
    teaching_preference: str | None
    weak_areas: list[TopicSignal]
    strong_areas: list[TopicSignal]
    streak_days: int
    #: Topics whose scores are dropping — distinct from `weak_areas`, which
    #: are merely low. A topic climbing from 40% to 55% and one sliding from
    #: 85% to 70% need opposite advice, and an average cannot separate them.
    falling_areas: list[TopicSignal] = []
    #: Real history, then nothing for a while.
    cold_areas: list[TopicSignal] = []
    #: Behaviour the app has *observed*, never a preference the student
    #: stated. Kept apart from the explicit fields above on purpose: writing
    #: an inference into `learning_style` would make Settings show the
    #: student a sentence they never wrote as if they had.
    observed_habits: list[str] = []
    #: Top 3 recurring mix-ups across every topic — task 3. Bounded the same
    #: way at the source (`Snapshot.top_misconceptions`).
    top_misconceptions: list[MisconceptionOut] = []
    #: Weak concepts that keep showing up as a prerequisite of other weak
    #: concepts — task 4. Bounded at the source (`Snapshot.root_causes`).
    root_causes: list[RootCauseOut] = []
    #: Topics/concepts that were solid a few weeks ago and have since slipped
    #: — task 5. Bounded at the source (`Snapshot.slipping`).
    slipping: list[SlippingOut] = []
    #: "Learns best through examples" per subject, from the teaching-strategy
    #: bandit — only for subjects with enough evidence to say so honestly.
    #: Empty, not padded with guesses, when nothing qualifies yet.
    style_summaries: list[StyleSummaryOut] = []
    #: True when first-run intake happened on a phone and skipped the
    #: learning-style/depth questions; see `StudentModelIn`. Read back from
    #: the stored JSON by the `/me/student-model` endpoints.
    intake_skipped_style: bool = False


class BriefSuggestion(BaseModel):
    """A concrete next action computed from real stored data — never model
    output, so it can't drift from what `route` actually leads to."""

    label: str
    route: str
    #: Why this was picked, in the same plain terms `next_action` (brief.py)
    #: reasons with — e.g. "You keep confusing Q-learning with SARSA." `None`
    #: only for a caller that predates this field; every suggestion computed
    #: today sets it.
    reason: str | None = None
    #: The `NextAction.action` kind this suggestion resolved from, so a UI can
    #: style a misconception fix differently from a plain "continue".
    action: str | None = None


class BriefOut(BaseModel):
    """The personal re-entry line on Home. `generated` is false when it fell
    back to deterministic copy, so the UI can avoid implying an AI wrote it."""

    headline: str
    body: str
    generated: bool
    suggestion: BriefSuggestion | None = None


class StatsOut(BaseModel):
    streak_days: int
    max_streak: int
    study_minutes_this_week: int
    cards_due: int
    quiz_average: int | None
    docs_indexed: int
    spaces_count: int
    heatmap: list[HeatmapCell]
    badges: list[Badge]
    # Everything below rides on this one response deliberately. Home blocks on
    # /me/stats before it can render, and on Render's free tier the first call
    # of the day already pays a cold start — a second blocking request for the
    # dashboard would double that wait. None of these cost an extra query.
    daily_goal: int
    composition: StudyComposition
    due_forecast: list[ForecastDay]
    # Today's graded cards, so the daily-goal moment counts reviews from every
    # device, not just the one in your hand.
    cards_reviewed_today: int = 0


class SettingsOut(BaseModel):
    daily_goal: int
    streak_freeze_enabled: bool
    answer_only_from_docs: bool
    always_show_citations: bool


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    daily_goal: int | None = Field(default=None, ge=1, le=500)
    streak_freeze_enabled: bool | None = None
    answer_only_from_docs: bool | None = None
    always_show_citations: bool | None = None


# ── Utility ────────────────────────────────────────────────────────────
class OkOut(BaseModel):
    ok: bool = True


# ── Product feedback (the feedback form) ───────────────────────────────
#
# Not `FeedbackIn` above — that is a thumb on one AI answer. This is the form
# in Settings › Feedback and on the landing page, whose questions the admins
# edit without a deploy.

QuestionKind = Literal["rating", "scale", "choice", "multi", "short", "long"]

#: Answer length caps, by kind. Mirrored in `web/src/lib/limits.ts`.
FEEDBACK_SHORT_MAX = 200
FEEDBACK_LONG_MAX = 2000
FEEDBACK_OPTION_MAX = 60
FEEDBACK_OPTIONS_MAX = 12


class FeedbackQuestionOut(BaseModel):
    id: str
    position: int
    prompt: str
    kind: QuestionKind
    options: list[str] = Field(default_factory=list)
    #: The choices that open a "tell us more" box when picked.
    detail_options: list[str] = Field(default_factory=list)
    required: bool = True
    active: bool = True


class FeedbackQuestionCreate(BaseModel):
    prompt: str = Field(min_length=3, max_length=200)
    kind: QuestionKind
    #: Trimmed, de-duplicated and capped at FEEDBACK_OPTIONS_MAX in the handler;
    #: this only stops an absurd list from being parsed at all.
    options: list[str] = Field(default_factory=list, max_length=50)
    detail_options: list[str] = Field(default_factory=list, max_length=50)
    required: bool = True


class FeedbackQuestionUpdate(BaseModel):
    prompt: str | None = Field(default=None, min_length=3, max_length=200)
    options: list[str] | None = Field(default=None, max_length=50)
    detail_options: list[str] | None = Field(default=None, max_length=50)
    required: bool | None = None
    active: bool | None = None


class FeedbackReorder(BaseModel):
    ids: list[Annotated[str, Field(min_length=1, max_length=ID_MAX)]] = Field(min_length=1, max_length=100)


class FeedbackAnswerIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=64)
    #: A number (rating, scale), a choice, several choices, or text — checked
    #: against the question's kind in the handler. Strict, so `true` is not
    #: quietly read as the number 1, nor "5" as 5.
    value: StrictInt | StrictStr | list[StrictStr]
    #: The "tell us more" text, for a choice that asks for it. Kept only when
    #: the picked choice really does ask (checked in the handler).
    detail: str | None = Field(default=None, max_length=500)


class ProductFeedbackIn(BaseModel):
    source: Literal["landing", "settings"]
    answers: list[FeedbackAnswerIn] = Field(max_length=60)
    #: Signed-out visitors only, and only if they want a reply.
    contact_email: str | None = Field(default=None, max_length=254)
    page: str | None = Field(default=None, max_length=300)
    #: A field no person ever sees or fills in. Anything in it means a bot.
    website: str | None = Field(default=None, max_length=200)


class ProductFeedbackOut(BaseModel):
    id: str
    created_at: datetime
    source: str
    signed_in: bool
    contact_email: str | None = None
    page: str | None = None
    answers: list[dict[str, Any]]


class FeedbackTextAnswer(BaseModel):
    text: str
    #: For a "tell us more" answer: the choice it was written about.
    about: str | None = None
    created_at: datetime | None = None
    #: The same person's overall rating (1–5), when they gave one — so a
    #: comment can be read knowing whether a happy or unhappy person wrote it.
    score: int | None = None


class FeedbackKeyword(BaseModel):
    word: str
    count: int


class FeedbackSummaryItem(BaseModel):
    question_id: str
    prompt: str
    kind: str
    responses: int
    #: Rating and scale questions.
    average: float | None = None
    median: float | None = None
    #: The same average over the period before this one, to show the direction.
    previous_average: float | None = None
    #: How many gave each number, every number present ("1".."5" or "0".."10").
    distribution: dict[str, int] = Field(default_factory=dict)
    #: Rating: the share (0–100) who gave 4 or 5.
    positive_share: int | None = None
    #: Scale: promoters (9–10) minus detractors (0–6), as a percentage, −100..100.
    nps: int | None = None
    promoters: int = 0
    passives: int = 0
    detractors: int = 0
    #: Choice and multi questions: how often each choice was picked.
    counts: dict[str, int] = Field(default_factory=dict)
    #: Short and long questions: the words that keep coming up, and the answers.
    keywords: list[FeedbackKeyword] = Field(default_factory=list)
    texts: list[FeedbackTextAnswer] = Field(default_factory=list)


class FeedbackDay(BaseModel):
    date: str
    count: int


class FeedbackSummaryOut(BaseModel):
    #: The period in days; 0 means everything.
    days: int
    total: int
    #: Responses in the period of the same length just before; None for "all".
    previous_total: int | None = None
    by_day: list[FeedbackDay] = Field(default_factory=list)
    sources: dict[str, int] = Field(default_factory=dict)
    signed_in: int = 0
    visitors: int = 0
    #: Visitors who left an address and are owed a reply.
    want_reply: int = 0
    #: The findings in plain sentences, most important first.
    takeaways: list[str] = Field(default_factory=list)
    items: list[FeedbackSummaryItem] = Field(default_factory=list)


class AdminUnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class AdminUnlockOut(BaseModel):
    token: str
    #: Epoch seconds.
    expires_at: int
