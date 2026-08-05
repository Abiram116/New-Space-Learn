"""Current-user endpoints: identity, stats, settings, re-entry brief."""

from __future__ import annotations

import logging
import re
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from ..config import settings as cfg
from ..deps import CurrentUser, get_current_user
from ..errors import NotFound
from ..schemas import (
    Badge,
    BriefOut,
    BriefSuggestion,
    HeatmapCell,
    Me,
    SettingsOut,
    SettingsUpdate,
    StatsOut,
    StudentModelIn,
    StudentModelOut,
)
from ..services import student_model as student_model_service
from ..services import supabase
from ..services.llm import get_llm
from ..services.streaks import compute_max_streak, compute_streak, to_date

log = logging.getLogger("space_learn.me")
router = APIRouter()


@router.get("/me", response_model=Me)
async def me(user: CurrentUser = Depends(get_current_user)) -> Me:
    return Me(id=user.id, email=user.email)


# ── Settings ───────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = SettingsOut(
    daily_goal=20,
    reminder_time=None,
    streak_freeze_enabled=True,
    spaced_pace="balanced",
    answer_only_from_docs=True,
    always_show_citations=True,
)


async def _ensure_settings_row(user_id: str) -> dict:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    if rows:
        return rows[0]
    inserted = await supabase.db_insert(
        "user_settings",
        {**_DEFAULT_SETTINGS.model_dump(mode="json"), "user_id": user_id},
    )
    return inserted[0]


@router.get("/me/settings", response_model=SettingsOut)
async def get_settings(user: CurrentUser = Depends(get_current_user)) -> SettingsOut:
    row = await _ensure_settings_row(user.id)
    return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})


@router.patch("/me/settings", response_model=SettingsOut)
async def patch_settings(
    body: SettingsUpdate, user: CurrentUser = Depends(get_current_user)
) -> SettingsOut:
    await _ensure_settings_row(user.id)
    patch = body.model_dump(exclude_unset=True, mode="json")
    if not patch:
        row = await _ensure_settings_row(user.id)
        return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})
    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = await supabase.db_update(
        "user_settings", filters={"user_id": f"eq.{user.id}"}, patch=patch
    )
    if not updated:
        raise NotFound("Settings row missing.")
    return SettingsOut(**{k: updated[0].get(k) for k in SettingsOut.model_fields})


# ── Student Model ──────────────────────────────────────────────────────


@router.get("/me/student-model", response_model=StudentModelOut)
async def get_student_model(
    user: CurrentUser = Depends(get_current_user),
) -> StudentModelOut:
    await _ensure_settings_row(user.id)
    return await student_model_service.get(user.id)


@router.patch("/me/student-model", response_model=StudentModelOut)
async def patch_student_model(
    body: StudentModelIn, user: CurrentUser = Depends(get_current_user)
) -> StudentModelOut:
    await _ensure_settings_row(user.id)
    return await student_model_service.set_explicit(
        user.id, body.model_dump(exclude_unset=True)
    )


# ── Stats ──────────────────────────────────────────────────────────────


