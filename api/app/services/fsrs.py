"""FSRS-5 scheduler — the spaced-repetition algorithm behind flashcard grading.

Day granularity, no learning steps, no fuzz, desired retention 0.9. Weights
and formulas checked against the open-spaced-repetition wiki's "The
Algorithm" page (FSRS-5 section, plus the same-day/lapse/success stability
formulas it carries over from FSRS-4.5) — no discrepancies found. One thing
worth knowing from that check: at retention 0.9, `next_interval_days`
collapses to `round(stability)` exactly (the wiki notes `I(r, S) = S` when
`r = 0.9`) — the general formula is kept below anyway, since desired
retention is a named constant here, not hardcoded into the shape of the math.

Mirrored line-for-line in `web/src/lib/schedule.ts`, which the review screen
uses to preview a grade's next interval before the PATCH lands. The parity
test in `api/tests/test_fsrs.py` + `fsrs_parity.mjs` runs both over the same
grid to catch drift.

`api/app/routers/flashcards.py::grade_card` is the authority; this module is
the pure math it calls.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..schemas import Grade

#: FSRS-5 default weights, w[0]..w[18].
W: tuple[float, ...] = (
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621,
)

DECAY = -0.5
FACTOR = 19 / 81  # chosen so R(t=S, S) = 0.9
DESIRED_RETENTION = 0.9

MIN_DIFFICULTY = 1.0
MAX_DIFFICULTY = 10.0
MIN_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 36500

#: Grades 1=again 2=hard 3=good 4=easy — exposed for callers that need to
#: store the numeric grade too (`card_reviews.grade`).
GRADE_NUMBER: dict[Grade, int] = {"again": 1, "hard": 2, "good": 3, "easy": 4}


@dataclass(frozen=True)
class ReviewResult:
    stability: float
    difficulty: float
    #: Retrievability *before* this review — 1.0 for a card's first grade,
    #: since there is nothing yet to have forgotten.
    retrievability: float
    interval_days: int


def _clamp_difficulty(d: float) -> float:
    return min(MAX_DIFFICULTY, max(MIN_DIFFICULTY, d))


def retrievability(elapsed_days: float, stability: float) -> float:
    """R(t, S) = (1 + FACTOR*t/S)^DECAY — probability of recall right now."""
    return (1 + FACTOR * elapsed_days / stability) ** DECAY


def next_interval_days(stability: float) -> int:
    """Days until R decays to DESIRED_RETENTION, clamped to [1, 36500]."""
    raw = stability / FACTOR * (DESIRED_RETENTION ** (1 / DECAY) - 1)
    return min(MAX_INTERVAL_DAYS, max(MIN_INTERVAL_DAYS, round(raw)))


def _initial_stability(grade: int) -> float:
    """S0(G) = w[G-1] — a never-reviewed card's stability after its first grade."""
    return W[grade - 1]


def _initial_difficulty(grade: int) -> float:
    """D0(G) = w4 - exp(w5*(G-1)) + 1, clamped to [1, 10]."""
    return _clamp_difficulty(W[4] - math.exp(W[5] * (grade - 1)) + 1)


def _next_difficulty(difficulty: float, grade: int) -> float:
    """Linear damping toward the rated grade, then mean reversion to D0(easy)
    (FSRS-5's target — earlier versions reverted to D0(good) instead)."""
    damped = difficulty - W[6] * (grade - 3) * (10 - difficulty) / 9
    reverted = W[7] * _initial_difficulty(4) + (1 - W[7]) * damped
    return _clamp_difficulty(reverted)


def _next_stability(
    *, difficulty: float, stability: float, r: float, grade: int, elapsed_days: float
) -> float:
    """S' after a review. Same-day review is its own formula — checked first,
    it overrides the lapse/success split below regardless of grade."""
    if elapsed_days < 1:
        return stability * math.exp(W[17] * (grade - 3 + W[18]))
    if grade == 1:  # lapse
        return min(
            stability,
            W[11]
            * difficulty ** (-W[12])
            * ((stability + 1) ** W[13] - 1)
            * math.exp(W[14] * (1 - r)),
        )
    # success (hard/good/easy)
    bonus = (W[15] if grade == 2 else 1.0) * (W[16] if grade == 4 else 1.0)
    gain = (
        math.exp(W[8])
        * (11 - difficulty)
        * stability ** (-W[9])
        * (math.exp(W[10] * (1 - r)) - 1)
        * bonus
    )
    return stability * (1 + gain)


def review(
    *,
    stability: float | None,
    difficulty: float | None,
    elapsed_days: float | None,
    grade: Grade,
) -> ReviewResult:
    """Grade a card. `stability`/`difficulty`/`elapsed_days` are `None` for a
    card that has never been reviewed — its first grade only sets up initial
    state, there is nothing yet to reinforce or forget.
    """
    g = GRADE_NUMBER[grade]
    if stability is None or difficulty is None or elapsed_days is None:
        r = 1.0
        new_s = _initial_stability(g)
        new_d = _initial_difficulty(g)
    else:
        r = retrievability(elapsed_days, stability)
        new_s = _next_stability(
            difficulty=difficulty, stability=stability, r=r, grade=g, elapsed_days=elapsed_days
        )
        new_d = _next_difficulty(difficulty, g)
    return ReviewResult(
        stability=new_s,
        difficulty=new_d,
        retrievability=r,
        interval_days=next_interval_days(new_s),
    )
