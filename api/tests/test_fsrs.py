"""FSRS-5 scheduling, and the Python/TypeScript agreement it depends on.

`docs/REQUEST_PIPELINE.md` documents the duplication deliberately: the review
screen grades optimistically, advancing the card and computing the next
interval locally while the PATCH flies behind it. That only works while the
two implementations agree exactly — the moment they diverge, every graded
card briefly shows a number the server is about to overwrite.

`api/app/services/fsrs.py` (called from `flashcards.py::grade_card`) is the
authority. `web/src/lib/schedule.ts` is the mirror.

The branch tests below check against formulas re-derived independently in
this file (not imported from `fsrs.py`), so a bug shared by both the
implementation and its own docstring would still be caught.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.routers.flashcards import grade_card
from app.schemas import GradeIn

from .conftest import OWNER

CARD_ID = "dddddddd-0000-0000-0000-000000000002"
PARITY_SCRIPT = Path(__file__).parent / "fsrs_parity.mjs"

# ── Ground truth, re-derived from the spec independently of app/services/fsrs.py ──

W = (
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621,
)
DECAY = -0.5
FACTOR = 19 / 81
GRADE_NUM = {"again": 1, "hard": 2, "good": 3, "easy": 4}


def expected_retrievability(t: float, s: float) -> float:
    return (1 + FACTOR * t / s) ** DECAY


def expected_interval(s: float) -> int:
    raw = s / FACTOR * (0.9 ** (1 / DECAY) - 1)
    return min(36500, max(1, round(raw)))


def expected_init_stability(g: int) -> float:
    return W[g - 1]


def expected_init_difficulty(g: int) -> float:
    return min(10.0, max(1.0, W[4] - math.exp(W[5] * (g - 1)) + 1))


def expected_next_difficulty(d: float, g: int) -> float:
    damped = d - W[6] * (g - 3) * (10 - d) / 9
    reverted = W[7] * expected_init_difficulty(4) + (1 - W[7]) * damped
    return min(10.0, max(1.0, reverted))


def expected_next_stability(d: float, s: float, r: float, g: int, elapsed: float) -> float:
    if elapsed < 1:
        return s * math.exp(W[17] * (g - 3 + W[18]))
    if g == 1:
        return min(s, W[11] * d ** (-W[12]) * ((s + 1) ** W[13] - 1) * math.exp(W[14] * (1 - r)))
    bonus = (W[15] if g == 2 else 1.0) * (W[16] if g == 4 else 1.0)
    gain = math.exp(W[8]) * (11 - d) * s ** (-W[9]) * (math.exp(W[10] * (1 - r)) - 1) * bonus
    return s * (1 + gain)


@pytest.fixture(autouse=True)
def _no_activity_writes(monkeypatch: pytest.MonkeyPatch):
    """`grade_card` also bumps daily activity; that's not what's under test."""
    from app.services import activity

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(activity, "bump", _noop)


async def apply_grade(
    db,
    grade: str,
    *,
    stability: float | None = None,
    difficulty: float | None = None,
    last_review_at: str | None = None,
    reps: int = 0,
    lapses: int = 0,
) -> dict:
    """Run the real handler and return the patch it wrote to `flashcards`."""
    db.seed(
        "flashcards",
        [
            {
                "id": CARD_ID,
                "user_id": OWNER,
                "deck_id": "deck-1",
                "front": "q",
                "back": "a",
                "ease": 2.5,
                "interval_days": 0,
                "reps": reps,
                "lapses": lapses,
                "stability": stability,
                "difficulty": difficulty,
                "last_review_at": last_review_at,
            }
        ],
    )

    class _User:
        id = OWNER

    await grade_card(CARD_ID, GradeIn(grade=grade), user=_User())
    return db.updates[-1]["patch"]


def last_card_review(db) -> dict:
    return next(x for x in reversed(db.inserts) if x["table"] == "card_reviews")["rows"][0]


# ── A never-reviewed card ────────────────────────────────────────────────


async def test_first_review_sets_initial_state_from_the_weights(db):
    for grade in ("again", "hard", "good", "easy"):
        g = GRADE_NUM[grade]
        patch = await apply_grade(db, grade)
        assert patch["stability"] == pytest.approx(expected_init_stability(g))
        assert patch["difficulty"] == pytest.approx(expected_init_difficulty(g))


async def test_first_review_logs_full_retrievability(db):
    """Nothing has been forgotten yet — there's nothing to forget."""
    await apply_grade(db, "good")
    assert last_card_review(db)["retrievability"] == pytest.approx(1.0)


