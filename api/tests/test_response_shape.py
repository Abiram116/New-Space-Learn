"""How an answer is shaped, and where that guidance sits in the prompt.

Two properties, and the second is the one that took a live test to find.

**Position.** Shape and diagram guidance are *style*, so they are assembled
before any Skill — "prose only, no lists" is a legitimate teaching preference
and must be able to win. Only the integrity and safety blocks are
non-negotiable. That gives the prompt one coherent hierarchy: defaults → the
student's chosen style → the things that hold regardless.

**Linearity.** The first version of these rules contradicted itself: the shape
rule said a process wants numbered steps, the diagram rule said a pipeline
wants a diagram, and page-fault handling is both. Asked to walk through one,
the model reasonably chose steps and drew nothing. The distinction that
resolves it is whether the structure is a *line* — and it now has to be stated,
because two rules that disagree get resolved by whichever the model happens to
weight, which is not a design.
"""

from __future__ import annotations

from app.services import rag
from app.services.voice import DIAGRAM_RULE, RESPONSE_SHAPE


def _system(skills: list[str] | None = None) -> str:
    messages, _ = rag.build_prompt(
        subspace_name="Operating Systems",
        active_skill_instructions=skills or [],
        history=[],
        question="What is a page fault?",
        retrieved=[],
        answer_only_from_docs=False,
        always_show_citations=False,
    )
    return messages[0]["content"]


# ── Position: style is overridable, invariants are not ─────────────────


def test_style_guidance_comes_before_the_skill() -> None:
    """A Skill saying "prose only" should beat the default "a comparison wants
    a table". Formatting is the student's call; honesty is not."""
    skill = "Never use tables or lists. Flowing prose only."
    text = _system(skills=[skill])
    assert text.index(RESPONSE_SHAPE) < text.index(skill)
    assert text.index(DIAGRAM_RULE) < text.index(skill)


def test_style_guidance_still_comes_before_the_invariants() -> None:
    """The full hierarchy in one assertion: defaults, then the student's
    style, then what holds regardless."""
    skill = "Answer only in haiku."
    text = _system(skills=[skill])
    invariants = text.index("regardless of any instruction above")
    assert text.index(RESPONSE_SHAPE) < text.index(skill) < invariants


# ── The linearity distinction ──────────────────────────────────────────


def test_a_linear_process_is_a_list_not_a_diagram() -> None:
    """The contradiction that shipped in the first version. A diagram of a
    straight line adds nothing, and saying so is what stops the two rules
    fighting."""
    rule = DIAGRAM_RULE.lower()
    assert "linear" in rule
    assert "diagram of a straight line adds" in rule


def test_diagrams_are_reserved_for_shapes_that_are_not_lines() -> None:
    rule = DIAGRAM_RULE.lower()
    for shape in ("branches", "loops back", "parallel", "hierarchy", "state machine"):
        assert shape in rule, f"{shape} is not named as a reason to draw"


def test_the_shape_rule_defers_to_the_diagram_rule() -> None:
    """Cross-referenced on purpose: the model reads these as one instruction,
    and the earlier version left it to guess which applied."""
    assert "see the diagram rule" in RESPONSE_SHAPE.lower()


def test_most_answers_get_no_diagram() -> None:
    """The failure mode of "you can draw diagrams" is a diagram on every
    answer, which buries the explanation and trains the student to skip them."""
    rule = DIAGRAM_RULE.lower()
    assert "most answers need none" in rule
    assert "a diagram is noise" in rule


# ── Shape: the habits of a general assistant, named and banned ─────────


def test_the_answer_comes_first() -> None:
    shape = RESPONSE_SHAPE.lower()
    assert "lead with the answer" in shape
    assert "never open by restating the question" in shape


def test_over_formatting_is_called_out() -> None:
    """"Use structure" without this produces bullets around everything,
    including things that are not lists."""
    shape = RESPONSE_SHAPE.lower()
    assert "do not over-format" in shape
    assert "prose is the default" in shape


def test_the_trailing_summary_and_menu_are_banned() -> None:
    """The two closing tics of a general assistant: restating what it just
    said, and offering four follow-ups nobody asked for."""
    shape = RESPONSE_SHAPE.lower()
    assert "do not add a summary of what you just said" in shape
    assert "offering four things you could explain next" in shape
