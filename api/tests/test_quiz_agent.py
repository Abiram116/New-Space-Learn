"""The quiz workflow: what each step keeps and drops, how many model calls it
makes, and that an optional step failing never fails the quiz."""

from __future__ import annotations

import json
from collections import Counter

import pytest

from app.errors import UpstreamUnavailable
from app.services import coverage, question_checks, quiz_agent
from app.services.coverage import Source, _Row, spread

SOURCES = [
    Source(1, "chunk-a", "notes.pdf", "p. 4 · Momentum", "Momentum adds a fraction of the previous update."),
    Source(2, "chunk-b", "notes.pdf", "p. 6 · Learning rate", "Too large a learning rate overshoots and diverges."),
]
MIX = {"easy": 1, "medium": 1, "hard": 1}


def q(text: str, *, source: int = 1, answer: int = 0, subtopic: str = "Momentum", choices=None) -> dict:
    return {
        "q": text,
        "choices": choices or [f"{text} right", f"{text} wrong one", f"{text} wrong two", f"{text} wrong three"],
        "answer_index": answer,
        "source": source,
        "subtopic": subtopic,
        "explanation": "Because the source says exactly this.",
        "difficulty": "easy",
    }


class Script:
    """A fake model: replies in order, and records every call."""

    def __init__(self, *replies) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, messages, model, temperature, json_object=False):
        self.calls.append((model, messages[-1]["content"]))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def written(*items, title="Momentum Basics") -> str:
    return f"TITLE: {title}\n" + json.dumps(list(items))


def verdicts(*failed: int, n: int) -> str:
    return json.dumps({"verdicts": [{"n": i, "supported": i not in failed, "correct": True} for i in range(1, n + 1)]})


async def no_embed(texts):
    return [[1.0, 0.0] for _ in texts]


async def run(script, *, count=3, earlier=(), conversation="", clock=None):
    return await quiz_agent.write_quiz(
        count=count, topic="momentum", label="Optimisation", mix=MIX, sources=SOURCES,
        conversation=conversation, earlier=list(earlier), complete=script, embed=no_embed,
        **({"clock": clock} if clock else {}),
    )


TOPICS = ["momentum terms", "learning rates", "saddle points", "line searches", "preconditioning"]
QUESTIONS = [q(f"What is true of {t} in optimisation?", source=1 + i % 2, subtopic=t) for i, t in enumerate(TOPICS)]


async def test_the_normal_path_is_two_calls_and_keeps_what_was_verified():
    script = Script(written(*QUESTIONS), verdicts(2, n=5))
    draft = await run(script)
    assert [m for m, _ in script.calls] == [quiz_agent.settings.groq_model, quiz_agent.settings.groq_model_fast]
    assert "Write 5 multiple-choice" in script.calls[0][1]  # two spare
    assert [x.q for x in draft.questions] == [QUESTIONS[i]["q"] for i in (0, 2, 3)]
    assert all(x.checked is True for x in draft.questions)
    first = draft.questions[0]
    assert (first.source, first.source_chunk) == ("notes.pdf · p. 4 · Momentum", "chunk-a")
    assert draft.title == "Momentum Basics"
    assert draft.trace | {"seconds": 0} == {
        "malformed": 0, "repeats": 0, "written": 5, "unsupported": 1, "verified": True,
        "repaired": 0, "kept": 3, "seconds": 0,
    }


async def test_a_shortfall_is_repaired_with_one_more_call():
    script = Script(written(*QUESTIONS[:3]), verdicts(1, 2, n=3), written(*QUESTIONS[3:]))
    draft = await run(script)
    assert len(script.calls) == 3
    # The repair is told what the quiz already has.
    assert QUESTIONS[2]["q"] in script.calls[2][1]
    assert [x.q for x in draft.questions] == [QUESTIONS[i]["q"] for i in (2, 3, 4)]
    assert [x.checked for x in draft.questions] == [True, False, False]


async def test_no_repair_when_time_has_run_out():
    times = iter([0.0, 20.0, 20.0, 20.0])
    script = Script(written(*QUESTIONS[:3]), verdicts(1, 2, n=3))
    draft = await run(script, clock=lambda: next(times))
    assert len(script.calls) == 2 and len(draft.questions) == 1


@pytest.mark.parametrize("failure", [TimeoutError(), RuntimeError("rate limited"), "this is not json"])
async def test_a_verifier_that_fails_or_rambles_never_fails_the_quiz(failure):
    script = Script(written(*QUESTIONS), failure)
    draft = await run(script)
    assert len(draft.questions) == 3 and all(x.checked is False for x in draft.questions)
    assert draft.trace["verified"] is False


async def test_a_question_the_verifier_did_not_mention_is_kept():
    script = Script(written(*QUESTIONS[:3]), json.dumps({"verdicts": [{"n": 1, "supported": False, "correct": True}]}))
    draft = await run(script, count=2)
    assert [x.q for x in draft.questions] == [QUESTIONS[1]["q"], QUESTIONS[2]["q"]]


async def test_the_writer_failing_is_an_error_the_student_sees():
    with pytest.raises(UpstreamUnavailable):
        await run(Script(UpstreamUnavailable("down")))