@router.get("/me/stats", response_model=StatsOut)
async def stats(user: CurrentUser = Depends(get_current_user)) -> StatsOut:
    settings_row = await _ensure_settings_row(user.id)

    # Half a year of activity, aligned so the grid starts on a Monday. Eight
    # weeks was too little to read as a trend — a student looking at their own
    # analytics wants to see a term, not a fortnight.
    today = date.today()
    start = today - timedelta(days=181)
    since = start - timedelta(days=start.weekday())
    days = await supabase.db_select(
        "daily_activity",
        filters={
            "user_id": f"eq.{user.id}",
            "day": f"gte.{since.isoformat()}",
        },
        order="day.asc",
    )
    by_day: dict[str, dict] = {row["day"]: row for row in days}
    heatmap: list[HeatmapCell] = []
    max_seconds = max((int(r.get("study_seconds", 0)) for r in days), default=1) or 1
    d = since
    while d <= today:
        row = by_day.get(d.isoformat())
        seconds = int(row["study_seconds"]) if row else 0
        intensity = 0
        if seconds > 0:
            ratio = seconds / max_seconds
            intensity = 1 + min(2, int(ratio * 3))
        heatmap.append(HeatmapCell(day=d, intensity=intensity))
        d += timedelta(days=1)

    # Streak: consecutive days ending today (or yesterday if streak-freeze on).
    freeze = bool(settings_row.get("streak_freeze_enabled", True))
    streak_days = compute_streak([r["day"] for r in days], today, freeze=freeze)
    max_streak = compute_max_streak([r["day"] for r in days])

    week_start = today - timedelta(days=6)
    week_seconds = sum(
        int(r.get("study_seconds", 0))
        for r in days
        if to_date(r["day"]) >= week_start
    )

    # Aggregates from other tables.
    cards_due = await _count_cards_due(user.id)
    quiz_avg = await _quiz_average(user.id)
    docs_indexed = await _count(user.id, "documents", extra={"status": "eq.ready"})
    spaces_count = await _count(user.id, "subjects")

    max_reps = await _cards_mastered(user.id)
    badges = [
        Badge(
            id="first_steps", label="First card", icon="deck", tone="sky",
            tier="common", earned=max_reps >= 1,
            hint="Review a single flashcard.",
        ),
        Badge(
            id="streak_10", label="10-day streak", icon="flame", tone="sun",
            tier="common", earned=max_streak >= 10,
            hint="Study ten days in a row.",
        ),
        Badge(
            id="ten_docs", label="Well read", icon="doc", tone="mint",
            tier="rare", earned=docs_indexed >= 10,
            hint="Index ten documents.",
        ),
        Badge(
            id="perfect_quiz", label="Perfect score", icon="target", tone="coral",
            tier="rare", earned=await _has_perfect_quiz(user.id),
            hint="Score 100% on any quiz.",
        ),
        Badge(
            id="fifty_known", label="Fifty known", icon="seal", tone="mint",
            tier="rare", earned=max_reps >= 50,
            hint="Get fifty cards to a known state.",
        ),
        Badge(
            id="streak_30", label="30-day streak", icon="flame", tone="brand",
            tier="elite", earned=max_streak >= 30,
            hint="Study thirty days in a row.",
        ),
    ]

    return StatsOut(
        streak_days=streak_days,
        max_streak=max_streak,
        study_minutes_this_week=week_seconds // 60,
        cards_due=cards_due,
        quiz_average=quiz_avg,
        docs_indexed=docs_indexed,
        spaces_count=spaces_count,
        heatmap=heatmap,
        badges=badges,
    )


# ── Internal helpers ───────────────────────────────────────────────────


async def _count_cards_due(user_id: str) -> int:
    now = datetime.now(UTC).isoformat()
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "due_at": f"lte.{now}"},
        select="id",
    )
    return len(rows)


async def _quiz_average(user_id: str) -> int | None:
    rows = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}"},
        select="score",
        order="submitted_at.desc",
        limit=5,
    )
    if not rows:
        return None
    return round(sum(int(r["score"]) for r in rows) / len(rows))


async def _cards_mastered(user_id: str) -> int:
    """Cards seen at least once — the honest denominator for "known"."""
    rows = await supabase.db_select(
        "flashcards",
        filters={"user_id": f"eq.{user_id}", "reps": "gte.1"},
        select="id",
    )
    return len(rows)


async def _has_perfect_quiz(user_id: str) -> bool:
    rows = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}", "score": "eq.100"},
        select="id",
        limit=1,
    )
    return bool(rows)


async def _count(user_id: str, table: str, *, extra: dict[str, str] | None = None) -> int:
    filters = {"user_id": f"eq.{user_id}"}
    if extra:
        filters.update(extra)
    rows = await supabase.db_select(table, filters=filters, select="id")
    return len(rows)


# ── Re-entry brief ─────────────────────────────────────────────────────


