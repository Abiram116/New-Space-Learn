"""`GET /me/brief` — the re-entry line on Home.

The one piece of model-written copy in the product, and the one most able to
embarrass it: a brief that invents a number is worse than no brief. Hence
the deterministic fallback, the fact-checking of quantities against
`_brief_facts`, and the markup stripping.

Two properties matter more than the wording:

* **Fresh.** The facts are read off the snapshot, so they move the moment the
  student does something (a card graded, a quiz submitted, a streak kept), and
  the cache key is a hash of the prompt built from them — so the copy
  regenerates exactly when the facts change and not otherwise.
* **Personal, but only with real material.** The name, time of day, goal and
  learning style are woven in when known and omitted when not; nothing is
  guessed to fill a gap."""

from __future__ import annotations

import hashlib
import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from ...config import settings as cfg
from ...deps import CurrentUser, get_current_user
from ...schemas import BriefOut, BriefSuggestion
from ...services import clock, personalization, supabase
from ...services import student_model as student_model_service
from ...services.llm import get_llm
from ...services.streaks import compute_streak
from ...services.student_model import MisconceptionView, Snapshot, TopicView
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
async def brief(
    user: CurrentUser = Depends(get_current_user),
    tz: Annotated[str | None, Query()] = None,
) -> BriefOut:
    """One personal line for Home, in the student's own material's terms.

    Replaces "Good evening, Abiram" — a greeting tells you nothing you didn't
    already know. This says where you stood and what to play next.

    `tz` is the browser's IANA zone (or a signed offset in minutes east of UTC).
    It only decides the time-of-day wording and what "later today" means; an
    absent or unrecognised value simply drops that wording.

    Runs on the fast model: it is a ~40-word answer over facts we already have,
    and paying 70B latency on every home render would make the app feel slow
    for no gain. Falls back to deterministic copy rather than failing the page,
    with `generated=false` so the UI never implies a model wrote it.
    """

    # ONE read pass. This used to be three concurrent groups that each did
    # their own reads, which meant `quiz_results`, `daily_activity` and
    # `subspaces` were fetched twice apiece for one render of Home. Everything
    # below is derived from the snapshot instead.
    snap = await student_model_service.snapshot(user.id)
    suggestion = await _compute_suggestion(snap)
    facts = _brief_facts(
        snap, name=_first_name(getattr(user, "name", None)), tz=tz, suggestion=suggestion
    )

    if not cfg.llm_configured:
        return _fallback_brief(facts, suggestion)

    # `render`, not `build` — the snapshot is already in hand, and `build`
    # would do the whole ten-select read pass a second time for one render of
    # Home.
    student = personalization.render(snap, "brief")
    student_block = f"{student}\n\n" if student else ""
    facts_text = _format_facts(facts)

    prompt = (
        "You write the message at the top of a student's study-app home screen. "
        "Write two lines, no more than 45 words in total.\n\n"
        f"{student_block}"
        f"Facts:\n{facts_text}\n\n"
        "Line 1 (headline): at most 8 words. Sentence case — capitalise only "
        "the first word and proper nouns, never Title Case. No greeting "
        "words. It should say where they stand, not describe the app.\n"
        "Line 2 (body): at most 2 short sentences, warm and specific. The "
        "headline already names the subject, so do NOT repeat it — write as if "
        "continuing that sentence.\n\n"
        "Rules:\n"
        "- Use ONLY the Facts above. Never invent or estimate a number, "
        "topic, streak, score, date or event. Quote a number only exactly as "
        "the Facts give it, and say nothing about anything the Facts don't "
        "mention.\n"
        # Without this the model reliably picks the first fact in the list —
        # the most recent topic — and writes "carry on where you left off",
        # which is the one thing the student already knows.
        "- Pick the ONE thing a good tutor would lead with, and mention no more "
        "than two. A win from today (goal reached, streak extended, new "
        "personal best) leads if there is one. Otherwise a dropping score, then "
        "a streak at risk, then a topic gone quiet, then unopened material, "
        "then carrying on with the most recent topic.\n"
        "- Celebrate a real win plainly, in one clause. Be honest and gentle "
        "about a dip: say what happened without alarm and without pretending "
        "it didn't.\n"
        "- If a first name is given, you may use it once, in the body, only "
        "where it reads naturally. If none is given, do not address them by "
        "name.\n"
        "- If the time of day is given you may let it colour the wording, but "
        "never write 'Good morning' or any greeting.\n"
        "- If a recommended next step is given, it appears as a button "
        "beneath your text: lead into it, don't repeat its label or reason.\n"
        "- Warm, direct, a peer not a coach. No emoji, no markdown, no "
        "exclamation marks, no generic motivation ('keep it up', 'you've got "
        "this', 'to deepen your understanding'). Say the concrete thing or say "
        "less.\n"
        "Return exactly two lines separated by a newline. No labels.\n\n"
        "Shape to follow (do NOT reuse these words or any topic from them):\n"
        "<short state-of-play phrase>\n"
        "<one or two sentences: what is true now, and why the next step is worth it>"
    )

    # The prompt IS the brief's complete input: every fact, the student block,
    # the instructions. Identical prompt → an equivalent answer, so its hash is
    # an exact cache key — no staleness to reason about. The moment the student
    # does anything (a quiz, a review, a day passing), the facts change, the
    # hash changes, and the next render regenerates. Until then, Home loads
    # without a model round trip at all, and no Groq quota is spent re-writing
    # the same sentence.
    #
    # The "don't reuse the last headline" hint is appended AFTER hashing, on
    # purpose: it is derived from the previous answer, so hashing it would make
    # every answer invalidate its own cache key and regenerate on every render.
    fingerprint = hashlib.sha256(prompt.encode()).hexdigest()
    if (cached := _brief_cache_get(user.id, fingerprint)) is not None:
        headline, body = cached
        return BriefOut(headline=headline, body=body, generated=True, suggestion=suggestion)

    if previous := _brief_cache_previous_headline(user.id):
        prompt += (
            f"\n\nYour previous headline for this student was: '{previous}'. "
            "Do not open with the same words or the same structure; find a "
            "different angle on what is true now."
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
    body = _limit_sentences(_strip_markup(" ".join(lines[1:])))
    if not headline or not body or len(headline.split()) > 10:
        return _fallback_brief(facts, suggestion)

    # The headline sits in condensed display caps in the UI, but the body does
    # not, and a Title Cased body reads like a press release. Models drift into
    # it regardless of instruction, so normalise rather than re-prompt.

    # The prompt says to quote numbers only as the Facts give them, but a model
    # that ignores it would print a figure contradicting the counts rendered
    # inches away. Cheaper to verify than to trust: any number that isn't in
    # the facts sends us to deterministic copy.
    allowed = _numbers_in(f"{facts_text}\n{student_block}")
    if _invented_quantity(headline, allowed) or _invented_quantity(body, allowed):
        log.info("brief stated a quantity not in the facts; using fallback")
        return _fallback_brief(facts, suggestion)

    # Only a brief that passed every check is cached. A fallback caused by a
    # transient failure must NOT stick — the next render should try again.
    _brief_cache_put(user.id, fingerprint, headline, body)
    return BriefOut(headline=headline, body=body, generated=True, suggestion=suggestion)


# ── Brief cache ────────────────────────────────────────────────────────
#
# In-process, not a database table: one worker, and a lost cache on restart
# costs exactly one regeneration per student — cheaper than a round trip to
# persist it. The TTL is a safety net, not the freshness mechanism (the
# fingerprint is): it bounds how long a wording lives even if nothing changes.

_BRIEF_TTL_S = 12 * 3600
_BRIEF_CACHE_MAX = 2048
_brief_cache: dict[str, tuple[str, float, str, str]] = {}


def _brief_cache_get(user_id: str, fingerprint: str) -> tuple[str, str] | None:
    entry = _brief_cache.get(user_id)
    if entry is None:
        return None
    fp, stored_at, headline, body = entry
    if fp != fingerprint or time.monotonic() - stored_at > _BRIEF_TTL_S:
        return None
    return headline, body


def _brief_cache_previous_headline(user_id: str) -> str | None:
    """The last headline shown to this student, stale or not — what a fresh
    generation is asked not to echo. Deliberately ignores the TTL: an old
    headline is still the thing they read last."""
    entry = _brief_cache.get(user_id)
    return entry[2] if entry else None


def _brief_cache_put(user_id: str, fingerprint: str, headline: str, body: str) -> None:
    if len(_brief_cache) >= _BRIEF_CACHE_MAX and user_id not in _brief_cache:
        # Evict the oldest entry. Insertion order is preserved by dict, and a
        # re-put moves the key to the end below, so the first key is the LRU.
        _brief_cache.pop(next(iter(_brief_cache)))
    _brief_cache.pop(user_id, None)
    _brief_cache[user_id] = (fingerprint, time.monotonic(), headline, body)


_NUMBER_WORDS: dict[str, int | None] = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    # Vague counts have no digit a fact could vouch for, so they can never
    # be checked and are treated as invented outright. "one" is left out: it is
    # a pronoun as often as a count ("the one you missed").
    "dozen": None, "couple": None, "few": None, "several": None,
}


