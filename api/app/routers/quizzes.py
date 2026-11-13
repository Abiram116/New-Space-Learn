"""Quizzes: list past, generate a new one (LLM), and submit answers for scoring."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, RateLimited, UpstreamUnavailable, ValidationFailed
from ..guards import assert_subspace, subspace_label
from ..schemas import (
    OkOut,
    QuizExtend,
    QuizGenerate,
    QuizOut,
    QuizQuestion,
    QuizResultOut,
    QuizRewordOut,
    QuizSubmit,
    QuizUpdate,
)
from ..services import activity, coverage, personalization, quiz_agent, rag, student_model, supabase
from ..services.chat_context import format_history, recent_history
from ..services.quiz_shuffle import balance_answer_positions
from ..services.ratelimit import consume_llm_quota
from ..services.student_model import difficulty_mix

log = logging.getLogger("space_learn.quiz")
router = APIRouter()


@router.get("/subspaces/{subspace_id}/quizzes", response_model=list[QuizOut])
async def list_quizzes(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[QuizOut]:
    # Guard and read run together — see the note in notes.list_notes for why
    # that's safe (the read is already user-scoped) and what it saves.
    _, rows, results = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="created_at.desc",
        ),
        _attempt_scores(user.id),
    )
    return [_to_quiz(r, results) for r in rows]


@router.get("/quizzes", response_model=list[QuizOut])
async def list_all_quizzes(
    user: CurrentUser = Depends(get_current_user), limit: int = 300
) -> list[QuizOut]:
    """Every quiz this user has taken or generated, wherever it lives — same
    shape and same reasoning as `notes.list_all_notes`.

    No `assert_*` guard for the same reason `list_all_notes` has none: the
    filter IS `user_id`, applied server-side. `test_guard_coverage.py`
    accepts this shape explicitly.
    """
    quizzes, subspaces, subjects, results = await asyncio.gather(
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}"},
            order="created_at.desc",
            limit=max(1, min(limit, 500)),
        ),
        supabase.db_select(
            "subspaces", filters={"user_id": f"eq.{user.id}"}, select="id,subject_id,name"
        ),
        supabase.db_select("subjects", filters={"user_id": f"eq.{user.id}"}, select="id,name"),
        _attempt_scores(user.id),
    )
    subject_name = {s["id"]: s.get("name") for s in subjects}
    place = {
        s["id"]: (s.get("name"), subject_name.get(s.get("subject_id")))
        for s in subspaces
    }
    out: list[QuizOut] = []
    for row in quizzes:
        quiz = _to_quiz(row, results)
        sub_name, subj_name = place.get(row.get("subspace_id"), (None, None))
        out.append(
            quiz.model_copy(
                update={
                    "subspace_id": row.get("subspace_id"),
                    "subspace_name": sub_name,
                    "subject_name": subj_name,
                }
            )
        )
    return out


@router.get("/quizzes/{quiz_id}", response_model=QuizOut)
async def get_quiz(
    quiz_id: str, user: CurrentUser = Depends(get_current_user)
) -> QuizOut:
    rows, results = await asyncio.gather(
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
            limit=1,
        ),
        _attempt_scores(user.id, quiz_id),
    )
    if not rows:
        raise NotFound("Quiz not found.")
    # With the topic it lives in, so the results screen can make cards there.
    return _to_quiz(rows[0], results).model_copy(
        update={"subspace_id": rows[0].get("subspace_id")}
    )


@router.patch("/quizzes/{quiz_id}", response_model=QuizOut)
async def rename_quiz(
    quiz_id: str,
    body: QuizUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> QuizOut:
    # `topic` is the quiz's display name: the lists show it as the title.
    updated, results = await asyncio.gather(
        supabase.db_update(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
            patch={"topic": body.topic},
        ),
        _attempt_scores(user.id, quiz_id),
    )
    if not updated:
        raise NotFound("Quiz not found.")
    row = updated[0]
    return _to_quiz(row, results).model_copy(update={"subspace_id": row.get("subspace_id")})


@router.delete("/quizzes/{quiz_id}", response_model=OkOut)
async def delete_quiz(
    quiz_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    # Its attempts go with it: `quiz_results.quiz_id` is `on delete cascade`.
    await supabase.db_delete(
        "quizzes", filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"}
    )
    return OkOut()


@router.post(
    "/subspaces/{subspace_id}/quiz/generate",
    response_model=QuizOut,
    status_code=201,
)
async def generate_quiz(
    subspace_id: str,
    body: QuizGenerate,
    user: CurrentUser = Depends(get_current_user),
) -> QuizOut:
    # Must come first: retrieval runs under the service-role key, so an
    # unvalidated subspace_id would read another user's document chunks.
    subspace = await assert_subspace(user.id, subspace_id)
    await consume_llm_quota(user.id, cost=2, daily=True)  # generation is pricier than a chat turn

    # Linked topics, what earlier quizzes covered, the conversation and the
    # student model are independent reads, so they share one round trip.
    linked_ids, (used, earlier), history, snap = await asyncio.gather(
        rag.linked_subspace_ids(user.id, subspace_id),
        coverage.ledger(user.id, subspace_id),
        recent_history(user.id, subspace_id),
        student_model.snapshot(user.id),
    )
    student_context = personalization.render(snap, "quiz", subspace_id=subspace_id)
    topic_mastery = next(
        (t.mastery for t in snap.topics if t.subspace_id == subspace_id), None
    )
    mix = difficulty_mix(topic_mastery, body.count)
    # A conversation IS the student's material: talk a topic through in chat,
    # then ask to be tested on it. With no source picked, only a topic with
    # neither files nor chat is refused; a picked source must have something
    # in it (`quiz_agent.gather_material` says what to add when it doesn't).
    material = quiz_agent.Material([], format_history(history))
    if settings.llm_configured:
        material = await quiz_agent.gather_material(
            user_id=user.id,
            subspace_id=subspace_id,
            source=body.source,
            note_id=body.note_id,
            topic=body.topic,
            count=body.count,
            used=used,
            weak_concepts=[c.label for c in snap.concepts_in(subspace_id) if c.is_weak],
            linked_ids=linked_ids,
            conversation=format_history(history),
        )
    label = subspace_label(subspace)

    generated_title: str | None = None
    if not settings.llm_configured:
        # No key yet — hand back a placeholder set so the take/submit flow is
        # still clickable. This is the ONLY path that may fabricate questions.
        questions = _stub_questions(body.topic, body.count)
    else:
        try:
            draft = await quiz_agent.write_quiz(
                count=body.count,
                topic=body.topic,
                label=label,
                mix=mix,
                sources=material.sources,
                conversation=material.conversation,
                earlier=earlier,
                student_context=student_context,
                general=material.general,
            )
        except ApiError:
            # Already a friendly, typed error (rate limit, upstream down) — let
            # it surface so the user knows to retry rather than being handed
            # silent placeholder questions and told they're real.
            raise
        except Exception as e:
            log.exception("quiz generation failed")
            raise UpstreamUnavailable("Couldn't generate a quiz just now.") from e
        log.info(
            "quiz written subspace=%s from=%s sources=%d %s",
            subspace_id, material.kind, len(material.sources), draft.trace,
        )
        generated_title = draft.title
        # The model puts the right answer first far too often; spread it.
        questions = balance_answer_positions(draft.questions)
        if not questions:
            raise UpstreamUnavailable("The quiz came back in an unexpected format. Try again.")

    # The student rarely types a topic — "Quiz me on this chat" never asks for
    # one — so falling back to the model's own title (or, failing that, the
    # first question's subtopic) is what keeps the quiz list from filling up
    # with "Untitled topic". Only reached for placeholders when unconfigured.
    topic = (
        body.topic
        or generated_title
        or (questions[0].subtopic if questions and questions[0].subtopic else None)
        or label
    )

    inserted = await supabase.db_insert(
        "quizzes",
        {
            "user_id": user.id,
            "subspace_id": subspace_id,
            "topic": topic,
            "questions": [q.model_dump() for q in questions],
        },
    )
    return _to_quiz(inserted[0])


#: The most questions one quiz can grow to with "Add more questions". Past
#: this a quiz is a session of its own; a new quiz is the better tool.
MAX_QUIZ_QUESTIONS = 40

#: Quizzes being added to right now, so a double-click (or a second tab)
#: can't pay for two generations and append both.
_extending: set[str] = set()


@router.post("/quizzes/{quiz_id}/extend", response_model=QuizOut)
async def extend_quiz(
    quiz_id: str,
    body: QuizExtend,
    user: CurrentUser = Depends(get_current_user),
) -> QuizOut:
    """Write `count` more questions into an existing quiz, from the same
    topic and focus, skipping what the quiz (and the topic's earlier quizzes)
    already ask. New questions go at the END, so every earlier attempt's
    answers still line up with the questions they were given for."""
    rows = await supabase.db_select(
        "quizzes", filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"}, limit=1
    )
    if not rows:
        raise NotFound("Quiz not found.")
    quiz = rows[0]
    subspace_id = quiz.get("subspace_id")
    if not subspace_id:
        raise ValidationFailed("This quiz isn't in a topic any more, so there's no material to add from.")
    subspace = await assert_subspace(user.id, subspace_id)
    existing = [q for q in (quiz.get("questions") or []) if isinstance(q, dict)]
    room = MAX_QUIZ_QUESTIONS - len(existing)
    if room <= 0:
        raise ValidationFailed(
            f"This quiz already has {len(existing)} questions — the most one quiz takes. Start a new quiz instead."
        )
    count = min(body.count, room)

    key = f"{user.id}:{quiz_id}"
    if key in _extending:
        raise RateLimited("Already adding questions to this quiz — give it a moment.")
    _extending.add(key)
    try:
        if not settings.llm_configured:
            new = _stub_questions(quiz.get("topic"), count)
        else:
            new = await _write_more(user.id, subspace, quiz, existing, body, count)
        updated = await supabase.db_update(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
            patch={"questions": [*existing, *(q.model_dump() for q in new)]},
        )
    finally:
        _extending.discard(key)
    if not updated:
        raise NotFound("Quiz not found.")
    results = await _attempt_scores(user.id, quiz_id)
    return _to_quiz(updated[0], results).model_copy(update={"subspace_id": subspace_id})


async def _write_more(
    user_id: str, subspace: dict, quiz: dict, existing: list[dict], body: QuizExtend, count: int
) -> list[QuizQuestion]:
    subspace_id = subspace["id"]
    topic = quiz.get("topic")
    linked_ids, (used, earlier), history, snap = await asyncio.gather(
        rag.linked_subspace_ids(user_id, subspace_id),
        coverage.ledger(user_id, subspace_id),
        recent_history(user_id, subspace_id),
        student_model.snapshot(user_id),
    )
    topic_mastery = next((t.mastery for t in snap.topics if t.subspace_id == subspace_id), None)
    material = await quiz_agent.gather_material(
        user_id=user_id,
        subspace_id=subspace_id,
        source=body.source,
        note_id=body.note_id,
        topic=topic,
        count=count,
        used=used,
        weak_concepts=[c.label for c in snap.concepts_in(subspace_id) if c.is_weak],
        linked_ids=linked_ids,
        conversation=format_history(history),
    )
    # Only now: a source with nothing in it is said for free.
    await consume_llm_quota(user_id, cost=2, daily=True)
    # This quiz's own questions first: they are the ones the writer is shown
    # as "already asked", and the ones every repeat check compares against.
    try:
        draft = await quiz_agent.write_quiz(
            count=count,
            topic=topic,
            label=subspace_label(subspace),
            mix=difficulty_mix(topic_mastery, count),
            sources=material.sources,
            conversation=material.conversation,
            earlier=[*existing, *earlier],
            student_context=personalization.render(snap, "quiz", subspace_id=subspace_id),
            general=material.general,
        )
    except ApiError:
        raise
    except Exception as e:
        log.exception("quiz extension failed")
        raise UpstreamUnavailable("Couldn't write more questions just now.") from e
    log.info("quiz extended subspace=%s from=%s %s", subspace_id, material.kind, draft.trace)
    new = balance_answer_positions(draft.questions)
    if not new:
        raise UpstreamUnavailable(
            "Everything this could write was already in the quiz. Try another source, or start a new quiz."
        )
    return new


@router.post("/quizzes/{quiz_id}/reword", response_model=QuizRewordOut)
async def reword_quiz(
    quiz_id: str, user: CurrentUser = Depends(get_current_user)
) -> QuizRewordOut:
    """The same quiz for a retake, reworded and reshuffled. Nothing is stored:
    the student's answers are mapped back and submitted against this quiz, so
    its best score and the student model stay about the same questions.

    When the rewording can't be had (no model, a failure, a timeout) the
    retake is still reshuffled, and `note` says so — never an error over
    something optional. Running out of quota is the exception: that is said.
    """
    rows = await supabase.db_select(
        "quizzes", filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"}, limit=1
    )
    if not rows:
        raise NotFound("Quiz not found.")
    questions = [QuizQuestion(**q) for q in (rows[0].get("questions") or []) if isinstance(q, dict)]
    if not questions:
        raise ValidationFailed("This quiz has no questions to reword.")
    if not settings.llm_configured:
        out = quiz_agent.shuffled(questions)
        return QuizRewordOut(
            quiz_id=quiz_id, questions=out.questions, note="Rewording needs the AI, so the order is shuffled instead."
        )
    await consume_llm_quota(user.id, cost=1, daily=True)
    try:
        out = await quiz_agent.reword_quiz(questions)
    except Exception as e:  # noqa: BLE001 - a retake without new wording is still a retake
        log.info("reword skipped quiz=%s: %s", quiz_id, str(e)[:120])
        out = quiz_agent.shuffled(questions)
        return QuizRewordOut(
            quiz_id=quiz_id,
            questions=out.questions,
            note="Couldn't reword it just now, so the questions and choices are reshuffled instead.",
        )
    log.info("quiz reworded quiz=%s %s", quiz_id, out.trace)
    note = None
    if out.reworded == 0:
        note = "The wording couldn't be changed safely this time, so it's reshuffled instead."
    elif out.reworded < len(questions):
        note = f"{out.reworded} of {len(questions)} questions are reworded; the rest kept their wording, reshuffled."
    return QuizRewordOut(quiz_id=quiz_id, questions=out.questions, reworded=out.reworded, note=note)


@router.post("/quizzes/{quiz_id}/submit", response_model=QuizResultOut)
async def submit_quiz(
    quiz_id: str,
    body: QuizSubmit,
    user: CurrentUser = Depends(get_current_user),
) -> QuizResultOut:
    # The quiz and the earlier scores are independent reads — gathered so the
    # personal-best comparison costs no extra round trip.
    rows, prior = await asyncio.gather(
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
            limit=1,
        ),
        _attempt_scores(user.id, quiz_id),
    )
    if not rows:
        raise NotFound("Quiz not found.")
    quiz = rows[0]
    questions = quiz["questions"] or []
    if len(body.answers) != len(questions):
        # Pad or truncate to match — we don't want to reject a partial submit outright.
        body.answers = (body.answers + [-1] * len(questions))[: len(questions)]

    correct = [int(a) == int(q.get("answer_index", -1)) for a, q in zip(body.answers, questions, strict=False)]
    score = round(100 * sum(correct) / len(correct)) if correct else 0

    # Read before the insert below, so these are strictly EARLIER attempts.
    earlier = [r["score"] for r in prior.get(quiz_id, []) if r.get("score") is not None]
    previous_best = max(earlier) if earlier else None

    await supabase.db_insert(
        "quiz_results",
        {
            "quiz_id": quiz_id,
            "user_id": user.id,
            "answers": body.answers,
            "score": score,
            "duration_seconds": body.duration_seconds,
        },
    )
    await activity.bump(
        user.id,
        quizzes_taken=1,
        study_seconds=activity.quiz_seconds(body.duration_seconds),
    )
    # A student who only quizzes was otherwise never marking their own topic
    # active — flashcards and notes both do this, quizzes just hadn't caught up.
    if quiz.get("subspace_id"):
        await activity.touch_subspace(quiz["subspace_id"])
    return QuizResultOut(
        score=score,
        correct=correct,
        duration_seconds=body.duration_seconds,
        previous_best=previous_best,
        attempts=len(earlier) + 1,
    )


# ── Helpers ────────────────────────────────────────────────────────────


#: Bound on the score rows read per request. Newest first, so a very long
#: history drops its oldest attempts rather than the recent ones.
_MAX_SCORE_ROWS = 2000


async def _attempt_scores(user_id: str, quiz_id: str | None = None) -> dict[str, list[dict]]:
    """This user's scores grouped by quiz id — one narrow, bounded select.

    Two columns, no answers payload; rides along in the gather with the read
    it decorates, so it adds no latency.
    """
    filters = {"user_id": f"eq.{user_id}"}
    if quiz_id:
        filters["quiz_id"] = f"eq.{quiz_id}"
    rows = await supabase.db_select(
        "quiz_results",
        filters=filters,
        select="quiz_id,score",
        order="submitted_at.desc",
        limit=_MAX_SCORE_ROWS,
    )
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        grouped.setdefault(str(r.get("quiz_id")), []).append(r)
    return grouped


def _to_quiz(row: dict, results: dict[str, list[dict]] | None = None) -> QuizOut:
    scores = [r["score"] for r in (results or {}).get(str(row["id"]), []) if r.get("score") is not None]
    return QuizOut(
        best_score=max(scores) if scores else None,
        attempts=len(scores),
        id=row["id"],
        topic=row.get("topic"),
        questions=[QuizQuestion(**q) for q in (row.get("questions") or [])],
        created_at=row["created_at"],
    )


def _stub_questions(topic: str | None, count: int) -> list[QuizQuestion]:
    t = topic or "this material"
    return [
        QuizQuestion(
            q=f"Placeholder question {i + 1}: choose any option to try the flow ({t}).",
            choices=["Option A", "Option B", "Option C", "Option D"],
            answer_index=0,
            explanation="This is a placeholder — the AI isn't configured yet, so no real explanation exists.",
        )
        for i in range(count)
    ]