@router.get("/me/brief", response_model=BriefOut)
async def brief(user: CurrentUser = Depends(get_current_user)) -> BriefOut:
    """One personal line for Home, in the student's own material's terms.

    Replaces "Good evening, Abiram" — a greeting tells you nothing you didn't
    already know. This says where you stood and what to play next.

    Runs on the fast model: it is a 40-word answer over facts we already have,
    and paying 70B latency on every home render would make the app feel slow
    for no gain. Falls back to deterministic copy rather than failing the page,
    with `generated=false` so the UI never implies a model wrote it.
    """

    facts = await _brief_facts(user.id)
    suggestion = await _compute_suggestion(user.id)

    if not cfg.llm_configured:
        return _fallback_brief(facts, suggestion)

    student = student_model_service.format_for_prompt(await student_model_service.get(user.id))
    student_block = f"{student}\n\n" if student else ""

    prompt = (
        "You are greeting a student returning to their study app. "
        "Write a two-part response, no more than 40 words total.\n\n"
        f"{student_block}"
        f"Facts:\n{_format_facts(facts)}\n\n"
        "Line 1 (headline): 3-6 words. Sentence case — capitalise only the "
        "first word and proper nouns. Never Title Case. No greeting words.\n"
        "Line 2 (body): ONE sentence, 18 words maximum, saying what to do next "
        "and why. Name the actual topic.\n\n"
        "Warm, direct, a peer not a coach. No emoji, no markdown, no asterisks, "
        "no exclamation marks.\n"
        "NEVER state a quantity, digit, or number-word. The interface already "
        "shows the counts next to your text; repeating them risks contradicting "
        "it. Say 'your backlog', not 'seven cards'.\n"
        "Return exactly two lines separated by a newline. No labels.\n\n"
        "Shape to follow (do NOT reuse these words or any topic from them):\n"
        "<short state-of-play phrase>\n"
        "<what to do next, naming the topic from the Facts above, and why>"
    )

    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {"role": "system", "content": "You write short, human, specific copy."},
                {"role": "user", "content": prompt},
            ],
            model=cfg.groq_model_fast,
            temperature=0.7,
        ):
            parts.append(delta)
        lines = [ln.strip() for ln in "".join(parts).strip().split("\n") if ln.strip()]
    except Exception:
        # The home page must render regardless.
        log.warning("brief generation failed; using fallback", exc_info=True)
        return _fallback_brief(facts, suggestion)

    if len(lines) < 2:
        return _fallback_brief(facts, suggestion)

    headline = _desentence_case(_strip_markup(lines[0])[:70], facts.get("topic"))
    body = _strip_markup(" ".join(lines[1:]))[:180]
    if not headline or not body:
        return _fallback_brief(facts, suggestion)

    # The headline sits in condensed display caps in the UI, but the body does
    # not, and a Title Cased body reads like a press release. Models drift into
    # it regardless of instruction, so normalise rather than re-prompt.

    # The prompt forbids quantities, but a model that ignores it would print a
    # number contradicting the real count rendered inches away. Cheaper to
    # verify than to trust: any quantity at all sends us to deterministic copy.
    if _mentions_quantity(headline) or _mentions_quantity(body):
        log.info("brief mentioned a quantity; using fallback")
        return _fallback_brief(facts, suggestion)

    return BriefOut(headline=headline, body=body, generated=True, suggestion=suggestion)


_NUMBER_WORDS = frozenset(
    "one two three four five six seven eight nine ten eleven twelve "
    "dozen couple few several".split()
)


def _mentions_quantity(text: str) -> bool:
    if any(ch.isdigit() for ch in text):
        return True
    # Split on non-letters so compounds like "nine-day" are caught too.
    return any(w in _NUMBER_WORDS for w in re.split(r"[^a-z]+", text.lower()) if w)


def _desentence_case(text: str, topic: str | None) -> str:
    """Undo Title Case while protecting proper nouns from the topic name.

    Only fires when most words are capitalised — a headline that is already
    sentence case, or one whose capitals are all real proper nouns, is left
    exactly as written.
    """
    words = text.split()
    if len(words) < 3:
        return text
    capitalised = [w for w in words if w[:1].isupper()]
    if len(capitalised) <= len(words) / 2:
        return text

    # Words the topic itself capitalises stay capitalised.
    protected = {w.lower() for w in (topic or "").split() if w[:1].isupper()}
    out = [words[0]]
    for w in words[1:]:
        out.append(w if w.lower() in protected or w.isupper() else w.lower())
    return " ".join(out)


async def _brief_facts(user_id: str) -> dict:
    subs = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}"},
        select="id,name,last_activity_at",
        order="last_activity_at.desc",
        limit=3,
    )
    cards = await supabase.db_select(
        "flashcards",
        filters={
            "user_id": f"eq.{user_id}",
            "due_at": f"lte.{datetime.now(UTC).isoformat()}",
        },
        select="id",
    )
    recent = await supabase.db_select(
        "daily_activity",
        filters={"user_id": f"eq.{user_id}"},
        select="day,chat_messages,cards_reviewed,quizzes_taken",
        order="day.desc",
        limit=7,
    )
    last_day = recent[0]["day"] if recent else None
    days_away = 0
    if last_day:
        try:
            days_away = (date.today() - date.fromisoformat(str(last_day))).days
        except ValueError:
            days_away = 0

    return {
        "topic": subs[0]["name"] if subs else None,
        "topic_count": len(subs),
        "cards_due": len(cards),
        "days_away": days_away,
        "has_history": bool(recent),
    }


def _format_facts(f: dict) -> str:
    lines = []
    lines.append(f"- Most recent topic: {f['topic'] or 'none yet'}")
    lines.append(f"- Cards due for review: {f['cards_due']}")
    lines.append(f"- Days since last study session: {f['days_away']}")
    if not f["has_history"]:
        lines.append("- This is their first session; nothing studied yet.")
    return "\n".join(lines)