async def test_malformed_questions_and_repeats_never_reach_the_verifier():
    earlier = [q("What does momentum add to each update")]
    script = Script(
        written(
            q("What does momentum add to each update"),  # asked last time
            {**q("A question with a missing source"), "source": 9},
            q("What happens when the learning rate is too large", source=2, subtopic="Learning rate"),
            q("What happens when the learning rate is too large", source=2, subtopic="Learning rate"),  # twice
        ),
        verdicts(n=1),
    )
    draft = await run(script, count=1, earlier=earlier)
    assert [x.q for x in draft.questions] == ["What happens when the learning rate is too large"]
    assert draft.trace["malformed"] == 1 and draft.trace["repeats"] == 2
    assert script.calls[1][1].count("Q1") == 1 and "Q2" not in script.calls[1][1]


async def test_earlier_questions_are_shown_to_the_writer():
    script = Script(written(*QUESTIONS), verdicts(n=5))
    await run(script, earlier=[q("An earlier question about momentum terms")])
    assert "already been asked" in script.calls[0][1] and "An earlier question about momentum terms" in script.calls[0][1]


async def test_the_conversation_is_a_numbered_source_of_its_own():
    script = Script(written(q("From the chat about momentum here", source=3)), verdicts(n=1))
    draft = await run(script, count=1, conversation="user: explain momentum\\nassistant: it carries velocity")
    assert "[3] (Your recent conversation)" in script.calls[0][1]
    assert draft.questions[0].source == "Your recent conversation" and draft.questions[0].source_chunk is None


# ── the checks ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "change,problem",
    [
        ({"q": "?"}, "no question"),
        ({"choices": ["a", "b", "c"]}, "not four choices"),
        ({"choices": ["a", "A", "b", "c"]}, "repeated choices"),
        ({"answer_index": True}, "no valid answer"),
        ({"explanation": ""}, "no explanation"),
        ({"source": 0}, "no valid source"),
        ({"source": "1"}, "no valid source"),
    ],
)
def test_each_structural_problem_is_named(change, problem):
    assert question_checks.problems({**q("A perfectly fine question"), **change}, sources=2) == [problem]


def test_wording_repeats_compare_the_question_with_its_answer():
    asked = q("Which of these is a normal form", choices=["3NF", "BFG", "XYZ", "QRS"])
    opposite = q("Which of these is a normal form", choices=["BFG", "3NF", "XYZ", "QRS"])  # different right answer
    assert question_checks.repeats_by_wording([asked], [asked]) == {0}
    assert question_checks.repeats_by_wording([opposite], [asked]) == set()


async def test_meaning_repeats_are_only_looked_for_within_a_concept():
    new = [q("Why does a big step overshoot", subtopic="Learning rate"), q("What is momentum for", subtopic="Momentum")]
    earlier = [q("For what reason does a large step size overshoot", subtopic="learning rate"), q("Unrelated", subtopic="Other")]
    seen = []

    async def embed(texts):
        seen.extend(texts)
        return [[1.0, 0.0] if "step" in t else [0.0, 1.0] for t in texts]

    assert await question_checks.repeats_by_meaning(new, earlier, embed) == {0}
    assert not any("Unrelated" in t for t in seen)  # other concepts are never embedded


# ── coverage ───────────────────────────────────────────────────────────


def rows(doc: str, sections: list[str], per: int = 3) -> list[_Row]:
    out, i = [], 0
    for s in sections:
        for _ in range(per):
            out.append(_Row(f"{doc}{i}", doc, i, s))
            i += 1
    return out


def test_coverage_takes_one_chunk_per_section_and_documents_take_turns():
    pool = rows("a", ["A1", "A2", "A3"]) + rows("b", ["B1", "B2"])
    picked = spread(pool, Counter(), 4)
    by_id = {r.id: r for r in pool}
    assert [by_id[i].document_id for i in picked] == ["a", "b", "a", "b"]
    assert len({by_id[i].section for i in picked}) == 4
    assert all(by_id[i].chunk_index % 3 == 1 for i in picked)  # the middle of each section


def test_coverage_moves_on_to_what_earlier_quizzes_did_not_use():
    pool = rows("a", ["A1", "A2", "A3"])
    first = spread(pool, Counter(), 2)
    second = spread(pool, Counter(first), 2)
    assert set(first).isdisjoint(second)
    by_id = {r.id: r for r in pool}
    assert by_id[second[0]].section == "A3"


def test_a_document_without_headings_is_still_spread():
    pool = [_Row(f"c{i}", "c", i, None) for i in range(20)]
    picked = spread(pool, Counter(), 4)
    assert len({int(p[1:]) // 4 for p in picked}) == 4


def test_how_many_sources_a_quiz_gets():
    assert [coverage.want_sources(n) for n in (1, 5, 20)] == [3, 7, 8]


async def test_a_big_quiz_asks_one_call_for_at_most_fifteen_and_repairs_the_rest():
    many = [q(f"What is distinctive about concept {name}?", subtopic=name) for name in
            ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron"]]
    extra = [q(f"What is distinctive about concept {name}?", subtopic=name) for name in ["pi", "rho", "sigma", "tau", "upsilon"]]
    script = Script(written(*many), verdicts(n=15), written(*extra))
    draft = await run(script, count=20)
    assert "Write 15 multiple-choice" in script.calls[0][1] and "Write 5 multiple-choice" in script.calls[2][1]
    assert len(draft.questions) == 20


def test_every_model_call_has_a_reply_budget_and_reasoning_models_think_briefly():
    from app.services.llm import _reply_budget

    assert _reply_budget("openai/gpt-oss-120b") == {
        "max_completion_tokens": 4096, "reasoning_effort": "low", "include_reasoning": False,
    }
    assert _reply_budget("qwen/qwen3.8-27b") == {"max_completion_tokens": 4096}
