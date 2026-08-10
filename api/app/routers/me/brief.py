"""`GET /me/brief` — the re-entry line on Home.

The one piece of model-written copy in the product, and the one most able to
embarrass it: a brief that invents a number is worse than no brief. Hence
the deterministic fallback, the fact-checking of quantities against
`_brief_facts`, and the markup stripping."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends

from ...config import settings as cfg
from ...deps import CurrentUser, get_current_user
from ...schemas import BriefOut, BriefSuggestion
from ...services import personalization, supabase
from ...services import student_model as student_model_service
from ...services.llm import get_llm
from ...services.student_model import Snapshot
from ...services.voice import COMPANION_VOICE

log = logging.getLogger("space_learn.me.brief")


def _short(name: str, limit: int = 34) -> str:
    """Trim a name to something a button can hold, at a word boundary.

    Decks generated from a chat reply take their name from the topic, and the
    chat agent passes the first sentence of the answer — so a deck can be
    called "The transformer is a neural network architecture used for natural
    language processing". Dropped into "Review {name}" that produced a CTA
    that ran off the end of the button and got clipped mid-word by the
    browser. Cutting on a space keeps it readable instead of truncating to
    "...used for na".
    """
    clean = " ".join((name or "").split())
    if len(clean) <= limit:
        return clean
    cut = clean[:limit].rsplit(" ", 1)[0]
    return f"{cut or clean[:limit]}…"

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

    # ONE read pass. This used to be three concurrent groups that each did
    # their own reads, which meant `quiz_results`, `daily_activity` and
    # `subspaces` were fetched twice apiece for one render of Home. Everything
    # below is derived from the snapshot instead.
    snap = await student_model_service.snapshot(user.id)
    facts = _brief_facts(snap)
    suggestion = await _compute_suggestion(snap)

    if not cfg.llm_configured:
        return _fallback_brief(facts, suggestion)

    # `render`, not `build` — the snapshot is already in hand, and `build`
    # would do the whole ten-select read pass a second time for one render of
    # Home.
    student = personalization.render(snap, "brief")
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
        # Without this the model reliably picks the first fact in the list —
        # the most recent topic — and writes "carry on where you left off",
        # which is the one thing the student already knows. The facts are
        # ranked by how unlikely the student is to have noticed them.
        "Pick the ONE fact a good tutor would lead with. A dropping score "
        "beats a topic gone quiet, which beats unopened material, which beats "
        "carrying on with the most recent topic. Never mention more than "
        "one.\n"
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


def _brief_facts(snap: Snapshot) -> dict:
    """The facts the copy is allowed to draw on, read off the snapshot.

    Wider than it was. The brief used to see the three most recently touched
    topics and a due count, which meant the only thing it could ever say was
    "carry on with the thing you were already doing" — the one observation the
    student does not need a tutor for. It can now see a score that is sliding,
    a topic that has gone quiet, material sitting unopened, and a whole subject
    that lost this week to another one.
    """
    recent = snap.most_recent
    return {
        "topic": recent.topic if recent else None,
        "subject": recent.subject if recent else None,
        "cards_due": snap.cards_due_total,
        "days_away": snap.days_away,
        "has_history": bool(snap.activity_days),
        "falling": [(t.topic, t.trend) for t in snap.falling[:2]],
        "cold": [(t.topic, t.days_since_activity) for t in snap.cold[:2]],
        "untouched": [t.topic for t in snap.untouched[:2]],
        "neglected_subjects": snap.neglected_subjects[:2],
    }


def _format_facts(f: dict) -> str:
    lines = [
        f"- Most recent topic: {f['topic'] or 'none yet'}"
        + (f" (subject: {f['subject']})" if f["subject"] else ""),
        f"- Cards due for review: {f['cards_due']}",
        f"- Days since last study session: {f['days_away']}",
    ]
    # Everything below is the difference between a greeting and a tutor. Each
    # line is omitted entirely when there's nothing to say, rather than being
    # rendered as "none" — a list of absences reads as noise and invites the
    # model to write about them.
    for topic, trend in f["falling"]:
        lines.append(f"- Quiz scores are DROPPING in '{topic}' (down {abs(trend)} points)")
    for topic, days in f["cold"]:
        lines.append(f"- '{topic}' was being studied but hasn't been opened in {days} days")
    for topic in f["untouched"]:
        lines.append(f"- '{topic}' has material uploaded that has never been used")
    for subject in f["neglected_subjects"]:
        lines.append(f"- The subject '{subject}' got no attention this week while others did")
    if not f["has_history"]:
        lines.append("- This is their first session; nothing studied yet.")
    return "\n".join(lines)


def _fallback_brief(f: dict, suggestion: BriefSuggestion | None) -> BriefOut:
    """Deterministic copy. Still specific — just not model-written.

    Ordered the same way the prompt is told to rank things, so the page says
    something comparably useful whether or not the model was reachable. The
    fallback is not a degraded mode anyone should be able to spot from the
    content alone.
    """
    topic, due, away = f["topic"], f["cards_due"], f["days_away"]

    if not f["has_history"] and not topic:
        return BriefOut(
            headline="Nothing here yet",
            body="Make a space for a subject you're studying, then drop in a PDF and ask it anything.",
            generated=False,
            suggestion=suggestion,
        )
    if f["falling"]:
        name, trend = f["falling"][0]
        return BriefOut(
            headline=f"{name} is slipping",
            body=f"Your quiz average there has dropped {abs(trend)} points. Worth going back over before it compounds.",
            generated=False,
            suggestion=suggestion,
        )
    if f["cold"]:
        name, days = f["cold"][0]
        return BriefOut(
            headline=f"{name} has gone quiet",
            body=f"Nothing on it for {days} days. A short pass now is cheaper than relearning it later.",
            generated=False,
            suggestion=suggestion,
        )
    if f["untouched"]:
        return BriefOut(
            headline="Material waiting",
            body=f"You uploaded to {f['untouched'][0]} and never opened it. Ask it a question and see what's in there.",
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


async def _compute_suggestion(snap: Snapshot) -> BriefSuggestion | None:
    """One concrete next action, derived from real stored data only.

    Ranked by what the student is least likely to already be planning:

    1. A topic whose scores are **falling** — retake it while the slide is
       still small. This is new, and it is the one a student almost never
       spots unaided, because each individual quiz felt fine.
    2. A deck with a real overdue backlog — reviewing something already
       learned is lower friction than a fresh retake.
    3. A topic with a **low** average — worth a retake, but it is not news.

    Every branch is gated (a meaningful decline, a non-trivial overdue count,
    enough attempts to trust an average) so this never fires on noise, and
    every one resolves to a route that exists.
    """
    if snap.falling:
        worst = snap.falling[0]
        if worst.subject_id:
            return BriefSuggestion(
                label=f"Retake {_short(worst.topic)}",
                route=f"/s/{worst.subject_id}/{worst.subspace_id}/quizzes",
            )

    # Deck names aren't on the snapshot — it aggregates decks to per-topic card
    # counts, which is all any other consumer needs. One targeted read here,
    # only when there is genuinely a backlog to name.
    backlog = [t for t in snap.topics if t.cards_due >= 3 and t.subject_id]
    if backlog:
        top = max(backlog, key=lambda t: t.cards_due)
        decks = await supabase.db_select(
            "decks",
            filters={"subspace_id": f"eq.{top.subspace_id}"},
            select="id,name",
            limit=1,
        )
        if decks:
            return BriefSuggestion(
                label=f"Review {_short(decks[0]['name'])}",
                # MUST carry the `/s/` prefix — it is the live route
                # (`App.tsx`: `/s/:spaceId/:subspaceId`). A stale slug-era
                # comment here used to justify dropping it, which meant
                # every suggested-review link silently 404'd.
                route=f"/s/{top.subject_id}/{top.subspace_id}/flashcards",
            )

    weak = [t for t in snap.rated if (t.quiz_average or 0) < 75 and t.subject_id]
    if weak:
        worst = min(weak, key=lambda t: t.quiz_average or 0)
        return BriefSuggestion(
            label=f"Retake the {_short(worst.topic)} quiz",
            route=f"/s/{worst.subject_id}/{worst.subspace_id}/quizzes",
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
