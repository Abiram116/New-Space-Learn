"""Even out where the correct answer sits in a generated quiz.

Language models put the right answer first far more often than chance — a
quiz whose answer is always "A" teaches the student to skip reading. Asking
the model to vary it is unreliable, so the server does it after parsing:
the correct positions across a quiz are a shuffled, as-even-as-possible
spread of A–D (5 questions → each letter once, plus one extra at random),
and each question's other choices are shuffled around it.

`misconceptions` is one entry per choice in the same order, so it moves with
its choice. A question is left alone when its wording depends on choice
order ("all of the above", "both A and B", …) — shuffling those would make
the question wrong, not merely different.
"""

from __future__ import annotations

import random
import re
from collections.abc import Sequence

from ..schemas import QuizQuestion

_ORDER_DEPENDENT = re.compile(
    r"\b(all|none|neither|both)\s+of\s+the\s+(above|these|following)\b"
    r"|\b(a|b|c|d)\s+(and|&|or)\s+(a|b|c|d)\b"
    r"|\b(option|choice)s?\s+[a-d1-4]\b",
    re.IGNORECASE,
)


def _movable(q: QuizQuestion) -> bool:
    n = len(q.choices)
    if n < 2 or not 0 <= q.answer_index < n:
        return False
    return not any(_ORDER_DEPENDENT.search(c) for c in q.choices)


def _target_positions(count: int, width: int, rng: random.Random) -> list[int]:
    """`count` slots spread over `width` positions as evenly as possible, shuffled."""
    slots = [i % width for i in range(count)]
    rng.shuffle(slots)
    return slots


def balance_answer_positions(
    questions: Sequence[QuizQuestion], rng: random.Random | None = None
) -> list[QuizQuestion]:
    """Return the questions with correct answers spread across positions."""
    rng = rng or random.Random()
    out = list(questions)
    movable = [i for i, q in enumerate(out) if _movable(q)]
    if not movable:
        return out

    width = min(len(out[i].choices) for i in movable)
    targets = _target_positions(len(movable), width, rng)

    for idx, target in zip(movable, targets, strict=True):
        q = out[idx]
        n = len(q.choices)
        order = [j for j in range(n) if j != q.answer_index]
        rng.shuffle(order)
        order.insert(min(target, n - 1), q.answer_index)  # new position -> old index

        mis = q.misconceptions
        out[idx] = q.model_copy(
            update={
                "choices": [q.choices[j] for j in order],
                "answer_index": order.index(q.answer_index),
                "misconceptions": (
                    [mis[j] for j in order] if mis is not None and len(mis) == n else mis
                ),
            }
        )
    return out