def _numbers_in(text: str) -> frozenset[str]:
    return frozenset(re.findall(r"\d+", text))


def _invented_quantity(text: str, allowed: frozenset[str]) -> bool:
    """True when `text` states a number the facts don't contain.

    Digits and number-words both count; "nine-day" is caught by splitting on
    non-letters. A number that IS in the facts is fine — quoting it exactly is
    the point of giving it to the model.
    """
    if any(n not in allowed for n in re.findall(r"\d+", text)):
        return True
    for w in re.split(r"[^a-z]+", text.lower()):
        if w in _NUMBER_WORDS:
            value = _NUMBER_WORDS[w]
            if value is None or str(value) not in allowed:
                return True
    return False


def _mentions_quantity(text: str) -> bool:
    """Any digit or number-word at all. Kept for callers that allow no facts."""
    return _invented_quantity(text, frozenset())


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


def _limit_sentences(text: str, max_sentences: int = 2, max_chars: int = 240) -> str:
    """At most two sentences, never cut mid-word.

    The prompt asks for this, but "two sentences" is exactly the instruction a
    model stretches. Trimming at a sentence boundary keeps what it did say
    intact; a hard `[:180]` used to slice the last word in half.
    """
    sentences = re.split(r"(?<=[.?])\s+", text.strip())
    out = " ".join(sentences[:max_sentences]).strip()
    if len(out) <= max_chars:
        return out
    # Too long even so: keep whole sentences that fit, else a word boundary.
    kept = ""
    for s in sentences[:max_sentences]:
        if len(f"{kept} {s}".strip()) > max_chars:
            break
        kept = f"{kept} {s}".strip()
    return kept or out[:max_chars].rsplit(" ", 1)[0].rstrip(",;:") + "."


