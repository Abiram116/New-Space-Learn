"""SM-2 lite scheduling, and the Python/TypeScript agreement it depends on.

`docs/REQUEST_PIPELINE.md` documents the duplication deliberately: the review
screen grades optimistically, advancing the card and computing the next
interval locally while the PATCH flies behind it. That only works while the
two implementations agree exactly — the moment they diverge, every graded card
briefly shows a number the server is about to overwrite.

`api/app/routers/flashcards.py::grade_card` is the authority.
`web/src/lib/schedule.ts` is the mirror.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.routers.flashcards import grade_card
from app.schemas import GradeIn

from .conftest import OWNER

CARD_ID = "dddddddd-0000-0000-0000-000000000001"
PARITY_SCRIPT = Path(__file__).parent / "sm2_parity.mjs"


@pytest.fixture(autouse=True)
def _no_activity_writes(monkeypatch: pytest.MonkeyPatch):
    """`grade_card` also bumps daily activity; that's not what's under test."""
    from app.services import activity

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(activity, "bump", _noop)


async def apply_grade(db, grade: str, *, ease=2.5, interval_days=0, reps=0) -> dict:
    """Run the real handler and return the patch it wrote."""
    db.seed(
        "flashcards",
        [
            {
                "id": CARD_ID,
                "user_id": OWNER,
                "deck_id": "deck-1",
                "front": "q",
                "back": "a",
                "ease": ease,
                "interval_days": interval_days,
                "reps": reps,
            }
        ],
    )

    class _User:
        id = OWNER

    await grade_card(CARD_ID, GradeIn(grade=grade), user=_User())
    return db.updates[-1]["patch"]


# ── The four branches ──────────────────────────────────────────────────


async def test_again_resets_reps_and_drops_ease(db):
    patch = await apply_grade(db, "again", ease=2.5, interval_days=10, reps=4)
    assert patch["reps"] == 0, "a lapse restarts the card"
    assert patch["interval_days"] == 1
    assert patch["ease"] == pytest.approx(2.3)


async def test_again_clamps_ease_at_the_floor(db):
    """Ease must never fall below 1.3 or intervals collapse toward zero."""
    patch = await apply_grade(db, "again", ease=1.35, interval_days=5, reps=2)
    assert patch["ease"] == pytest.approx(1.3)


async def test_hard_grows_interval_slowly_and_keeps_reps(db):
    patch = await apply_grade(db, "hard", ease=2.5, interval_days=10, reps=3)
    assert patch["reps"] == 4
    assert patch["interval_days"] == 12  # round(10 * 1.2)
    assert patch["ease"] == pytest.approx(2.35)


async def test_hard_never_returns_zero_days(db):
    """A brand-new card graded hard: round(0 * 1.2) is 0, which would make the
    card due immediately and loop forever. The max(1, …) is load-bearing."""
    patch = await apply_grade(db, "hard", ease=2.5, interval_days=0, reps=0)
    assert patch["interval_days"] == 1


async def test_good_on_a_new_card_is_one_day(db):
    patch = await apply_grade(db, "good", ease=2.5, interval_days=0, reps=0)
    assert patch["interval_days"] == 1
    assert patch["reps"] == 1
    assert patch["ease"] == pytest.approx(2.5), "good leaves ease untouched"


async def test_good_on_a_seen_card_multiplies_by_ease(db):
    patch = await apply_grade(db, "good", ease=2.5, interval_days=10, reps=2)
    assert patch["interval_days"] == 25  # round(10 * 2.5)


async def test_easy_raises_ease_and_jumps_further(db):
    patch = await apply_grade(db, "easy", ease=2.5, interval_days=10, reps=2)
    assert patch["ease"] == pytest.approx(2.65)
    assert patch["interval_days"] == 34  # round(10 * 2.65 * 1.3)


async def test_easy_on_a_new_card_uses_a_floor_of_one(db):
    """`(interval or 1)` — otherwise a new card's 0 would multiply to nothing."""
    patch = await apply_grade(db, "easy", ease=2.5, interval_days=0, reps=0)
    assert patch["interval_days"] == 3  # max(2, round(1 * 2.65 * 1.3)) → round(3.445)


async def test_grade_always_sets_a_future_due_date(db):
    patch = await apply_grade(db, "good", ease=2.5, interval_days=3, reps=1)
    assert "due_at" in patch and patch["due_at"]


# ── Python ⇄ TypeScript parity ─────────────────────────────────────────

# Chosen to hit the places the two languages could plausibly disagree:
# rounding halfway cases, the ease floor, zero intervals, and large values.
PARITY_CASES = [
    {"ease": e, "interval_days": i, "reps": r, "grade": g}
    for e in (1.3, 1.35, 2.5, 2.65, 3.4)
    for i in (0, 1, 2, 3, 5, 10, 21, 100)
    for r in (0, 1, 5)
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
        py = await apply_grade(
            db,
            case["grade"],
            ease=case["ease"],
            interval_days=case["interval_days"],
            reps=case["reps"],
        )
        same = (
            round(py["ease"], 9) == round(ts["ease"], 9)
            and py["interval_days"] == ts["interval_days"]
            and py["reps"] == ts["reps"]
        )
        if not same:
            mismatches.append(
                f"  {case} → python={{'ease': {py['ease']}, "
                f"'interval_days': {py['interval_days']}, 'reps': {py['reps']}}} "
                f"ts={ts}"
            )

    assert not mismatches, (
        "The server and the optimistic client scheduler disagree. Every graded "
        "card would flash the wrong next-review interval before the PATCH "
        "corrects it. Fix both `flashcards.py::grade_card` and "
        "`web/src/lib/schedule.ts` together:\n" + "\n".join(mismatches[:15])
    )
