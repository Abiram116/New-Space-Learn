"""`POST /quizzes/{id}/submit` reports the per-quiz personal-best facts.

The client decides whether to celebrate from `previous_best` / `attempts`
alone, so these pin the numbers it is handed: a first attempt has no
`previous_best`, and a later one sees the max over EARLIER attempts only
(never itself). The list/detail responses carry the same aggregate.
"""

from __future__ import annotations

from app.deps import CurrentUser
from app.routers import quizzes as quizzes_router
from app.schemas import QuizSubmit

from .conftest import INTRUDER, OWNER

QUIZ = "cccccccc-0000-0000-0000-0000000000c1"
OTHER_QUIZ = "cccccccc-0000-0000-0000-0000000000c2"


def _owner() -> CurrentUser:
    return CurrentUser(id=OWNER, email=None)


def _quiz(quiz_id: str = QUIZ) -> dict:
    return {
        "id": quiz_id,
        "user_id": OWNER,
        "subspace_id": None,
        "topic": "Attention",
        "created_at": "2026-09-01T00:00:00+00:00",
        # Five questions, so a score is 20 points per correct answer.
        "questions": [
            {"q": f"Q{i}", "choices": ["a", "b", "c", "d"], "answer_index": 0}
            for i in range(5)
        ],
    }


def _result(score: int, quiz_id: str = QUIZ, user: str = OWNER) -> dict:
    return {"quiz_id": quiz_id, "user_id": user, "score": score}


def _answers(n_right: int) -> QuizSubmit:
    return QuizSubmit(answers=[0] * n_right + [1] * (5 - n_right))


async def _submit(db, n_right: int, quiz_id: str = QUIZ):
    out = await quizzes_router.submit_quiz(quiz_id, _answers(n_right), _owner())
    # The fake does not persist inserts; do it, so the next attempt sees this one.
    db.rows.setdefault("quiz_results", []).append(_result(out.score, quiz_id))
    return out


async def test_first_attempt_has_no_previous_best(db):
    db.seed("quizzes", [_quiz()])
    out = await _submit(db, 4)
    assert out.score == 80
    assert out.previous_best is None
    assert out.attempts == 1


async def test_lower_equal_and_higher_attempts(db):
    db.seed("quizzes", [_quiz()])
    first = await _submit(db, 4)  # 80
    lower = await _submit(db, 3)  # 60
    equal = await _submit(db, 4)  # 80
    higher = await _submit(db, 5)  # 100

    assert (first.previous_best, first.attempts) == (None, 1)
    assert (lower.score, lower.previous_best, lower.attempts) == (60, 80, 2)
    assert (equal.score, equal.previous_best, equal.attempts) == (80, 80, 3)
    assert (higher.score, higher.previous_best, higher.attempts) == (100, 80, 4)


async def test_a_zero_score_earlier_attempt_still_counts_as_an_attempt(db):
    """`previous_best == 0` is a real value, not "no attempts"."""
    db.seed("quizzes", [_quiz()])
    zero = await _submit(db, 0)
    better = await _submit(db, 1)
    assert zero.previous_best is None
    assert (better.previous_best, better.attempts) == (0, 2)


async def test_best_is_per_quiz_and_per_user(db):
    db.seed("quizzes", [_quiz(), _quiz(OTHER_QUIZ)])
    db.seed(
        "quiz_results",
        [
            _result(100, OTHER_QUIZ),  # a different quiz of the same user
            _result(100, QUIZ, INTRUDER),  # someone else's attempt at this one
        ],
    )
    out = await _submit(db, 2)
    assert out.previous_best is None
    assert out.attempts == 1


async def test_submit_reads_prior_scores_in_one_bounded_select(db):
    db.seed("quizzes", [_quiz()])
    db.seed("quiz_results", [_result(60)])
    await quizzes_router.submit_quiz(QUIZ, _answers(4), _owner())
    reads = [s for s in db.selects if s["table"] == "quiz_results"]
    assert len(reads) == 1
    assert reads[0]["select"] == "quiz_id,score"


async def test_detail_and_list_carry_best_and_attempts(db):
    db.seed("quizzes", [_quiz(), _quiz(OTHER_QUIZ)])
    db.seed("quiz_results", [_result(60), _result(80), _result(40), _result(20, OTHER_QUIZ)])

    detail = await quizzes_router.get_quiz(QUIZ, _owner())
    assert (detail.best_score, detail.attempts) == (80, 3)

    listed = {q.id: q for q in await quizzes_router.list_all_quizzes(_owner())}
    assert (listed[QUIZ].best_score, listed[QUIZ].attempts) == (80, 3)
    assert (listed[OTHER_QUIZ].best_score, listed[OTHER_QUIZ].attempts) == (20, 1)


async def test_never_attempted_quiz_has_no_best(db):
    db.seed("quizzes", [_quiz()])
    detail = await quizzes_router.get_quiz(QUIZ, _owner())
    assert (detail.best_score, detail.attempts) == (None, 0)