# ── Who and when ───────────────────────────────────────────────────────

_NAME_RE = re.compile(r"^[^\W\d_]+(?:[-'’][^\W\d_]+)*$")
#: What sign-up forms and OAuth providers fill in when they have no name.
_PLACEHOLDER_NAMES = frozenset(
    {"user", "student", "admin", "test", "guest", "anonymous", "null", "none",
     "undefined", "unknown", "me", "you", "name",
     # An honorific first is a title, not the name.
     "dr", "mr", "mrs", "ms", "mx", "prof", "sir", "madam"}
)


def _first_name(raw: str | None) -> str | None:
    """A first name safe to say out loud, or `None`.

    Being called by the wrong name is worse than not being called anything, so
    this is strict: one alphabetic word (hyphen/apostrophe allowed), nothing
    email- or handle-shaped ("abiram116", "a@b.com"), no placeholders. The
    email's local part is never consulted.
    """
    if not raw:
        return None
    words = raw.strip().split()
    if not words:
        return None
    token = words[0].strip(",.")
    if not (2 <= len(token) <= 24) or not _NAME_RE.match(token):
        return None
    if token.lower() in _PLACEHOLDER_NAMES:
        return None
    # "abiram" and "ABIRAM" are people typing quickly; "McDonald" is a name.
    return token.title() if token.islower() or token.isupper() else token


def _zone(tz: str | None) -> tzinfo | None:
    """The zone to speak in: the `tz` the brief was asked with, else the one the
    request carried (see `services/clock`)."""
    return clock.parse_zone(tz) or clock.zone()


def _part_of_day(now: datetime, tz: str | None) -> str | None:
    zone = _zone(tz)
    if zone is None:
        return None  # UTC would be wrong for most students; say nothing.
    hour = now.astimezone(zone).hour
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "late night"


def _end_of_local_day(now: datetime, tz: str | None) -> datetime:
    zone = _zone(tz) or UTC
    local = now.astimezone(zone)
    midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC)


_MONTHS = {
    m: i
    for i, names in enumerate(
        (
            ("january", "jan"), ("february", "feb"), ("march", "mar"),
            ("april", "apr"), ("may",), ("june", "jun"), ("july", "jul"),
            ("august", "aug"), ("september", "sep", "sept"),
            ("october", "oct"), ("november", "nov"), ("december", "dec"),
        ),
        start=1,
    )
    for m in names
}
_ISO_DATE = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
_DAY_MONTH_YEAR = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b"
)
_MONTH_DAY_YEAR = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b")


def _exam_days_left(text: str, today: date) -> int | None:
    """Days until the one date named in `text`, or `None` if unsure.

    Only explicit, unambiguous forms with a four-digit year count: ISO
    (2027-03-12), "12 March 2027", "March 12, 2027". "12/03/2027" is 12 March
    or 3 December depending on the reader, and a year-less "12 March" could be
    either of two — both are skipped rather than guessed. Two different dates
    in one string is also unsure. A date already past is not a countdown.
    """
    found: set[date] = set()
    try:
        for y, m, d in _ISO_DATE.findall(text):
            found.add(date(int(y), int(m), int(d)))
        for d, mon, y in _DAY_MONTH_YEAR.findall(text):
            if (month := _MONTHS.get(mon.lower())) is not None:
                found.add(date(int(y), month, int(d)))
        for mon, d, y in _MONTH_DAY_YEAR.findall(text):
            if (month := _MONTHS.get(mon.lower())) is not None:
                found.add(date(int(y), month, int(d)))
    except ValueError:  # 31 February
        return None
    if len(found) != 1:
        return None
    left = (found.pop() - today).days
    return left if 0 <= left <= 730 else None


# ── Facts ──────────────────────────────────────────────────────────────

#: A topic's mastery must have moved this many points to be worth mentioning.
_MIN_MASTERY_MOVE = 5
#: A latest-quiz result stops being news after this many days.
_QUIZ_NEWS_DAYS = 3


