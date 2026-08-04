"""Quizzes: list past, generate a new one (LLM), and submit answers for scoring."""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound, UpstreamUnavailable
from ..schemas import QuizGenerate, QuizOut, QuizQuestion, QuizResultOut, QuizSubmit
from ..services import rag, supabase
from ..services.llm import get_llm

log = logging.getLogger("space_learn.quiz")
router = APIRouter()


@router.get("/subspaces/{subspace_id}/quizzes", response_model=list[QuizOut])
async def list_quizzes(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[QuizOut]:
    rows = await supabase.db_select(
        "quizzes",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
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
    retrieved = await rag.retrieve(subspace_id, body.topic or "core concepts", k=6)
    context = "\n\n".join(f"- {r.content}" for r in retrieved) or "(no indexed material yet)"

    prompt = (
        f"Write {body.count} multiple-choice questions about "
        f"'{body.topic or 'the key concepts in this material'}'. "
        "Use ONLY this material:\n\n"
        f"{context}\n\n"
        "Return a JSON array; each item has fields: "
        '{"q": str, "choices": [str, str, str, str], "answer_index": 0-3, "source": str}. '
        "Return only the JSON array — no prose, no code fences."
    )

    try:
        raw_parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {"role": "system", "content": "You write concise, unambiguous MCQ quiz questions."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        ):
            raw_parts.append(delta)
        raw = "".join(raw_parts).strip()
        questions = _safe_parse_questions(raw, want=body.count)
    except Exception:
        log.exception("quiz generation failed")
        # Fall through to a stub quiz so the UI is still exercisable.
        questions = _stub_questions(body.topic, body.count)

    if not questions:
        raise UpstreamUnavailable("Quiz generation returned nothing usable.")

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

    correct = [int(a) == int(q.get("answer_index", -1)) for a, q in zip(body.answers, questions)]
    score = round(100 * sum(correct) / len(correct)) if correct else 0

    await supabase.db_insert(
        "quiz_results",
        {
            "quiz_id": quiz_id,
            "user_id": user.id,
            "answers": body.answers,
            "score": score,
        },
    )
    await _bump_quiz_activity(user.id)
    return QuizResultOut(score=score, correct=correct)


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
        data = json.loads(raw[start : end + 1])
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
        )
        for i in range(count)
    ]


async def _bump_quiz_activity(user_id: str) -> None:
    today = date.today().isoformat()
    existing = await supabase.db_select(
        "daily_activity",
        filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
        limit=1,
    )
    now = datetime.now(UTC).isoformat()
    _ = now
    if existing:
        await supabase.db_update(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
            patch={
                "quizzes_taken": int(existing[0].get("quizzes_taken", 0)) + 1,
                "study_seconds": int(existing[0].get("study_seconds", 0)) + 180,
            },
        )
    else:
        await supabase.db_insert(
            "daily_activity",
            {
                "user_id": user_id,
                "day": today,
                "quizzes_taken": 1,
                "study_seconds": 180,
            },
        )
