"""Pydantic request/response models — grouped by domain for readability."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Tone = Literal["brand", "sky", "mint", "sun", "coral", "azure", "jade"]


class Me(BaseModel):
    id: str
    email: str | None


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
    subspaces: list[SubspaceOut] = []


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tone: Tone = "brand"


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    tone: Tone | None = None


class SubspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SubspaceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SubspaceLinkCreate(BaseModel):
    linked_subspace_id: str


class SuggestSubspaceOut(BaseModel):
    """None when the model isn't configured or couldn't read the file —
    the frontend falls back to an empty, student-typed name either way."""

    name: str | None


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


class ChatSend(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


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


# ── Notes ──────────────────────────────────────────────────────────────
class NoteOut(BaseModel):
    id: str
    title: str
    body_md: str
    origin: Literal["user", "agent", "doc"]
    source_ids: list[str] | None = None
    updated_at: datetime


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    body_md: str = ""
    origin: Literal["user", "agent", "doc"] = "user"


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=140)
    body_md: str | None = None


class NoteGenerate(BaseModel):
    topic: str | None = Field(default=None, max_length=140)


class NoteAiInline(BaseModel):
    """A prompt typed inline as `/ai <prompt>` in the notes editor — returns
    a fragment to insert at the cursor, not a whole new note."""

    prompt: str = Field(min_length=1, max_length=500)


class NoteAiInlineOut(BaseModel):
    content_md: str


# ── Flashcards ─────────────────────────────────────────────────────────
Grade = Literal["again", "hard", "good", "easy"]


class DeckOut(BaseModel):
    id: str
    name: str
    total: int
    due: int
    known_pct: int


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


class FlashcardCreate(BaseModel):
    front: str = Field(min_length=1, max_length=500)
    back: str = Field(min_length=1, max_length=2000)
    source: str | None = None


class GradeIn(BaseModel):
    grade: Grade


class FlashcardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=500)
    back: str | None = Field(default=None, min_length=1, max_length=2000)
    source: str | None = None


class CardsGenerate(BaseModel):
    """Ask the model for a whole deck, not the single card the old flow made."""

    topic: str | None = Field(default=None, max_length=120)
    count: int = Field(default=8, ge=3, le=20)
    deck_name: str | None = Field(default=None, max_length=80)
    # Optional seed text (e.g. the assistant reply the user just read).
    source_text: str | None = Field(default=None, max_length=8000)


# ── Quizzes ────────────────────────────────────────────────────────────
class QuizQuestion(BaseModel):
    q: str
    choices: list[str]
    answer_index: int
    source: str | None = None
    subtopic: str | None = None


class QuizOut(BaseModel):
    id: str
    topic: str | None
    questions: list[QuizQuestion]
    created_at: datetime


class QuizGenerate(BaseModel):
    topic: str | None = Field(default=None, max_length=140)
    count: int = Field(default=5, ge=1, le=20)


class QuizSubmit(BaseModel):
    answers: list[int]


class QuizResultOut(BaseModel):
    score: int
    correct: list[bool]


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


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = "🧠"
    tone: Tone = "brand"
    description: str | None = None
    instructions: str = Field(min_length=1, max_length=4000)
    capabilities: list[str] = Field(default_factory=lambda: ["docs", "quiz"])
    memory_scope: MemoryScope = "session"
    output_format: str | None = Field(default=None, max_length=300)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = None
    tone: Tone | None = None
    description: str | None = None
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    capabilities: list[str] | None = None
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


class StudentModelIn(BaseModel):
    """Explicit, student-set fields only — computed fields (weak/strong
    areas, streak) are never accepted from the client."""

    learning_style: str | None = Field(default=None, max_length=60)
    session_length_minutes: int | None = Field(default=None, ge=5, le=180)
    exam_context: str | None = Field(default=None, max_length=140)
    teaching_preference: str | None = Field(default=None, max_length=400)


class TopicSignal(BaseModel):
    subspace_id: str
    topic: str
    average: int


class StudentModelOut(BaseModel):
    learning_style: str | None
    session_length_minutes: int | None
    exam_context: str | None
    teaching_preference: str | None
    weak_areas: list[TopicSignal]
    strong_areas: list[TopicSignal]
    streak_days: int


class BriefSuggestion(BaseModel):
    """A concrete next action computed from real stored data — never model
    output, so it can't drift from what `route` actually leads to."""

    label: str
    route: str


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


class SettingsOut(BaseModel):
    daily_goal: int
    reminder_time: time | None
    streak_freeze_enabled: bool
    spaced_pace: Literal["relaxed", "balanced", "aggressive"]
    answer_only_from_docs: bool
    always_show_citations: bool


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    daily_goal: int | None = Field(default=None, ge=1, le=500)
    reminder_time: time | None = None
    streak_freeze_enabled: bool | None = None
    spaced_pace: Literal["relaxed", "balanced", "aggressive"] | None = None
    answer_only_from_docs: bool | None = None
    always_show_citations: bool | None = None


# ── Utility ────────────────────────────────────────────────────────────
class OkOut(BaseModel):
    ok: bool = True


class ErrorEnvelope(BaseModel):
    """Kept for OpenAPI docs — the real serializer lives in errors.py."""

    error: dict[str, Any]