def _parse_day(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _streak_state(snap: Snapshot, today: date) -> dict:
    """Where the streak stands right now: kept today, at risk, broken."""
    days = {d for row in snap.activity_days if (d := _parse_day(row.get("day"))) is not None}
    freeze = bool(snap.settings.get("streak_freeze_enabled", True))
    as_strings = [d.isoformat() for d in days]
    if today in days:
        n = snap.streak_days
        return {"state": "extended" if n >= 2 else "started", "days": n}
    yesterday = today - timedelta(days=1)
    if yesterday in days:
        # `streak_days` reads 0 here without freeze (today has no row yet), so
        # count the run that ends yesterday instead.
        run = compute_streak(as_strings, yesterday, freeze=freeze)
        return {"state": "at_risk" if run >= 2 else "none", "days": run}
    if days:
        last = max(days)
        run = compute_streak(as_strings, last, freeze=freeze)
        if run >= 2:
            return {"state": "broken", "days": run}
    return {"state": "none", "days": 0}


def _last_quiz(snap: Snapshot, today: date) -> dict | None:
    """The latest quiz result and how it compares with the attempt before it
    on the same quiz. `None` once it's old news."""
    if not snap.quiz_attempts:
        return None
    latest = snap.quiz_attempts[0]
    at = student_model_service._parse_dt(latest.at)  # noqa: SLF001 — shared parser
    days_ago = max(0, (today - at.date()).days) if at else 999
    if days_ago > _QUIZ_NEWS_DAYS:
        return None
    prior = [a.score for a in snap.quiz_attempts[1:] if a.quiz_id == latest.quiz_id]
    topic = next((t.topic for t in snap.topics if t.subspace_id == latest.subspace_id), None)
    best_before = max(prior) if prior else None
    return {
        "topic": topic,
        "score": latest.score,
        "prev": prior[0] if prior else None,
        "delta": latest.score - prior[0] if prior else None,
        "best_before": best_before,
        "is_pb": best_before is not None and latest.score > best_before,
        "days_ago": days_ago,
    }


def _biggest_mastery_change(snap: Snapshot) -> dict | None:
    moved = [
        t for t in snap.topics
        if t.mastery_delta is not None and abs(t.mastery_delta) >= _MIN_MASTERY_MOVE
    ]
    if not moved:
        return None
    top = max(moved, key=lambda t: abs(t.mastery_delta or 0))
    return {"topic": top.topic, "delta": top.mastery_delta}


def _last_active(snap: Snapshot, now: datetime) -> str:
    if snap.last_activity_at and 0 <= (now - snap.last_activity_at).total_seconds() <= 20 * 60:
        return "just now"
    away = snap.days_away
    if away == 0:
        return "earlier today" if snap.activity_days else "never"
    return "yesterday" if away == 1 else f"{away} days ago"


def _brief_facts(
    snap: Snapshot,
    *,
    name: str | None = None,
    tz: str | None = None,
    suggestion: BriefSuggestion | None = None,
    now: datetime | None = None,
) -> dict:
    """The facts the copy is allowed to draw on, read off the snapshot.

    Wider than it was. The brief used to see the three most recently touched
    topics and a due count, which meant the only thing it could ever say was
    "carry on with the thing you were already doing" — the one observation the
    student does not need a tutor for. It can now see a score that is sliding,
    a topic that has gone quiet, material sitting unopened, and a whole subject
    that lost this week to another one — and, since these are what change from
    minute to minute, today's progress against the goal, the state of the
    streak, the latest quiz against the one before it, and what moved.

    Everything here is arithmetic over rows the snapshot already holds; nothing
    reads the database. All of it feeds the prompt, so all of it feeds the
    cache key: a fact that changes is a brief that regenerates.
    """
    now = now or datetime.now(UTC)
    today = (now.astimezone(_zone(tz) or UTC)).date()
    recent = snap.most_recent

    today_row = next(
        (r for r in snap.activity_days if _parse_day(r.get("day")) == today), {}
    )
    cards_today = int(today_row.get("cards_reviewed") or 0)
    goal = int(snap.settings.get("daily_goal") or 20)

    later_cutoff = _end_of_local_day(now, tz)
    due_later = sum(1 for d in snap.upcoming_due if d <= later_cutoff)

    explicit = snap.settings.get("student_model") or {}
    exam_text = " ".join(str(explicit.get("exam_context") or "").split())[:140]

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
        # Personal
        "name": name,
        "part_of_day": _part_of_day(now, tz),
        "exam": exam_text or None,
        "exam_days_left": _exam_days_left(exam_text, today) if exam_text else None,
        "learning_style": str(explicit.get("learning_style") or "").strip()[:80] or None,
        "teaching_preference": str(explicit.get("teaching_preference") or "").strip()[:140]
        or None,
        # Minute-to-minute progress
        "cards_today": cards_today,
        "daily_goal": goal,
        "quizzes_today": int(today_row.get("quizzes_taken") or 0),
        "streak": _streak_state(snap, today),
        "last_quiz": _last_quiz(snap, today),
        "mastery_change": _biggest_mastery_change(snap),
        "dipping_concepts": [(c.label, c.trend) for c in snap.falling_concepts[:1]],
        "slipping": [s.label for s in snap.slipping[:2]],
        "cards_due_later_today": due_later,
        "last_active": _last_active(snap, now),
        "docs_ready": snap.docs_ready,
        # The decision engine's own words for why it's pointing where it is.
        "next_step": suggestion.label if suggestion else None,
        "reason": suggestion.reason if suggestion else None,
    }