def _fallback_brief(f: dict, suggestion: BriefSuggestion | None) -> BriefOut:
    """Deterministic copy. Still specific — just not model-written."""
    topic, due, away = f["topic"], f["cards_due"], f["days_away"]

    if not f["has_history"] and not topic:
        return BriefOut(
            headline="Nothing here yet",
            body="Make a space for a subject you're studying, then drop in a PDF and ask it anything.",
            generated=False,
            suggestion=suggestion,
        )
    if due > 0 and topic:
        return BriefOut(
            headline=f"{due} card{'s' if due != 1 else ''} waiting",
            body=f"Clear your {topic} review while it's still fresh, then push into new material.",
            generated=False,
            suggestion=suggestion,
        )
    if away >= 3 and topic:
        return BriefOut(
            headline="Been a few days",
            body=f"Pick {topic} back up — a short session now costs less than relearning it later.",
            generated=False,
            suggestion=suggestion,
        )
    if topic:
        return BriefOut(
            headline="All caught up",
            body=f"Nothing due on {topic}. Good time to add material or test yourself on something new.",
            generated=False,
            suggestion=suggestion,
        )
    return BriefOut(
        headline="Ready when you are",
        body="Add a topic to your space and start asking questions about your own material.",
        generated=False,
        suggestion=suggestion,
    )


async def _compute_suggestion(user_id: str) -> BriefSuggestion | None:
    """One concrete next action, derived from real stored data only.

    Priority: a deck with overdue cards beats a weak quiz topic, since
    reviewing something already learned is lower-friction than a full
    retake. Both are gated (non-trivial overdue count / enough attempts to
    trust the average) so this never fires on noise.
    """
    decks = await supabase.db_select(
        "decks",
        filters={"user_id": f"eq.{user_id}"},
        select="id,name,subspace_id,subspaces(subject_id)",
    )
    if decks:
        deck_ids = ",".join(d["id"] for d in decks)
        overdue = await supabase.db_select(
            "flashcards",
            filters={
                "user_id": f"eq.{user_id}",
                "deck_id": f"in.({deck_ids})",
                "due_at": f"lte.{datetime.now(UTC).isoformat()}",
            },
            select="deck_id",
        )
        if overdue:
            counts: dict[str, int] = {}
            for row in overdue:
                counts[row["deck_id"]] = counts.get(row["deck_id"], 0) + 1
            top_deck_id = max(counts, key=lambda k: counts[k])
            deck = next((d for d in decks if d["id"] == top_deck_id), None)
            subject_id = ((deck or {}).get("subspaces") or {}).get("subject_id")
            if deck and subject_id and counts[top_deck_id] >= 3:
                return BriefSuggestion(
                    label=f"Review {deck['name']}",
                    route=f"/s/{subject_id}/{deck['subspace_id']}/flashcards",
                )

    results = await supabase.db_select(
        "quiz_results",
        filters={"user_id": f"eq.{user_id}"},
        select="score,quizzes(subspace_id,topic,subspaces(subject_id))",
        order="submitted_at.desc",
        limit=30,
    )
    groups: dict[str, dict] = {}
    for r in results:
        q = r.get("quizzes") or {}
        subspace_id = q.get("subspace_id")
        if not subspace_id:
            continue
        g = groups.setdefault(
            subspace_id,
            {"scores": [], "topic": q.get("topic"), "subject_id": (q.get("subspaces") or {}).get("subject_id")},
        )
        g["scores"].append(int(r["score"]))

    candidates = [
        (sid, sum(g["scores"]) / len(g["scores"]), g)
        for sid, g in groups.items()
        if len(g["scores"]) >= 2 and g["subject_id"]
    ]
    if candidates:
        sid, avg, g = min(candidates, key=lambda c: c[1])
        if avg < 75:
            topic = g["topic"] or "this topic"
            return BriefSuggestion(
                label=f"Retake the {topic} quiz",
                route=f"/s/{g['subject_id']}/{sid}/quizzes",
            )

    return None


def _strip_markup(text: str) -> str:
    """The model occasionally returns bold or a leading label despite the ask.
    This copy renders as plain text, so any stray markup must not reach it."""
    out = text.strip()
    for token in ("**", "__", "##", "#", "`"):
        out = out.replace(token, "")
    for label in ("Headline:", "Body:", "Line 1:", "Line 2:", "-", "*"):
        if out.startswith(label):
            out = out[len(label):].strip()
    return out.strip().strip('"')
