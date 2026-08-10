"""Quizzes: list past, generate a new one (LLM), and submit answers for scoring."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, NothingIndexed, UpstreamUnavailable
from ..guards import assert_subspace, subspace_label
from ..schemas import QuizGenerate, QuizOut, QuizQuestion, QuizResultOut, QuizSubmit
from ..services import activity, personalization, rag, supabase
from ..services.chat_context import format_history, recent_history
from ..services.llm import get_llm, loads_lenient
from ..services.ratelimit import consume_llm_quota
from ..services.voice import QUIZ_AGENT_VOICE

log = logging.getLogger("space_learn.quiz")
router = APIRouter()


@router.get("/subspaces/{subspace_id}/quizzes", response_model=list[QuizOut])
async def list_quizzes(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[QuizOut]:
    # Guard and read run together — see the note in notes.list_notes for why
    # that's safe (the read is already user-scoped) and what it saves.
    _, rows = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="created_at.desc",
        ),
    )
    return [_to_quiz(r) for r in rows]


@router.get("/quizzes/{quiz_id}", response_model=QuizOut)
async def get_quiz(
    quiz_id: str, user: CurrentUser = Depends(get_current_user)
) -> QuizOut:
    rows = await supabase.db_select(
        "quizzes",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Quiz not found.")
    return _to_quiz(rows[0])


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
    # Must come first: rag.retrieve() runs under the service-role key, so an
    # unvalidated subspace_id would read another user's document chunks.
    subspace = await assert_subspace(user.id, subspace_id)
    await consume_llm_quota(user.id, cost=2)  # generation is pricier than a chat turn

    # Three independent reads, gathered. Retrieval, history and the student
    # model share no inputs, so running them in sequence spent three round
    # trips to a remote Postgres before the (much slower) model call even
    # started — pure latency the student waits through.
    retrieved, history, student_context = await asyncio.gather(
        rag.retrieve(subspace_id, body.topic or "core concepts", k=6),
        recent_history(user.id, subspace_id),
        personalization.build(user.id, "quiz", subspace_id=subspace_id),
    )
    # A conversation IS the student's material. This used to require indexed
    # documents specifically, which blocked the most natural case in the
    # product: talk through a topic in chat, then ask to be tested on it.
    # The inconsistency was visible in this very function — `history` was
    # already loaded and already passed to the model below, so the code
    # treated chat as usable material while the gate above it did not.
    # `notes.py` had it right; flashcards and quizzes did not.
    if not retrieved and not history and settings.llm_configured:
        raise NothingIndexed()
    context = "\n\n".join(f"- {r.content}" for r in retrieved) or "(no indexed material yet)"
    label = subspace_label(subspace)
    recent = format_history(history) or "(no prior chat in this space)"
    prompt = (
        f"Write {body.count} multiple-choice questions about "
        f"'{body.topic or 'the key concepts in this material'}', within the "
        f"subject '{label}' — resolve any ambiguity in the topic name using "
        f"that subject, not a generic reading of the words. "
        "Use ONLY the material and conversation below — both are the "
        "student's own, and when there are no indexed documents the "
        "conversation is the whole of it. Do not draw on outside knowledge; "
        "if neither source covers something, leave it out.\n\n"
        f"Indexed material:\n{context}\n\n"
        f"Recent conversation in this space:\n{recent}\n\n"
        "Return a JSON array; each item has fields: "
        '{"q": str, "choices": [str, str, str, str], "answer_index": 0-3, '
        '"source": str, "subtopic": str, "explanation": str}. subtopic is the '
        "specific concept this question tests, narrower than the overall topic "
        "(e.g. 'Policy Iteration', not 'Reinforcement Learning'). "
        # Shown the instant the student answers, so it has to teach rather than
        # justify — naming why the tempting wrong choice is tempting is what
        # turns a wrong answer into the most useful moment in the quiz.
        "explanation is 1-2 sentences saying WHY the correct answer is correct "
        "and, where there is an obvious trap, why the most tempting wrong "
        "choice is wrong. Write it to the student, in second person. "
        "Return only the JSON array — no prose, no code fences."
    )

    if not settings.llm_configured:
        # No key yet — hand back a placeholder set so the take/submit flow is
        # still clickable. This is the ONLY path that may fabricate questions.
        questions = _stub_questions(body.topic, body.count)
    else:
        try:
            raw_parts: list[str] = []
            async for delta in get_llm().stream_chat(
                [
                    {
                        "role": "system",
                        "content": QUIZ_AGENT_VOICE
                        + (f"\n\n{student_context}" if student_context else ""),
                    },
                    {"role": "user", "content": prompt},
                ],
                model=settings.groq_model,
                temperature=0.3,
            ):
                raw_parts.append(delta)
            questions = _safe_parse_questions("".join(raw_parts).strip(), want=body.count)
        except ApiError:
            # Already a friendly, typed error (rate limit, upstream down) — let
            # it surface so the user knows to retry rather than being handed
            # silent placeholder questions and told they're real.
            raise
        except Exception as e:
            log.exception("quiz generation failed")
            raise UpstreamUnavailable("Couldn't generate a quiz just now.") from e

        if not questions:
            raise UpstreamUnavailable(
                "The quiz came back in an unexpected format. Try again."
            )

    inserted = await supabase.db_insert(
        "quizzes",
        {
            "user_id": user.id,
            "subspace_id": subspace_id,
            "topic": body.topic,
            "questions": [q.model_dump() for q in questions],
        },
    )
    return _to_quiz(inserted[0])


@router.post("/quizzes/{quiz_id}/submit", response_model=QuizResultOut)
async def submit_quiz(
    quiz_id: str,
    body: QuizSubmit,
    user: CurrentUser = Depends(get_current_user),
) -> QuizResultOut:
    rows = await supabase.db_select(
        "quizzes",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{quiz_id}"},
        limit=1,
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
    await activity.bump(user.id, quizzes_taken=1, study_seconds=activity.SECONDS_PER_QUIZ)
    return QuizResultOut(
        score=score, correct=correct, duration_seconds=body.duration_seconds
    )


# ── Helpers ────────────────────────────────────────────────────────────


def _to_quiz(row: dict) -> QuizOut:
    return QuizOut(
        id=row["id"],
        topic=row.get("topic"),
        questions=[QuizQuestion(**q) for q in (row.get("questions") or [])],
        created_at=row["created_at"],
    )


def _safe_parse_questions(raw: str, *, want: int) -> list[QuizQuestion]:
    # Tolerate stray text around the JSON.
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        data = loads_lenient(raw[start : end + 1])
    except json.JSONDecodeError:
        return []
    out: list[QuizQuestion] = []
    for item in data[:want]:
        try:
            out.append(QuizQuestion(**item))
        except Exception:
            continue
    return out


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