def _format_facts(f: dict) -> str:
    lines = [
        f"- Most recent topic: {f['topic'] or 'none yet'}"
        + (f" (subject: {f['subject']})" if f["subject"] else ""),
        f"- Cards due for review now: {f['cards_due']}",
        f"- Days since last study session: {f['days_away']}",
    ]
    # Everything below is the difference between a greeting and a tutor. Each
    # line is omitted entirely when there's nothing to say, rather than being
    # rendered as "none" — a list of absences reads as noise and invites the
    # model to write about them.
    if f.get("name"):
        lines.append(f"- Their first name: {f['name']}")
    if f.get("part_of_day"):
        lines.append(f"- Time of day for them right now: {f['part_of_day']}")
    if f.get("last_active"):
        lines.append(f"- Last studied: {f['last_active']}")

    cards_today, goal = f.get("cards_today", 0), f.get("daily_goal") or 0
    if goal and (f["has_history"] or cards_today):
        state = "goal reached" if cards_today >= goal else "goal not reached yet"
        lines.append(f"- Today: {cards_today} cards reviewed against a daily goal of {goal} ({state})")
    if f.get("quizzes_today"):
        lines.append(f"- Quizzes taken today: {f['quizzes_today']}")
    if f.get("cards_due_later_today"):
        lines.append(f"- Further cards coming due later today: {f['cards_due_later_today']}")

    streak = f.get("streak") or {}
    n = streak.get("days", 0)
    match streak.get("state"):
        case "extended":
            lines.append(f"- Streak: extended today, now {n} days in a row")
        case "started":
            lines.append("- Streak: they studied today, starting a new one")
        case "at_risk":
            lines.append(
                f"- Streak: {n} days in a row, but nothing logged yet today — "
                "studying today keeps it alive"
            )
        case "broken":
            lines.append(f"- Streak: their {n}-day streak ended; nothing logged recently")

    if lq := f.get("last_quiz"):
        when = "today" if lq["days_ago"] == 0 else (
            "yesterday" if lq["days_ago"] == 1 else f"{lq['days_ago']} days ago"
        )
        text = f"- Latest quiz ({when})" + (f" on '{lq['topic']}'" if lq["topic"] else "")
        text += f": scored {lq['score']}%"
        if lq["delta"] is not None:
            move = "up" if lq["delta"] > 0 else "down" if lq["delta"] < 0 else "level"
            text += (
                f", {move} {abs(lq['delta'])} points on the previous attempt ({lq['prev']}%)"
                if lq["delta"]
                else f", level with the previous attempt ({lq['prev']}%)"
            )
        if lq["is_pb"]:
            text += f"; a new personal best (previous best {lq['best_before']}%)"
        lines.append(text)

    if mc := f.get("mastery_change"):
        direction = "improved" if mc["delta"] > 0 else "dropped"
        lines.append(
            f"- Biggest recent shift: mastery in '{mc['topic']}' {direction} "
            f"{abs(mc['delta'])} points over the last 3 days"
        )
    for label, trend in f.get("dipping_concepts") or []:
        lines.append(f"- The concept '{label}' is getting harder for them (down {abs(trend)} points)")
    for label in f.get("slipping") or []:
        lines.append(f"- '{label}' was solid a few weeks ago and has been slipping")

    for topic, trend in f["falling"]:
        lines.append(f"- Quiz scores are DROPPING in '{topic}' (down {abs(trend)} points)")
    for topic, days in f["cold"]:
        lines.append(f"- '{topic}' was being studied but hasn't been opened in {days} days")
    for topic in f["untouched"]:
        lines.append(f"- '{topic}' has material uploaded that has never been used")
    for subject in f["neglected_subjects"]:
        lines.append(f"- The subject '{subject}' got no attention this week while others did")
    if f.get("docs_ready"):
        lines.append(f"- Documents processed and ready to study from: {f['docs_ready']}")

    if f.get("exam"):
        left = f.get("exam_days_left")
        when = (
            " (that date is today)" if left == 0
            else f" ({left} days from today)" if left is not None
            else ""
        )
        lines.append(f"- Their stated goal: '{f['exam']}'{when}")
    if f.get("learning_style"):
        lines.append(f"- How they say they learn: {f['learning_style']}")
    if f.get("teaching_preference"):
        lines.append(f"- How they like things explained: {f['teaching_preference']}")

    if not f["has_history"]:
        lines.append("- This is their first session; nothing studied yet.")
    if f.get("next_step"):
        why = f" — because: {f['reason']}" if f.get("reason") else ""
        lines.append(f"- Recommended next step (button shown beneath your text): '{f['next_step']}'{why}")
    return "\n".join(lines)


