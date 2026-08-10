"""`GET /me/brief` — the re-entry line on Home.

The one piece of model-written copy in the product, and the one most able to
embarrass it: a brief that invents a number is worse than no brief. Hence
the deterministic fallback, the fact-checking of quantities against
`_brief_facts`, and the markup stripping."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from ...config import settings as cfg
from ...deps import CurrentUser, get_current_user
from ...schemas import BriefOut, BriefSuggestion
from ...services import student_model as student_model_service
from ...services import supabase
from ...services.llm import get_llm
from ...services.streaks import compute_streak, to_date
from ...services.voice import COMPANION_VOICE
from ._common import _count

log = logging.getLogger("space_learn.me.brief")

router = APIRouter()


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

    # Three independent read groups — gathered so the brief doesn't pay for
    # them one after another before the model call even begins.
    facts, suggestion, student_model_out = await asyncio.gather(
        _brief_facts(user.id),
        _compute_suggestion(user.id),
        student_model_service.get(user.id),
    )

    if not cfg.llm_configured:
        return _fallback_brief(facts, suggestion)

    student = student_model_service.format_for_prompt(student_model_out)
    student_block = f"{student}\n\n" if student else ""

    prompt = (
        "You are greeting a student returning to their study app. "
        "Write a two-part response, no more than 40 words total.\n\n"
        f"{student_block}"
        f"Facts:\n{_format_facts(facts)}\n\n"
        "Line 1 (headline): 3-6 words naming the topic. Sentence case — "
        "capitalise only the first word and proper nouns. Never Title Case. "
        "No greeting words.\n"
        "Line 2 (body): ONE sentence, 18 words maximum, saying what to do "
        "next and why it's worth doing. The headline already names the topic, "
        "so do NOT repeat it here — write as if continuing that sentence.\n\n"
        "Warm, direct, a peer not a coach. No emoji, no markdown, no asterisks, "
        "no exclamation marks.\n"
        "Cut anything that could be said about any topic. 'to reinforce your "
        "understanding' and 'to deepen your knowledge' are filler — say the "
        "concrete thing instead, or say less.\n"
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
                {
                    "role": "system",
                    "content": COMPANION_VOICE + " You write short, specific copy.",
                },
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
    subs, cards, recent = await asyncio.gather(
        supabase.db_select(
            "subspaces",
            filters={"user_id": f"eq.{user_id}"},
            select="id,name,last_activity_at",
            order="last_activity_at.desc",
            limit=3,
        ),
        supabase.db_select(
            "flashcards",
            filters={
                "user_id": f"eq.{user_id}",
                "due_at": f"lte.{datetime.now(UTC).isoformat()}",
            },
            select="id",
        ),
        supabase.db_select(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}"},
            select="day,chat_messages,cards_reviewed,quizzes_taken",
            order="day.desc",
            limit=7,
        ),
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
    # The deck branch wins when it fires, but the quiz read doesn't depend on
    # it — fetching both up front costs one round trip instead of two.
    decks, results = await asyncio.gather(
        supabase.db_select(
            "decks",
            filters={"user_id": f"eq.{user_id}"},
            select="id,name,subspace_id,subspaces(subject_id)",
        ),
        supabase.db_select(
            "quiz_results",
            filters={"user_id": f"eq.{user_id}"},
            select="score,quizzes(subspace_id,topic,subspaces(subject_id))",
            order="submitted_at.desc",
            limit=30,
        ),
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
                    label=f"Review {_short(deck['name'])}",
                    # MUST carry the `/s/` prefix — it is the live route
                    # (`App.tsx`: `/s/:spaceId/:subspaceId`). A stale slug-era
                    # comment here used to justify dropping it, which meant
                    # every suggested-review link silently 404'd.
                    route=f"/s/{subject_id}/{deck['subspace_id']}/flashcards",
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