async def test_first_review_resets_reps_and_lapses_appropriately(db):
    patch = await apply_grade(db, "good", reps=0, lapses=0)
    assert patch["reps"] == 1
    patch = await apply_grade(db, "again", reps=0, lapses=0)
    assert patch["reps"] == 0
    assert patch["lapses"] == 1


# ── A reviewed card ──────────────────────────────────────────────────────


async def test_success_grows_stability_using_elapsed_time_and_retrievability(db):
    now = datetime.now(UTC)
    elapsed = 12
    last_review_at = (now - timedelta(days=elapsed, minutes=5)).isoformat()
    patch = await apply_grade(
        db, "good", stability=20.0, difficulty=5.0, last_review_at=last_review_at, reps=3
    )
    r = expected_retrievability(elapsed, 20.0)
    expected_s = expected_next_stability(5.0, 20.0, r, GRADE_NUM["good"], elapsed)
    assert patch["stability"] == pytest.approx(expected_s, rel=1e-6)
    assert patch["difficulty"] == pytest.approx(expected_next_difficulty(5.0, GRADE_NUM["good"]))
    assert patch["reps"] == 4


async def test_again_never_grows_stability_past_its_current_value(db):
    """The lapse formula is clamped with `min(S, ...)` — forgetting a card
    must never leave it more durable than it was."""
    now = datetime.now(UTC)
    last_review_at = (now - timedelta(days=30, minutes=5)).isoformat()
    patch = await apply_grade(db, "again", stability=15.0, difficulty=6.0, last_review_at=last_review_at)
    assert patch["stability"] <= 15.0
    assert patch["reps"] == 0
    assert patch["lapses"] == 1


async def test_same_day_review_uses_the_exponential_formula_not_the_lapse_split(db):
    """Elapsed < 1 day overrides the lapse/success branch entirely, even on
    `again` — a same-day re-grade is not treated as forgetting."""
    now = datetime.now(UTC)
    last_review_at = (now - timedelta(minutes=10)).isoformat()
    for grade in ("again", "hard", "good", "easy"):
        g = GRADE_NUM[grade]
        patch = await apply_grade(
            db, grade, stability=10.0, difficulty=5.0, last_review_at=last_review_at
        )
        expected_s = 10.0 * math.exp(W[17] * (g - 3 + W[18]))
        assert patch["stability"] == pytest.approx(expected_s, rel=1e-6)


async def test_interval_matches_the_desired_retention_formula(db):
    now = datetime.now(UTC)
    last_review_at = (now - timedelta(days=8, minutes=5)).isoformat()
    patch = await apply_grade(db, "good", stability=9.0, difficulty=4.0, last_review_at=last_review_at)
    assert patch["interval_days"] == expected_interval(patch["stability"])


async def test_difficulty_always_stays_within_one_and_ten(db):
    now = datetime.now(UTC)
    last_review_at = (now - timedelta(days=3, minutes=5)).isoformat()
    for grade in ("again", "hard", "good", "easy"):
        for difficulty in (1.0, 5.0, 10.0):
            patch = await apply_grade(
                db, grade, stability=5.0, difficulty=difficulty, last_review_at=last_review_at
            )
            assert 1.0 <= patch["difficulty"] <= 10.0