def _fallback_brief(f: dict, suggestion: BriefSuggestion | None) -> BriefOut:
    """Deterministic copy. Still specific — just not model-written.

    Ordered the same way the prompt is told to rank things, so the page says
    something comparably useful whether or not the model was reachable: a win
    from today first, then a dip, then a streak on the line, then the older
    things that need attention. The fallback is not a degraded mode anyone
    should be able to spot from the content alone.

    The suggestion's own reason is deliberately NOT repeated here: Home already
    prints it beneath the button, and saying it twice is worse than once.
    """
    topic, due, away = f["topic"], f["cards_due"], f["days_away"]
    name = f.get("name")
    addr = f", {name}" if name else ""
    cards_today, goal = f.get("cards_today", 0), f.get("daily_goal") or 0
    streak = f.get("streak") or {}
    n = streak.get("days", 0)
    lq = f.get("last_quiz")

    def out(headline: str, body: str) -> BriefOut:
        return BriefOut(headline=headline, body=body, generated=False, suggestion=suggestion)

    if not f["has_history"] and not topic:
        return out(
            f"Welcome{addr}" if name else "Nothing here yet",
            "Make a space for a subject you're studying, then drop in a PDF and ask it anything.",
        )

    # A win from today.
    if lq and lq["days_ago"] <= 1 and lq["is_pb"]:
        where = f" on {_short(lq['topic'], 40)}" if lq["topic"] else ""
        return out(
            "New personal best",
            f"{lq['score']}%{where}, past your previous best of {lq['best_before']}%.",
        )
    if goal and cards_today >= goal:
        extra = f" That makes day {n} of your streak." if streak.get("state") == "extended" else ""
        return out(
            "Daily goal done",
            f"{cards_today} cards reviewed today{addr}, past the {goal} you set.{extra}",
        )
    if lq and lq["days_ago"] <= 1 and (lq["delta"] or 0) >= 10 and lq["topic"]:
        return out(
            f"{_short(lq['topic'], 28)} is climbing",
            f"Your latest quiz came in at {lq['score']}%, {lq['delta']} points up on the attempt before.",
        )
    # A dip, said plainly and gently.
    if lq and lq["days_ago"] <= 1 and (lq["delta"] or 0) <= -10 and lq["topic"]:
        return out(
            f"A dip on {_short(lq['topic'], 28)}",
            f"That quiz scored {lq['score']}%, {abs(lq['delta'])} points under last time. "
            "One rough attempt happens; it's worth a look while it's fresh.",
        )
    if streak.get("state") == "extended":
        progress = (
            f" {cards_today} of {goal} cards toward today's goal." if 0 < cards_today < goal else ""
        )
        return out(f"Day {n} of your streak", f"You've studied today{addr}.{progress}")
    if streak.get("state") == "at_risk":
        waiting = f" {due} cards are waiting." if due > 0 else ""
        return out(
            "Keep your streak alive",
            f"{n} days running{addr}, and nothing logged yet today.{waiting}",
        )

    if f["falling"]:
        name_, trend = f["falling"][0]
        return out(
            f"{name_} is slipping",
            f"Your quiz average there has dropped {abs(trend)} points. Worth going back over before it compounds.",
        )
    if f.get("slipping"):
        return out(
            f"{_short(f['slipping'][0], 28)} is fading",
            "It looked solid a while back and hasn't held up lately. A short pass now beats relearning it later.",
        )
    if f["cold"]:
        name_, days = f["cold"][0]
        return out(
            f"{name_} has gone quiet",
            f"Nothing on it for {days} days. A short pass now is cheaper than relearning it later.",
        )
    if f["untouched"]:
        return out(
            "Material waiting",
            f"You uploaded to {f['untouched'][0]} and never opened it. Ask it a question and see what's in there.",
        )
    if streak.get("state") == "broken":
        return out(
            "Time for a fresh start",
            f"Your {n}-day streak ended{addr}, but a short session today starts the next one.",
        )
    if due > 0 and topic:
        later = f.get("cards_due_later_today", 0)
        more = f" {later} more come due later today." if later else ""
        return out(
            f"{due} card{'s' if due != 1 else ''} waiting",
            f"Clear your {topic} review while it's still fresh, then push into new material.{more}",
        )
    if away >= 3 and topic:
        return out(
            "Been a few days",
            f"Pick {topic} back up{addr} — a short session now costs less than relearning it later.",
        )
    if topic:
        left = f.get("exam_days_left")
        goal_line = (
            f" {left} days to go on {_short(f['exam'], 50)}."
            if left and f.get("exam")
            else ""
        )
        return out(
            "All caught up",
            f"Nothing due on {topic}{addr}. Good time to add material or test yourself on something new.{goal_line}",
        )
    return out(
        "Ready when you are",
        "Add a topic to your space and start asking questions about your own material.",
    )


