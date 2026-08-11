"""The contract between first-run intake and the student model.

Onboarding is the only place the app asks the student anything directly, and
its answers are the entire basis for how the tutor writes. That makes a silent
rejection here the most expensive validation failure in the product — and it
shipped: `learning_style` was capped at 60 characters, sized for a single
phrase, while the intake had become a multi-select that joins its picks. Two
picks produce ~75 characters, so the PATCH 422'd.

The damage was not limited to that one field. The intake sends **one** patch, so
a single over-length value discarded the session length and the teaching
preference with it. The student answered every question, watched the sample
answer rewrite itself to prove the choices mattered, and none of it was stored.
The error surfaced as a toast behind a full-screen transition, then onboarding
continued to the dashboard as if it had worked.

These tests pin the limits against the values the intake actually sends, so a
reworded option or a new one fails here rather than in a student's account.
"""

import pytest
from pydantic import ValidationError

from app.schemas import StudentModelIn

# Mirrors `web/src/features/onboarding/steps.ts`. Duplicated across the
# language boundary on purpose: the point is to detect drift, which a shared
# fixture would hide by construction.
LEARNING_STYLE_OPTIONS = [
    "examples first, then the general rule",
    "the intuition first, then the detail",
    "the precise definition first, then examples",
    "comparisons against things I already know",
]

DEPTH_OPTIONS = [
    "Keep explanations short and direct.",
    "Go into real depth; I would rather have too much than too little.",
    "Match the depth to the question rather than a fixed length.",
]

#: How the intake joins a multi-select before sending it.
JOIN = "; "


def test_accepts_every_learning_style_on_its_own() -> None:
    for value in LEARNING_STYLE_OPTIONS:
        StudentModelIn(learning_style=value)


def test_accepts_two_learning_styles_joined() -> None:
    """The exact payload that used to 422 and wipe the whole intake."""
    value = JOIN.join(LEARNING_STYLE_OPTIONS[:2])
    assert len(value) > 60, "regression guard: this case must exceed the old cap"
    StudentModelIn(learning_style=value)


def test_accepts_all_learning_styles_joined() -> None:
    """The worst case the UI can produce — every option ticked."""
    StudentModelIn(learning_style=JOIN.join(LEARNING_STYLE_OPTIONS))


def test_accepts_the_full_intake_as_one_patch() -> None:
    """One field over the limit takes the others down with it, so the whole
    patch is what has to be valid — not each field in isolation."""
    StudentModelIn(
        learning_style=JOIN.join(LEARNING_STYLE_OPTIONS),
        session_length_minutes=120,
        # Both writers of this field: the depth pick, then the free-text step.
        teaching_preference=f"{DEPTH_OPTIONS[1]} {'x' * 300}",
    )


def test_every_session_length_the_intake_offers_is_in_range() -> None:
    for minutes in (15, 30, 60, 120):
        StudentModelIn(session_length_minutes=minutes)


def test_still_rejects_something_absurd() -> None:
    """Raising the cap must not turn the field into unbounded storage — this is
    a preference interpolated into every system prompt, so its length is a cost
    and a prompt-injection surface, not just a column width."""
    with pytest.raises(ValidationError):
        StudentModelIn(learning_style="x" * 5000)


# ── Does any of it reach the model? ────────────────────────────────────

"""Saving the answers is only half the job; the other half is that the tutor
actually writes differently because of them."""


def _prefs(student_model: dict):
    """A snapshot with nothing in it but the intake's answers, so anything the
    assertions see came from the intake and not from inferred behaviour."""
    from app.services import preferences as pf
    from app.services import student_model as sm

    return pf.resolve(
        sm.Snapshot(
            settings={"student_model": student_model},
            topics=[],
            concepts=[],
            activity_days=[],
            streak_days=0,
            feedback=[],
        )
    )


def test_learning_style_reaches_the_prompt() -> None:
    """The regression: `learning_style` and `teaching_preference` both wrote to
    `explanation.note`, and `_put` refuses to overwrite an equal-or-stronger
    source — so whichever was written first won and the other vanished. The
    multi-select was the one that vanished."""
    picked = [LEARNING_STYLE_OPTIONS[0], LEARNING_STYLE_OPTIONS[3]]
    prefs = _prefs({"learning_style": JOIN.join(picked)})
    note = prefs.get("explanation.note")
    assert note is not None, "the intake's main question never reached the model"
    # Every pick, not just the first — the question says "pick as many as fit".
    for value in picked:
        assert value in note.value


def test_both_answers_survive_together() -> None:
    prefs = _prefs(
        {
            "learning_style": LEARNING_STYLE_OPTIONS[0],
            "teaching_preference": DEPTH_OPTIONS[1],
        }
    )
    note = prefs.get("explanation.note")
    assert note is not None
    # Neither may silently displace the other: one says how to open an
    # explanation, the other how far to take it.
    assert "examples first" in note.value
    assert "real depth" in note.value


def test_the_note_is_actionable_so_it_is_actually_rendered() -> None:
    """`_style()` only renders preferences above the act threshold. A stored
    preference that never clears it is the same as no preference at all."""
    prefs = _prefs({"learning_style": LEARNING_STYLE_OPTIONS[0]})
    assert prefs["explanation.note"].actionable


def test_session_length_reaches_the_prompt() -> None:
    prefs = _prefs({"session_length_minutes": 30})
    assert prefs.get("session.length_minutes") is not None
