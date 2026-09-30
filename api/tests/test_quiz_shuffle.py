"""The correct answer must not always be first, and shuffling must never
change what a question means."""

from __future__ import annotations

import random
from collections import Counter

from app.schemas import QuizQuestion
from app.services.quiz_shuffle import balance_answer_positions


def _q(i: int, *, mis: bool = True, choices: list[str] | None = None) -> QuizQuestion:
    choices = choices or [f"right-{i}", f"wrong-a-{i}", f"wrong-b-{i}", f"wrong-c-{i}"]
    return QuizQuestion(
        q=f"Q{i}",
        choices=choices,
        answer_index=0,
        misconceptions=[None, "m-a", "m-b", "m-c"] if mis else None,
    )


def test_the_correct_answer_is_no_longer_always_first():
    qs = balance_answer_positions([_q(i) for i in range(8)], random.Random(1))
    positions = Counter(q.answer_index for q in qs)
    assert len(positions) == 4          # every letter is used
    assert max(positions.values()) == 2  # 8 questions -> exactly 2 per letter


def test_five_questions_use_every_letter_at_least_once():
    for seed in range(20):
        qs = balance_answer_positions([_q(i) for i in range(5)], random.Random(seed))
        assert set(q.answer_index for q in qs) == {0, 1, 2, 3}


def test_the_right_answer_stays_right_and_choices_are_preserved():
    for seed in range(20):
        for q in balance_answer_positions([_q(i) for i in range(6)], random.Random(seed)):
            i = int(q.q[1:])
            assert q.choices[q.answer_index] == f"right-{i}"
            assert sorted(q.choices) == sorted(
                [f"right-{i}", f"wrong-a-{i}", f"wrong-b-{i}", f"wrong-c-{i}"]
            )


def test_misconceptions_travel_with_their_choice():
    mapping = {"wrong-a": "m-a", "wrong-b": "m-b", "wrong-c": "m-c"}
    for q in balance_answer_positions([_q(i) for i in range(6)], random.Random(3)):
        assert q.misconceptions[q.answer_index] is None
        for choice, m in zip(q.choices, q.misconceptions, strict=True):
            if not choice.startswith("right"):
                assert m == mapping[choice.rsplit("-", 1)[0]]


def test_order_dependent_questions_are_left_alone():
    q = _q(0, choices=["Red", "Blue", "Green", "All of the above"])
    out = balance_answer_positions([q, _q(1), _q(2)], random.Random(0))
    assert out[0].choices == q.choices and out[0].answer_index == 0


def test_bad_or_short_input_is_untouched():
    bad = QuizQuestion(q="Q", choices=["only"], answer_index=0)
    assert balance_answer_positions([bad], random.Random(0)) == [bad]
    assert balance_answer_positions([], random.Random(0)) == []