@dataclass(frozen=True)
class NextAction:
    """One ranked next-step candidate off the student model — task 7's
    `next_action(snapshot) -> {action, target, reason, route}`.

    `route` is the base `/s/{subject}/{subspace}` path — already enough for
    `resolve="none"` (a chat destination has no query param to resolve).
    `resolve="quiz"`/`"deck"` still owe `_compute_suggestion` an async
    lookup for the specific quiz/deck id before the route is real; that
    split is what keeps this function pure and synchronous.
    """

    action: Literal[
        "fix_misconception", "root_cause", "slipping", "due_cards", "weak_topic", "continue"
    ]
    target: str
    reason: str
    route: str
    resolve: Literal["quiz", "deck", "none"]
    #: Kept alongside `route` (rather than parsed back out of it) purely so
    #: `_compute_suggestion` can call `_latest_quiz_id`/`_due_deck` without
    #: string-splitting a URL to recover it.
    subspace_id: str


def next_action(snap: Snapshot) -> list[NextAction]:
    """Ranked next-step candidates, derived from real stored data only —
    task 7. Pure and synchronous, so it's unit-testable without the database
    and without an event loop; `_compute_suggestion` below resolves each
    candidate against the database in rank order and returns the first that
    resolves to something real, falling through exactly as the old
    single-branch version did (a due-less deck or a topic with no quiz on
    record is skipped, not linked to).

    Ranked by how actionable and how unlikely the student is to have
    already noticed it themselves:

    1. A **misconception** they keep repeating — names the actual confusion,
       not just that a topic is weak, so it's the most concrete thing to fix.
    2. A **weak prerequisite** underlying other weak concepts — fixing the
       root tends to fix the symptoms; fixing a symptom doesn't.
    3. A **slipping** concept or topic — was solid, has quietly decayed. The
       student is least likely to have noticed this one unaided, same
       reasoning `_brief_facts` uses for `falling`.
    4. A real **overdue review backlog** — reviewing is lower friction than
       a fresh retake.
    5. A plain **low average** — worth a retake, but it isn't news.
    6. Otherwise, **continue** the most recently touched topic.
    """
    subject_by_subspace = {t.subspace_id: t.subject_id for t in snap.topics if t.subject_id}
    candidates: list[NextAction] = []

    if best := _best_topic_misconception(snap):
        topic, m = best
        candidates.append(
            NextAction(
                action="fix_misconception",
                target=topic.topic,
                reason=f"A recurring mix-up in {topic.topic}: {m.text} (seen {m.seen}x).",
                route=f"/s/{topic.subject_id}/{topic.subspace_id}",
                resolve="none",
                subspace_id=topic.subspace_id,
            )
        )

    for rc in snap.root_causes[:1]:
        subject_id = subject_by_subspace.get(rc.subspace_id or "")
        if rc.subspace_id and subject_id:
            candidates.append(
                NextAction(
                    action="root_cause",
                    target=rc.concept,
                    reason=(
                        f"{', '.join(rc.because_of)} keep coming up weak — likely "
                        f"because {rc.concept} isn't solid yet."
                    ),
                    route=f"/s/{subject_id}/{rc.subspace_id}",
                    resolve="none",
                    subspace_id=rc.subspace_id,
                )
            )

    for item in snap.slipping[:1]:
        subject_id = subject_by_subspace.get(item.subspace_id or "")
        if item.subspace_id and subject_id:
            candidates.append(
                NextAction(
                    action="slipping",
                    target=item.label,
                    reason=f"{item.label} looked solid a few weeks ago and has slipped since.",
                    route=f"/s/{subject_id}/{item.subspace_id}",
                    resolve="quiz",
                    subspace_id=item.subspace_id,
                )
            )

    # Deck names and per-deck due counts aren't on the snapshot — it
    # aggregates decks to per-topic totals, which is all any other consumer
    # needs. `_compute_suggestion` does one targeted read below, only when
    # there is genuinely a backlog to name, for the specific deck actually
    # carrying it (the topic-level total can span several decks, only some
    # of which have anything due).
    backlog = [t for t in snap.topics if t.cards_due >= 3 and t.subject_id]
    if backlog:
        top = max(backlog, key=lambda t: t.cards_due)
        candidates.append(
            NextAction(
                action="due_cards",
                target=top.topic,
                reason=f"{top.cards_due} cards are waiting for review in {top.topic}.",
                route=f"/s/{top.subject_id}/{top.subspace_id}",
                resolve="deck",
                subspace_id=top.subspace_id,
            )
        )

    weak = [t for t in snap.rated if (t.quiz_average or 0) < 75 and t.subject_id]
    if weak:
        worst = min(weak, key=lambda t: t.quiz_average or 0)
        candidates.append(
            NextAction(
                action="weak_topic",
                target=worst.topic,
                reason=f"Your quiz average in {worst.topic} is {worst.quiz_average}%.",
                route=f"/s/{worst.subject_id}/{worst.subspace_id}",
                resolve="quiz",
                subspace_id=worst.subspace_id,
            )
        )

    if (recent := snap.most_recent) and recent.subject_id:
        candidates.append(
            NextAction(
                action="continue",
                target=recent.topic,
                reason=f"Picking up where you left off in {recent.topic}.",
                route=f"/s/{recent.subject_id}/{recent.subspace_id}",
                resolve="none",
                subspace_id=recent.subspace_id,
            )
        )

    return candidates


