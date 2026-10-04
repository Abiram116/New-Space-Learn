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
from app.services.voice import (
    DIAGRAM_RULE,
    DIAGRAM_SHORT,
    RESPONSE_SHAPE,
    SHAPE_SHORT,
    is_simple_question,
    wants_diagram,
)


def _system(skills: list[str] | None = None, question: str = "Explain how a page fault is handled") -> str:
    messages, _ = rag.build_prompt(
        subspace_name="Operating Systems",
        active_skill_instructions=skills or [],
        history=[],
        question=question,
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
    text = _system(skills=[skill], question="Draw the lifecycle of a process")
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
    assert "match length to the question" in shape
    assert "no headings, no forced lists" in shape


def test_the_recap_and_menu_are_discouraged() -> None:
    """The two closing tics of a general assistant: restating what it just
    said, and offering a menu of follow-ups nobody asked for. A one-line
    takeaway is allowed, but only when it helps."""
    shape = RESPONSE_SHAPE.lower()
    assert "do not recap what you just said at length" in shape
    assert "offering several things you could explain next" in shape
    assert "**key takeaway:**" in shape
    assert "only when it genuinely helps" in shape


# ── The scannable, ChatGPT/Claude-style structure ──────────────────────


def test_structure_toolkit_is_spelled_out() -> None:
    """Headings, short paragraphs, bullets vs numbered steps, tables, bold
    key terms, a worked example, fenced code and LaTeX — each named so the
    model doesn't default to plain sentences."""
    shape = RESPONSE_SHAPE
    lower = shape.lower()
    assert "## or ###" in shape
    assert "two or three sentences" in lower
    assert "bullet lists for parallel items" in lower
    assert "numbered lists for procedures" in lower
    assert "small table" in lower
    assert "**bold**" in lower
    assert "worked example" in lower
    assert "fenced code blocks" in lower
    assert "latex" in lower


def test_shape_says_it_is_only_a_default() -> None:
    """Length/depth preferences (bandit, feedback, Skills) come later in the
    prompt and must be allowed to win on conflict."""
    shape = RESPONSE_SHAPE.lower()
    assert "overrides it wherever they conflict" in shape
    assert "keep it short" in shape


def test_preference_lines_land_after_the_shape_guidance() -> None:
    """The learned "keep explanations short" line is appended after the
    default structure, so on a conflict the model reads it as more specific."""
    pref = "Keep explanations short and get to the point."
    messages, _ = rag.build_prompt(
        subspace_name="Operating Systems",
        active_skill_instructions=[],
        history=[],
        question="Explain how a page fault is handled",
        retrieved=[],
        answer_only_from_docs=False,
        always_show_citations=False,
        student_context=pref,
    )
    text = messages[0]["content"]
    assert text.index(RESPONSE_SHAPE) < text.index(pref)


def test_citation_instructions_survive_the_new_style_guidance() -> None:
    """Richer formatting must not cost the [[n]] markers: the citation format
    is still stated, after the shape guidance, and headings/lists/tables are
    not exempt from it."""
    retrieved = [
        rag.Retrieved(
            document_id="d1",
            document_name="os.pdf",
            content="A page fault is raised when a page is not in RAM.",
            locator="p. 3",
            similarity=0.9,
        )
    ]
    messages, meta = rag.build_prompt(
        subspace_name="Operating Systems",
        active_skill_instructions=[],
        history=[],
        question="Explain how a page fault is handled",
        retrieved=retrieved,
        answer_only_from_docs=True,
        always_show_citations=True,
    )
    text = messages[0]["content"]
    assert "[[n]]" in text
    assert "Never invent a citation marker" in text
    assert "Answer only using the Sources below" in text
    assert text.index(RESPONSE_SHAPE) < text.index("[[n]]")
    assert meta[0]["marker"] == 1


def test_doubtful_sources_are_passed_with_a_warning_and_good_ones_without():
    """Retrieval's "weak" verdict reaches the model as an instruction to check
    the sources before leaning on them — and only then."""
    source = [rag.Retrieved(document_id="d", document_name="notes.pdf", content="Plants make sugar.", locator="p. 1", similarity=0.6)]
    common = dict(
        subspace_name="Biology", active_skill_instructions=[], history=[], question="What is mitosis?",
        answer_only_from_docs=True, always_show_citations=True,
    )
    doubtful, _ = rag.build_prompt(retrieved=source, sources_doubtful=True, **common)
    sure, _ = rag.build_prompt(retrieved=source, **common)
    nothing, _ = rag.build_prompt(retrieved=[], sources_doubtful=True, **common)
    warning = "may not be about this question"
    assert warning in doubtful[0]["content"]
    assert warning not in sure[0]["content"] and warning not in nothing[0]["content"]


def test_a_citation_on_the_wrong_source_is_moved_to_the_one_that_says_it():
    sources = [
        "Plants convert light into sugar inside chloroplasts during photosynthesis.",
        "Global photosynthesis captures roughly 130 terawatts of solar power.",
    ]
    text = "Global photosynthesis captures roughly 130 terawatts of power [[1]]. Chloroplasts convert light into sugar [[1]]."
    fixed, moved = rag.repoint_citations(text, sources)
    assert fixed == "Global photosynthesis captures roughly 130 terawatts of power [[2]]. Chloroplasts convert light into sugar [[1]]."
    assert moved == 1


def test_a_doubtful_case_is_left_alone():
    sources = ["Momentum adds a fraction of the last update.", "Learning rates control the step size."]
    text = "Both ideas change how fast training settles [[1]]."  # neither source clearly says it
    assert rag.repoint_citations(text, sources) == (text, 0)
    # A sentence already citing the right source loses the wrong extra marker.
    double = "Learning rates control the step size of each update [[1]][[2]]."
    assert rag.repoint_citations(double, sources) == ("Learning rates control the step size of each update [[2]].", 1)


# ── The diagram rule is loaded when the question has a shape ───────────


def test_a_definition_question_gets_the_short_diagram_line_not_the_whole_rule() -> None:
    text = _system(question="What is a page fault?")
    assert DIAGRAM_SHORT in text
    assert DIAGRAM_RULE not in text


def test_a_question_about_structure_gets_the_whole_rule() -> None:
    for q in ("Draw the TCP handshake", "Explain the architecture of a transformer", "How does a page table work?"):
        assert DIAGRAM_RULE in _system(question=q), q
        assert DIAGRAM_SHORT not in _system(question=q), q


def test_the_cue_is_generous_rather_than_clever() -> None:
    assert wants_diagram("what's the life cycle of a thread")
    assert not wants_diagram("define thrashing")


# ── The shape guidance is as long as the question needs ────────────────


def test_a_plainly_simple_question_gets_the_short_shape_and_a_real_one_gets_the_full_shape():
    simple = _system(question="What is a page fault?")
    assert SHAPE_SHORT in simple and RESPONSE_SHAPE not in simple
    full = _system(question="Explain how a page fault is handled")
    assert RESPONSE_SHAPE in full and SHAPE_SHORT not in full


def test_the_short_shape_keeps_what_breaks_rendering_if_forgotten():
    short = SHAPE_SHORT.lower()
    for kept in ("direct answer", "code blocks", "latex", "overrides this"):
        assert kept in short, kept


def test_what_counts_as_simple_is_narrow():
    assert is_simple_question("Define thrashing")
    assert is_simple_question("Who proposed the transformer?")
    for q in ("Explain paging", "Why do deadlocks happen?", "How does TCP work?", "Compare TCP and UDP", "What are the steps of a handshake?", "Write a quicksort in Python"):
        assert not is_simple_question(q), q
    assert not is_simple_question("What is the relationship between the page table and the translation lookaside buffer in a modern CPU?")
