"""Does the student model actually reach the model — and does it survive intact?

The student model is the product's central claim: answers are shaped by how
*this* student said they want to be taught. That claim spans four hops —

    intake → stored settings → resolved preferences → rendered system prompt

— and it is only true if the preference survives all four. Each hop had a real
bug this year. The intake 422'd and stored nothing. Two fields raced for one
preference key and one was dropped. A preference below the acting threshold is
stored but never rendered, which looks identical to storage working.

So this benchmark asserts on the *end* of the pipeline, not the middle: given a
profile, does the text handed to the LLM contain what the student asked for, and
is a different profile actually distinguishable from it? A test that only
checked storage would have passed through every one of those failures.

The behavioural half — does the LLM *obey* the prompt — cannot be asserted
deterministically and is not attempted here. `scripts/bench_student_model.py`
runs that against the real model and prints a scorecard.
"""

from __future__ import annotations

import pytest

from app.services import personalization
from app.services import student_model as sm

#: Distinct, realistic intakes. Each pair differs in a way the tutor should
#: visibly act on, which is what makes "are these distinguishable" meaningful.
PROFILES: dict[str, dict] = {
    "examples_short": {
        "learning_style": "examples first, then the general rule",
        "teaching_preference": "Keep explanations short and direct.",
        "session_length_minutes": 15,
    },
    "formal_deep": {
        "learning_style": "the precise definition first, then examples",
        "teaching_preference": (
            "Go into real depth; I would rather have too much than too little."
        ),
        "session_length_minutes": 120,
    },
    "multi_pick": {
        "learning_style": (
            "examples first, then the general rule; "
            "comparisons against things I already know"
        ),
        "teaching_preference": "Match the depth to the question rather than a fixed length.",
        "session_length_minutes": 30,
    },
    "empty": {},
}

TASKS = ["chat", "notes", "quiz", "cards"]


def _snap(student_model: dict) -> sm.Snapshot:
    """A snapshot carrying only the intake, so anything observed downstream
    came from the student's own answers and not from inferred behaviour."""
    return sm.Snapshot(
        settings={"student_model": student_model},
        topics=[],
        concepts=[],
        activity_days=[],
        streak_days=0,
        feedback=[],
    )


def _prompt(profile: str, task: str) -> str:
    return personalization.render(_snap(PROFILES[profile]), task)  # type: ignore[arg-type]


# ── The preference reaches the prompt ──────────────────────────────────


@pytest.mark.parametrize("profile", ["examples_short", "formal_deep", "multi_pick"])
def test_stated_style_appears_in_the_chat_prompt(profile: str) -> None:
    """The end of the pipeline. If this fails the student answered questions
    that changed nothing, which is the worst outcome the product has."""
    text = _prompt(profile, "chat").lower()
    style = PROFILES[profile]["learning_style"].split(";")[0].strip().lower()
    assert style in text, f"{profile}: '{style}' never reached the chat prompt"


def test_every_pick_of_a_multi_select_survives() -> None:
    """"Pick as many as fit" has to mean it — dropping all but the first is the
    failure mode this had, and it is invisible without checking each one."""
    text = _prompt("multi_pick", "chat").lower()
    for part in PROFILES["multi_pick"]["learning_style"].split(";"):
        assert part.strip().lower() in text


def test_depth_preference_reaches_prose_tasks() -> None:
    """Notes and chat are the two tasks that produce prose, so both must know
    how much the student wants."""
    for task in ("chat", "notes"):
        text = _prompt("formal_deep", task).lower()
        assert "depth" in text or "too much" in text, f"{task} lost the depth preference"


# ── Profiles are actually distinguishable ──────────────────────────────


def test_two_different_students_get_different_prompts() -> None:
    """The real question: does answering differently *do* anything? Identical
    prompts for opposite intakes would mean the intake is decoration."""
    a = _prompt("examples_short", "chat")
    b = _prompt("formal_deep", "chat")
    assert a != b
    # Not merely different — different in the direction that was asked for.
    assert "examples first" in a.lower()
    assert "precise definition" in b.lower()


def test_an_empty_profile_asserts_nothing() -> None:
    """Silence is the correct output for a student who told us nothing. A
    default dressed as an instruction is worse than no instruction: the model
    follows a guess exactly as hard as it follows a stated preference."""
    text = _prompt("empty", "chat")
    for phrase in ("examples first", "precise definition", "real depth"):
        assert phrase not in text.lower()


# ── The preference is actionable, not merely stored ────────────────────


def test_explicit_intake_clears_the_acting_threshold() -> None:
    """A preference below `ACT_THRESHOLD` is stored and never rendered, which
    from the outside is indistinguishable from not being stored at all."""
    from app.services.preferences import resolve

    prefs = resolve(_snap(PROFILES["examples_short"]))
    note = prefs.get("explanation.note")
    assert note is not None
    assert note.actionable, "stored but never rendered is the same as not stored"
    assert note.source == "explicit"


def test_a_stated_preference_outranks_an_inferred_one() -> None:
    """The student's own words must not be overwritten by behaviour we guessed
    at — that is how a product starts contradicting what someone told it."""
    from app.services.preferences import SOURCE_WEIGHT

    # Explicit must outrank every source that was inferred rather than stated.
    assert SOURCE_WEIGHT["explicit"] == max(SOURCE_WEIGHT.values())
    for inferred in ("experiment", "feedback", "observed"):
        assert SOURCE_WEIGHT["explicit"] > SOURCE_WEIGHT[inferred], inferred


# ── Cost: personalisation is prepended to every call ───────────────────


@pytest.mark.parametrize("task", TASKS)
def test_the_block_stays_small_enough_to_prepend_to_everything(task: str) -> None:
    """This text rides on every request for its task, so its length is a bill
    as well as a prompt. A cap here is what stops "add one more line" becoming
    a permanent per-call cost nobody notices."""
    text = _prompt("multi_pick", task)
    assert len(text) < 1500, f"{task} personalisation is {len(text)} chars"


def test_tasks_only_get_what_they_can_use() -> None:
    """Quiz generation does not need the student's preferred prose tone, and
    paying tokens to send it is the reason `render` is task-aware at all."""
    quiz = _prompt("formal_deep", "quiz").lower()
    assert "wants explanations like this" not in quiz