def _best_topic_misconception(
    snap: Snapshot,
) -> tuple[TopicView, MisconceptionView] | None:
    """The single highest-weighted misconception across every topic, paired
    with the topic it belongs to — `TopicView.misconceptions` is already
    sorted worst-first per topic, so this only has to compare each topic's
    own top entry, not every entry."""
    best: tuple[TopicView, MisconceptionView] | None = None
    for t in snap.topics:
        if not t.misconceptions:
            continue
        candidate = t.misconceptions[0]
        if best is None or candidate.weight > best[1].weight:
            best = (t, candidate)
    return best


# Button copy per action — kept apart from `next_action` so that function's
# candidates stay data, not presentation; `_short` (button-length trimming)
# has no place in a pure decision function.
_ACTION_LABEL: dict[str, str] = {
    "fix_misconception": "Clear up {target}",
    "root_cause": "Shore up {target}",
    "slipping": "Retake {target}",
    "weak_topic": "Retake the {target} quiz",
    "continue": "Continue {target}",
}


async def _compute_suggestion(snap: Snapshot) -> BriefSuggestion | None:
    """Resolves `next_action`'s ranked candidates against the database, in
    order, and returns the first one that names something real — a quiz or
    deck that actually exists. Falls through rather than linking to a
    due-less deck or a topic with no quiz on record, same as before this was
    generalized past three hand-written branches.
    """
    for candidate in next_action(snap):
        if candidate.resolve == "quiz":
            quiz_id = await _latest_quiz_id(candidate.subspace_id)
            if not quiz_id:
                continue
            label = _ACTION_LABEL[candidate.action].format(target=_short(candidate.target))
            return BriefSuggestion(
                label=label,
                route=f"{candidate.route}/quizzes?q={quiz_id}",
                reason=candidate.reason,
                action=candidate.action,
            )
        if candidate.resolve == "deck":
            deck_id, deck_name = await _due_deck(candidate.subspace_id)
            if not deck_id:
                continue
            return BriefSuggestion(
                label=f"Review {_short(deck_name)}",
                # MUST carry the `/s/` prefix — it is the live route
                # (`App.tsx`: `/s/:spaceId/:subspaceId`). A stale slug-era
                # comment here used to justify dropping it, which meant every
                # suggested-review link silently 404'd.
                route=f"{candidate.route}/flashcards?deck={deck_id}",
                reason=candidate.reason,
                action=candidate.action,
            )
        # resolve == "none": the base `/s/{subject}/{subspace}` route is
        # already the real chat destination — nothing to look up. `ChatView`
        # has no `?q=`-style prefill param, so `reason` is what actually
        # carries the "why" to the UI now (Home shows it under the CTA).
        label = _ACTION_LABEL[candidate.action].format(target=_short(candidate.target))
        return BriefSuggestion(
            label=label, route=candidate.route, reason=candidate.reason, action=candidate.action
        )

    return None


async def _latest_quiz_id(subspace_id: str) -> str | None:
    """The most recent quiz in this subspace, to link `?q=` at — a "Retake"
    suggestion is meaningless without a real quiz on the other end of it."""
    rows = await supabase.db_select(
        "quizzes",
        filters={"subspace_id": f"eq.{subspace_id}"},
        select="id",
        order="created_at.desc",
        limit=1,
    )
    return rows[0]["id"] if rows else None


async def _due_deck(subspace_id: str) -> tuple[str | None, str | None]:
    """The deck in this subspace with the most cards due right now, or
    `(None, None)` if none actually has any. Returns `(id, name)`."""
    decks = await supabase.db_select(
        "decks", filters={"subspace_id": f"eq.{subspace_id}"}, select="id,name"
    )
    if not decks:
        return None, None
    ids = ",".join(d["id"] for d in decks)
    cards = await supabase.db_select(
        "flashcards",
        filters={
            "deck_id": f"in.({ids})",
            "due_at": f"lte.{datetime.now(UTC).isoformat()}",
        },
        select="deck_id",
    )
    due_counts: dict[str, int] = {}
    for c in cards:
        due_counts[c["deck_id"]] = due_counts.get(c["deck_id"], 0) + 1
    if not due_counts:
        return None, None
    deck_id = max(due_counts, key=due_counts.get)
    name = next((d["name"] for d in decks if d["id"] == deck_id), None)
    return deck_id, name


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