async def test_grade_card_logs_a_card_review_row(db):
    now = datetime.now(UTC)
    last_review_at = (now - timedelta(days=4, minutes=5)).isoformat()
    patch = await apply_grade(db, "hard", stability=6.0, difficulty=5.0, last_review_at=last_review_at)
    row = last_card_review(db)
    assert row["grade"] == GRADE_NUM["hard"]
    assert row["elapsed_days"] == 4
    assert row["stability_after"] == pytest.approx(patch["stability"])
    assert 0 <= row["retrievability"] <= 1


async def test_grade_always_sets_a_future_due_date(db):
    patch = await apply_grade(db, "good")
    assert "due_at" in patch and patch["due_at"]


async def test_grade_touches_the_cards_subspace(db):
    db.seed("decks", [{"id": "deck-1", "subspace_id": "sub-1"}])
    await apply_grade(db, "good")
    touched = [u for u in db.updates if u["table"] == "subspaces"]
    assert touched, "reviewing a card should mark its topic active"
    assert touched[-1]["filters"] == {"id": "eq.sub-1"}


# ── Python ⇄ TypeScript parity ─────────────────────────────────────────

PARITY_CASES = [
    {"stability": s, "difficulty": d, "elapsed_days": e, "grade": g}
    for s in (0.4, 1.0, 5.0, 20.0, 100.0)
    for d in (1.0, 2.5, 5.0, 8.0, 10.0)
    for e in (0, 1, 3, 10, 60)
    for g in ("again", "hard", "good", "easy")
] + [
    {"stability": None, "difficulty": None, "elapsed_days": None, "grade": g}
    for g in ("again", "hard", "good", "easy")
]


async def test_python_and_typescript_schedulers_agree(db, tmp_path):
    """Execute both implementations over the same grid and compare.

    Deliberately runs the real `schedule.ts` rather than a Python
    transcription of it — a transcription could agree with the server while
    the shipped TypeScript disagreed, which is precisely the bug this guards.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available — cannot verify frontend parity")

    payload = tmp_path / "cases.json"
    payload.write_text(json.dumps(PARITY_CASES), encoding="utf-8")

    proc = subprocess.run(
        [node, str(PARITY_SCRIPT), str(payload)],
        capture_output=True,
        text=True,
        cwd=PARITY_SCRIPT.parent,
    )
    if proc.returncode != 0:
        if "ERR_UNKNOWN_FILE_EXTENSION" in proc.stderr or "strip-types" in proc.stderr:
            pytest.skip(f"node cannot load TypeScript directly (needs ≥22): {proc.stderr[:200]}")
        pytest.fail(f"parity script failed:\n{proc.stderr[:2000]}")

    ts_results = json.loads(proc.stdout)
    assert len(ts_results) == len(PARITY_CASES)

    mismatches: list[str] = []
    for case, ts in zip(PARITY_CASES, ts_results, strict=True):
        now = datetime.now(UTC)
        last_review_at = (
            None
            if case["stability"] is None
            else (now - timedelta(days=case["elapsed_days"], minutes=5)).isoformat()
        )
        patch = await apply_grade(
            db,
            case["grade"],
            stability=case["stability"],
            difficulty=case["difficulty"],
            last_review_at=last_review_at,
        )
        review_row = last_card_review(db)
        py = {
            "stability": patch["stability"],
            "difficulty": patch["difficulty"],
            "interval_days": patch["interval_days"],
            "retrievability": review_row["retrievability"],
        }
        same = (
            math.isclose(py["stability"], ts["stability"], rel_tol=1e-6, abs_tol=1e-6)
            and math.isclose(py["difficulty"], ts["difficulty"], rel_tol=1e-6, abs_tol=1e-6)
            and py["interval_days"] == ts["interval_days"]
            and math.isclose(py["retrievability"], ts["retrievability"], rel_tol=1e-6, abs_tol=1e-6)
        )
        if not same:
            mismatches.append(f"  {case} → python={py} ts={ts}")

    assert not mismatches, (
        "The server and the optimistic client scheduler disagree. Every graded "
        "card would flash the wrong next-review interval before the PATCH "
        "corrects it. Fix both `services/fsrs.py` and `web/src/lib/schedule.ts` "
        "together:\n" + "\n".join(mismatches[:15])
    )
