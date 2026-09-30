"""The Home brief stays current and personal without inventing anything.

Three properties, each of which failed quietly in some earlier form:

* **Fresh** — the cache key is a hash of the prompt, so it only tracks progress
  if progress is IN the prompt. Grading one card, submitting a quiz, keeping the
  streak: each must change the fingerprint (and a no-op must not).
* **Grounded** — the model is only ever shown real facts, and a reply that
  quotes a number the facts don't contain is discarded for deterministic copy.
* **Personal, safely** — a first name when it is really a name, a time of day
  only when the client told us its zone, a goal date only when it parses
  unambiguously.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app import deps
from app.config import settings
from app.routers.me import brief as brief_module
from app.schemas import BriefSuggestion
from app.services import student_model as sm

from .conftest import OWNER

TODAY = date.today()


def _days_ago(n: int) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def _topic(**kwargs) -> sm.TopicView:
    base = dict(
        subspace_id="t1", subject_id="subj", subject="ML", topic="Attention",
        quiz_average=None, quiz_attempts=0, trend=None, days_since_activity=None,
        cards_due=0, cards_total=0, notes=0, docs=0, mastery=50, evidence_n=0.0,
    )
    base.update(kwargs)
    return sm.TopicView(**base)


def _snap(*, topics=(), days=(), settings_=None, **kwargs) -> sm.Snapshot:
    return sm.Snapshot(
        settings=settings_ or {},
        topics=list(topics),
        concepts=[],
        activity_days=[
            {"day": (TODAY - timedelta(days=d)).isoformat(), "cards_reviewed": c, "quizzes_taken": q}
            for d, c, q in days
        ],
        streak_days=kwargs.pop("streak_days", 0),
        **kwargs,
    )


# ── The cache key follows progress ─────────────────────────────────────


class _LLM:
    def __init__(self, reply: str = "Attention needs a pass\nA short session now beats relearning it later.") -> None:
        self.calls: list[str] = []
        self.reply = reply

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        self.calls.append(messages[-1]["content"])
        yield self.reply


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch, db):
    """The real snapshot over a seeded fake database, with only the model faked."""
    llm = _LLM()
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(brief_module, "get_llm", lambda: llm)

    async def _no_suggestion(_snap):
        return None

    monkeypatch.setattr(brief_module, "_compute_suggestion", _no_suggestion)
    brief_module._brief_cache.clear()  # noqa: SLF001

    db.seed("user_settings", [{"user_id": OWNER, "daily_goal": 20}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [{
        "id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "Attention",
        "last_activity_at": _days_ago(1),
    }])
    db.seed("quizzes", [{"id": "q1", "user_id": OWNER, "subspace_id": "t1", "questions": []}])
    db.seed("quiz_results", [])
    db.seed("daily_activity", [
        {"user_id": OWNER, "day": (TODAY - timedelta(days=1)).isoformat(),
         "cards_reviewed": 5, "quizzes_taken": 0, "study_seconds": 300, "chat_messages": 0},
    ])
    db.seed("decks", [])
    db.seed("flashcards", [])
    db.seed("card_reviews", [])
    return SimpleNamespace(llm=llm, db=db, user=SimpleNamespace(id=OWNER, name="Abiram"))


async def _render(live):
    return await brief_module.brief(live.user, tz=None)


async def test_an_unchanged_student_costs_one_generation(live):
    await _render(live)
    await _render(live)
    assert len(live.llm.calls) == 1


async def test_grading_a_card_regenerates(live):
    await _render(live)
    live.db.rows["daily_activity"].insert(0, {
        "user_id": OWNER, "day": TODAY.isoformat(), "cards_reviewed": 1,
        "quizzes_taken": 0, "study_seconds": 20, "chat_messages": 0,
    })
    await _render(live)
    assert len(live.llm.calls) == 2

    # …and the next card is one more fact, so one more generation, not a stale hit.
    live.db.rows["daily_activity"][0]["cards_reviewed"] = 2
    await _render(live)
    assert len(live.llm.calls) == 3


async def test_submitting_a_quiz_regenerates(live):
    await _render(live)
    live.db.rows["quiz_results"] = [
        {"user_id": OWNER, "score": 80, "submitted_at": _days_ago(0), "quiz_id": "q1", "answers": []},
    ]
    await _render(live)
    assert len(live.llm.calls) == 2
    assert "Latest quiz" in live.llm.calls[1]
    assert "scored 80%" in live.llm.calls[1]


async def test_streak_state_change_regenerates(live):
    # Studied yesterday only: the streak is on the line, not extended.
    live.db.rows["daily_activity"].append({
        "user_id": OWNER, "day": (TODAY - timedelta(days=2)).isoformat(),
        "cards_reviewed": 5, "quizzes_taken": 0, "study_seconds": 60, "chat_messages": 0,
    })
    await _render(live)
    assert "nothing logged yet today" in live.llm.calls[0]

    live.db.rows["daily_activity"].insert(0, {
        "user_id": OWNER, "day": TODAY.isoformat(), "cards_reviewed": 0,
        "quizzes_taken": 0, "study_seconds": 10, "chat_messages": 1,
    })
    await _render(live)
    assert len(live.llm.calls) == 2
    assert "extended today" in live.llm.calls[1]


async def test_a_regeneration_is_asked_not_to_repeat_the_last_headline(live):
    await _render(live)
    live.db.rows["daily_activity"].insert(0, {
        "user_id": OWNER, "day": TODAY.isoformat(), "cards_reviewed": 9,
        "quizzes_taken": 0, "study_seconds": 20, "chat_messages": 0,
    })
    await _render(live)
    assert "previous headline" not in live.llm.calls[0]
    assert "'Attention needs a pass'" in live.llm.calls[1]

    # The hint is not part of the cache key, or every answer would evict itself.
    await _render(live)
    assert len(live.llm.calls) == 2


# ── Only real facts reach the model, and only real numbers leave it ────


def test_a_bare_snapshot_yields_no_progress_claims():
    facts = brief_module._brief_facts(_snap())  # noqa: SLF001
    text = brief_module._format_facts(facts)  # noqa: SLF001
    for absent in ("Latest quiz", "Streak", "personal best", "Their first name", "goal:", "Recommended"):
        assert absent not in text
    assert "first session" in text


def test_every_number_in_the_facts_comes_from_the_snapshot():
    snap = _snap(
        topics=[_topic(cards_due=7, days_since_activity=1)],
        days=[(0, 12, 1), (1, 9, 0), (2, 3, 0)],
        streak_days=3,
        settings_={"daily_goal": 30},
    )
    text = brief_module._format_facts(brief_module._brief_facts(snap))  # noqa: SLF001
    numbers = brief_module._numbers_in(text)  # noqa: SLF001
    assert numbers <= {"7", "12", "30", "1", "3", "0"}
    assert {"7", "12", "30", "3"} <= numbers
    assert "12 cards reviewed against a daily goal of 30 (goal not reached yet)" in text
    assert "extended today, now 3 days in a row" in text


async def test_a_reply_quoting_a_real_number_is_kept(live):
    live.db.rows["quiz_results"] = [
        {"user_id": OWNER, "score": 80, "submitted_at": _days_ago(0), "quiz_id": "q1", "answers": []},
    ]
    live.llm.reply = "Solid quiz on Attention\nYou scored 80% today, worth locking in."
    out = await _render(live)
    assert out.generated
    assert "80%" in out.body


async def test_a_reply_inventing_a_number_falls_back_and_is_not_cached(live):
    live.llm.reply = "Attention is climbing\nThat's a 12-day streak, keep going."
    out = await _render(live)
    assert out.generated is False
    await _render(live)
    assert len(live.llm.calls) == 2  # the fallback was not cached


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("You scored 85% today", False),
        ("You scored 90% today", True),
        ("Nine days running", True),
        ("Twelve cards are waiting", False),  # 12 is a fact below
        ("Sort out the one you keep missing", False),
        ("A few cards left", True),
    ],
)
def test_invented_quantity(text, expected):
    allowed = frozenset({"85", "12"})
    assert brief_module._invented_quantity(text, allowed) is expected  # noqa: SLF001


# ── The streak, the latest quiz and what moved ─────────────────────────


@pytest.mark.parametrize(
    ("days", "streak", "state", "n"),
    [
        ([(0, 1, 0), (1, 1, 0), (2, 1, 0)], 3, "extended", 3),
        ([(0, 1, 0)], 1, "started", 1),
        ([(1, 1, 0), (2, 1, 0), (3, 1, 0)], 0, "at_risk", 3),
        ([(4, 1, 0), (5, 1, 0), (6, 1, 0)], 0, "broken", 3),
        ([(4, 1, 0)], 0, "none", 0),
        ([], 0, "none", 0),
    ],
)
def test_streak_state(days, streak, state, n):
    got = brief_module._streak_state(_snap(days=days, streak_days=streak), TODAY)  # noqa: SLF001
    assert (got["state"], got["days"]) == (state, n)


def _attempts(*scores_newest_first, days_ago=0):
    return tuple(
        sm.QuizAttempt("q1", "t1", s, _days_ago(days_ago + i)) for i, s in enumerate(scores_newest_first)
    )


def test_latest_quiz_detects_a_personal_best_and_the_change():
    snap = _snap(topics=[_topic()], quiz_attempts=_attempts(90, 70, 80))
    got = brief_module._last_quiz(snap, TODAY)  # noqa: SLF001
    assert got["is_pb"] is True
    assert (got["score"], got["prev"], got["delta"], got["best_before"]) == (90, 70, 20, 80)
    assert got["topic"] == "Attention"


def test_latest_quiz_below_the_best_is_not_a_personal_best():
    got = brief_module._last_quiz(_snap(quiz_attempts=_attempts(75, 90)), TODAY)  # noqa: SLF001
    assert got["is_pb"] is False and got["delta"] == -15


def test_a_first_attempt_is_not_a_personal_best():
    got = brief_module._last_quiz(_snap(quiz_attempts=_attempts(95)), TODAY)  # noqa: SLF001
    assert got["is_pb"] is False and got["delta"] is None


def test_an_old_quiz_is_not_news():
    assert brief_module._last_quiz(_snap(quiz_attempts=_attempts(90, days_ago=9)), TODAY) is None  # noqa: SLF001


def test_biggest_mastery_change_picks_the_larger_move_either_way():
    snap = _snap(topics=[
        _topic(subspace_id="a", topic="A", mastery_delta=6),
        _topic(subspace_id="b", topic="B", mastery_delta=-14),
        _topic(subspace_id="c", topic="C", mastery_delta=2),
    ])
    assert brief_module._biggest_mastery_change(snap) == {"topic": "B", "delta": -14}  # noqa: SLF001
    assert brief_module._biggest_mastery_change(_snap(topics=[_topic(mastery_delta=3)])) is None  # noqa: SLF001


async def test_mastery_delta_is_measured_from_the_new_evidence_only(db):
    db.seed("user_settings", [{"user_id": OWNER}])
    db.seed("subjects", [{"id": "subj", "user_id": OWNER, "name": "ML"}])
    db.seed("subspaces", [{"id": "t1", "user_id": OWNER, "subject_id": "subj", "name": "A",
                           "last_activity_at": _days_ago(0)}])
    old = [{"user_id": OWNER, "subspace_id": "t1", "grade": 3, "reviewed_at": _days_ago(10 + i)}
           for i in range(4)]
    new = [{"user_id": OWNER, "subspace_id": "t1", "grade": 1, "reviewed_at": _days_ago(0)}
           for _ in range(4)]
    db.seed("card_reviews", new + old)
    snap = await sm.snapshot(OWNER)
    assert snap.topics[0].mastery_delta is not None and snap.topics[0].mastery_delta < -5

    # Nothing recent → nothing to report.
    db.seed("card_reviews", old)
    assert (await sm.snapshot(OWNER)).topics[0].mastery_delta is None


def test_due_later_today_counts_only_cards_before_local_midnight():
    now = datetime(2026, 9, 30, 20, 0, tzinfo=UTC)
    snap = _snap(upcoming_due=(now + timedelta(hours=1), now + timedelta(hours=9)))
    # In UTC midnight is 4h away, so only the first card lands "today".
    assert brief_module._brief_facts(snap, now=now)["cards_due_later_today"] == 1  # noqa: SLF001
    # In Kolkata (UTC+5:30) it is already 01:30 next day; midnight is 22.5h away.
    assert brief_module._brief_facts(snap, now=now, tz="Asia/Kolkata")["cards_due_later_today"] == 2  # noqa: SLF001


# ── Names ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Abiram", "Abiram"),
        ("Abiram Mandava", "Abiram"),
        ("  abiram  ", "Abiram"),
        ("ABIRAM", "Abiram"),
        ("Anne-Marie Smith", "Anne-Marie"),
        ("McDonald", "McDonald"),
        ("Zoë", "Zoë"),
        ("Priya, PhD", "Priya"),
        ("abiram116", None),
        ("someone@example.com", None),
        ("a", None),
        ("", None),
        (None, None),
        ("   ", None),
        ("Student", None),
        ("user", None),
        ("123", None),
        ("<script>", None),
        ("Dr.", None),
        ("x" * 60, None),
    ],
)
def test_first_name(raw, expected):
    assert brief_module._first_name(raw) == expected  # noqa: SLF001


def test_the_name_reaches_the_prompt_only_when_it_is_a_name():
    named = brief_module._format_facts(brief_module._brief_facts(_snap(), name="Abiram"))  # noqa: SLF001
    anon = brief_module._format_facts(brief_module._brief_facts(_snap(), name=None))  # noqa: SLF001
    assert "Their first name: Abiram" in named
    assert "first name" not in anon


@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        ({"user_metadata": {"display_name": " Abiram M "}}, "Abiram M"),
        ({"user_metadata": {"full_name": "Priya Nair"}}, "Priya Nair"),
        ({"user_metadata": {"name": "Sam"}}, "Sam"),
        ({"user_metadata": {"display_name": "", "full_name": "Lee"}}, "Lee"),
        ({"email": "abiram116@x.com", "user_metadata": {}}, None),
        ({"user_metadata": None}, None),
        ({"user_metadata": {"display_name": 5}}, None),
        ({}, None),
    ],
)
def test_claimed_name_never_falls_back_to_the_email(claims, expected):
    assert deps._claimed_name(claims) == expected  # noqa: SLF001


# ── Time of day ────────────────────────────────────────────────────────

_NOW = datetime(2026, 9, 30, 15, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("tz", "expected"),
    [
        ("Asia/Kolkata", "evening"),  # 20:30
        ("America/Los_Angeles", "morning"),  # 08:00
        ("Europe/London", "afternoon"),  # 16:00
        ("Asia/Tokyo", "late night"),  # 00:00
        ("+330", "evening"),
        ("-420", "morning"),
        (None, None),
        ("", None),
        ("Not/AZone", None),
        ("../../etc/passwd", None),
        ("99999", None),
        ("+1000", None),  # outside +/-14h
        ("x" * 200, None),
    ],
)
def test_part_of_day_needs_a_real_zone(tz, expected):
    assert brief_module._part_of_day(_NOW, tz) == expected  # noqa: SLF001


def test_no_zone_means_no_time_of_day_wording():
    text = brief_module._format_facts(brief_module._brief_facts(_snap(), now=_NOW))  # noqa: SLF001
    assert "Time of day" not in text


# ── Goal / exam ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Final exam 2026-10-14", 14),
        ("GATE on 14 October 2026", 14),
        ("GATE on 14th Oct 2026", 14),
        ("Boards, October 14, 2026", 14),
        ("Boards Oct 14 2026", 14),
        ("Today's the day: 2026-09-30", 0),
        ("Exam on 10/14/2026", None),  # ambiguous numeric form
        ("Exam on 14 October", None),  # no year
        ("Exam in October", None),
        ("2026-10-14 or maybe 2026-11-02", None),  # two dates
        ("Exam 2026-02-31", None),  # not a date
        ("Exam 2026-09-01", None),  # already past
        ("Exam 2031-01-01", None),  # implausibly far
        ("just get better at calculus", None),
    ],
)
def test_exam_days_left_only_when_sure(text, expected):
    assert brief_module._exam_days_left(text, date(2026, 9, 30)) == expected  # noqa: SLF001


def test_goal_and_style_reach_the_facts():
    snap = _snap(settings_={"student_model": {
        "exam_context": "Final exam 2099-01-01",
        "learning_style": "examples first",
    }})
    text = brief_module._format_facts(brief_module._brief_facts(snap))  # noqa: SLF001
    assert "Their stated goal: 'Final exam 2099-01-01'" in text
    assert "examples first" in text


# ── The fallback is personal and factual without a model ───────────────


def _fallback(snap, name=None, suggestion=None):
    facts = brief_module._brief_facts(snap, name=name, suggestion=suggestion)  # noqa: SLF001
    return brief_module._fallback_brief(facts, suggestion)  # noqa: SLF001


def test_fallback_marks_a_goal_hit_with_name_and_streak():
    out = _fallback(
        _snap(topics=[_topic(days_since_activity=0)], days=[(0, 25, 0), (1, 5, 0)], streak_days=2,
              settings_={"daily_goal": 20}),
        name="Abiram",
    )
    assert out.generated is False
    assert out.headline == "Daily goal done"
    assert "25 cards" in out.body and "Abiram" in out.body and "day 2" in out.body


def test_fallback_celebrates_a_personal_best():
    out = _fallback(_snap(topics=[_topic(days_since_activity=0)], quiz_attempts=_attempts(92, 80)))
    assert out.headline == "New personal best"
    assert "92%" in out.body and "80%" in out.body and "Attention" in out.body


def test_fallback_is_gentle_and_honest_about_a_dip():
    out = _fallback(_snap(topics=[_topic(days_since_activity=0)], quiz_attempts=_attempts(55, 80)))
    assert "dip" in out.headline.lower()
    assert "55%" in out.body and "25 points" in out.body
    assert "!" not in out.body


def test_fallback_flags_a_streak_on_the_line():
    out = _fallback(
        _snap(topics=[_topic(days_since_activity=1, cards_due=4)], days=[(1, 5, 0), (2, 5, 0)], streak_days=0),
        name="Priya",
    )
    assert out.headline == "Keep your streak alive"
    assert "2 days running, Priya" in out.body and "4 cards" in out.body


def test_fallback_never_invents_a_name_or_an_exam_date():
    out = _fallback(_snap(topics=[_topic(days_since_activity=1)], days=[(1, 5, 0)]))
    assert ", None" not in out.body and "None" not in out.headline
    caught_up = _fallback(_snap(
        topics=[_topic(days_since_activity=1)], days=[(1, 5, 0)],
        settings_={"student_model": {"exam_context": "Boards in October"}},
    ))
    assert "days to go" not in caught_up.body


def test_fallback_counts_down_to_a_parseable_exam():
    in_ten = (TODAY + timedelta(days=10)).isoformat()
    out = _fallback(_snap(
        topics=[_topic(days_since_activity=1)], days=[(1, 5, 0)],
        settings_={"student_model": {"exam_context": f"Midterm {in_ten}"}},
    ))
    assert "10 days to go" in out.body


def test_fallback_for_a_brand_new_student():
    assert _fallback(_snap()).headline == "Nothing here yet"
    assert _fallback(_snap(), name="Abiram").headline == "Welcome, Abiram"


def test_the_suggestion_reason_is_in_the_prompt_facts_not_repeated_in_the_fallback():
    s = BriefSuggestion(label="Retake the Attention quiz", route="/x", reason="Your quiz average in Attention is 62%.", action="weak_topic")
    snap = _snap(topics=[_topic(days_since_activity=1)], days=[(1, 5, 0)])
    text = brief_module._format_facts(brief_module._brief_facts(snap, suggestion=s))  # noqa: SLF001
    assert "Retake the Attention quiz" in text and "average in Attention is 62%" in text
    assert "62%" not in _fallback(snap, suggestion=s).body


def test_body_is_cut_at_a_sentence_never_mid_word():
    long = "One thing. Two things here. Three things that should be dropped entirely."
    assert brief_module._limit_sentences(long) == "One thing. Two things here."  # noqa: SLF001
    runaway = "word " * 100
    out = brief_module._limit_sentences(runaway)  # noqa: SLF001
    assert len(out) <= 245 and not out.endswith("wor")
