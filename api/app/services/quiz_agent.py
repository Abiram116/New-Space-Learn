"""Writing a quiz: plan, write, check, verify, repair.

A quiz used to be one prompt and whatever came back. Nothing checked that a
question's answer was actually in the material, that two questions weren't the
same question, or that the last quiz hadn't asked it already. Now:

    plan     which material to write from (`coverage.py`, code, no model call)
    write    one call: a couple more questions than asked for, each naming
             the numbered source it was written from
    check    in code: well formed, a real source, not a repeat
             (`question_checks.py`)
    verify   one call to the small model, for the whole quiz at once: is each
             answer supported by its source, and is it the only right choice?
    repair   only if too few survived, and only if there is time: one more
             call for the shortfall, checked in code

So a quiz costs two model calls, and three at worst. Any step after "write"
that fails — a timeout, a rate limit, a reply that isn't JSON — is skipped
rather than allowed to fail the quiz; questions that were not verified say so
(`QuizQuestion.checked`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

from ..config import settings
from ..schemas import QuizQuestion
from . import question_checks
from .coverage import Source
from .embeddings import embed_texts
from .llm import extract_title_line, get_llm, loads_lenient
from .voice import QUIZ_AGENT_VOICE

log = logging.getLogger("space_learn.quiz_agent")

#: Questions written beyond those asked for, so failures can be dropped
#: without a repair call.
SPARE = 2
#: The most questions asked of one call. A question with all its fields is
#: ~235 tokens, and a reply is capped at `groq_max_completion_tokens` (4,096);
#: a bigger quiz gets the rest from the repair call.
WRITE_MAX = 15
#: A repair call is only made this early: the browser gives up on a request
#: at 35 seconds, and a repair is a full call to the large model.
REPAIR_BEFORE_S = 16.0
VERIFY_TIMEOUT_S = 12.0
#: Earlier questions shown to the writer as "don't ask these again".
SHOW_EARLIER = 12

Complete = Callable[[list[dict], str, float], Awaitable[str]]


@dataclass(slots=True)
class Draft:
    questions: list[QuizQuestion]
    title: str | None = None
    #: What happened at each step, for the log.
    trace: dict = field(default_factory=dict)


async def _complete(messages: list[dict], model: str, temperature: float) -> str:
    parts: list[str] = []
    async for delta in get_llm().stream_chat(messages, model=model, temperature=temperature):
        parts.append(delta)
    return "".join(parts).strip()


def material(sources: Sequence[Source], conversation: str) -> list[Source]:
    """The numbered material: the planned chunks, then the recent conversation
    (a student's own explanations count as their material too)."""
    out = list(sources)
    if conversation.strip():
        out.append(Source(len(out) + 1, "", "Your recent conversation", "", conversation.strip()))
    return out


def _sources_block(items: Sequence[Source]) -> str:
    return "\n\n".join(f"[{s.number}] ({s.label})\n{s.content}" for s in items)


def write_prompt(
    *, count: int, topic: str | None, label: str, mix: dict[str, int], items: Sequence[Source], earlier: Sequence[dict]
) -> str:
    avoid = [str(q.get("q", "")).strip()[:140] for q in earlier[:SHOW_EARLIER] if q.get("q")]
    avoid_block = (
        "Questions this student has already been asked on this topic — do not ask any of them again, "
        "even reworded:\n" + "\n".join(f"- {q}" for q in avoid) + "\n\n"
        if avoid
        else ""
    )
    return (
        f"Write {count} multiple-choice questions about "
        f"'{topic or 'the key concepts in this material'}', within the subject '{label}' — "
        "resolve any ambiguity in the topic name using that subject, not a generic reading of the words. "
        "Write every question from ONE of the numbered sources below and from nothing else: "
        "the fact its correct answer depends on must be stated in that source. "
        "Spread the questions across the sources rather than writing several from one.\n\n"
        f"Sources:\n{_sources_block(items)}\n\n"
        f"{avoid_block}"
        "Return a JSON array; each item has fields: "
        '{"q": str, "choices": [str, str, str, str], "answer_index": 0-3, "source": int, '
        '"subtopic": str, "explanation": str, "difficulty": str, "kind": str, '
        '"misconceptions": [str|null, ...], "prerequisites": [str, ...]}. '
        "source is the NUMBER of the source the question was written from. "
        "subtopic is the specific concept this question tests, narrower than the overall topic "
        "(e.g. 'Policy Iteration', not 'Reinforcement Learning'). "
        "explanation is 1-2 sentences saying WHY the correct answer is correct and, where there is an "
        "obvious trap, why the most tempting wrong choice is wrong. Write it to the student, in second person. "
        f'difficulty is "easy", "medium" or "hard". Write about {mix["easy"]} easy, {mix["medium"]} medium and '
        f'{mix["hard"]} hard questions — this mix targets roughly a 75% success rate for this student on this '
        'topic right now. kind is "recall" (asks for a fact or definition) or "apply" (asks the student to use '
        "it, e.g. on a new example). misconceptions is one entry per choice, same order as choices: for each "
        "WRONG choice, a short phrase (5 words or fewer) naming the misconception it represents — null for the "
        "correct choice. prerequisites is 0-2 short concept names (2-4 words each) this question depends on. "
        "Exactly one choice may be correct. "
        "Before the array, on its own line, write a title for this quiz: 'TITLE: ' followed by 3-6 words naming "
        "what it actually covers (e.g. 'TITLE: Policy Iteration Basics'), not a generic label. "
        "Then the JSON array — no other prose, no code fences."
    )


def verify_prompt(items: Sequence[Source], questions: Sequence[dict]) -> str:
    lines = []
    for n, q in enumerate(questions, start=1):
        choices = "\n".join(f"  {'ABCD'[i]}) {c}" for i, c in enumerate(q["choices"]))
        lines.append(f"Q{n} (source {q['source']}): {q['q']}\n{choices}\n  Marked answer: {'ABCD'[q['answer_index']]}")
    return (
        "You check quiz questions against the material they were written from. For each question:\n"
        '- "supported": true only if its own source states the fact the marked answer depends on.\n'
        '- "correct": true only if the marked answer is right according to that source AND no other choice is also right.\n'
        'Reply with a JSON array only, one item per question: [{"n": 1, "supported": true, "correct": true}].\n\n'
        f"Material:\n{_sources_block(items)}\n\nQuestions:\n" + "\n\n".join(lines)
    )


def parse_items(raw: str) -> list[dict]:
    """The JSON array in a model reply, tolerating text around it. Empty when there is none."""
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        data = loads_lenient(raw[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def failed_checks(verdicts: list[dict], count: int) -> set[int] | None:
    """0-based indexes the verifier failed. None when its reply was unusable;
    a question it did not mention is not failed — the verifier's omission is
    not evidence against the question."""
    if not verdicts:
        return None
    failed: set[int] = set()
    for v in verdicts:
        n = v.get("n")
        if isinstance(n, int) and 1 <= n <= count and (v.get("supported") is False or v.get("correct") is False):
            failed.add(n - 1)
    return failed


def _usable(items: list[dict], sources: int, earlier: Sequence[dict]) -> tuple[list[dict], dict]:
    """The items that pass every check code can make, and how many failed which."""
    well_formed = [it for it in items if not question_checks.problems(it, sources=sources)]
    repeats = question_checks.repeats_by_wording(well_formed, earlier)
    kept = [it for i, it in enumerate(well_formed) if i not in repeats]
    return kept, {"malformed": len(items) - len(well_formed), "repeats": len(repeats)}


async def write_quiz(
    *,
    count: int,
    topic: str | None,
    label: str,
    mix: dict[str, int],
    sources: Sequence[Source],
    conversation: str,
    earlier: Sequence[dict],
    student_context: str = "",
    complete: Complete = _complete,
    embed: question_checks.Embed = embed_texts,
    clock: Callable[[], float] = time.monotonic,
) -> Draft:
    started = clock()
    items_ = material(sources, conversation)
    system = QUIZ_AGENT_VOICE + (f"\n\n{student_context}" if student_context else "")

    def ask(n: int, already: Sequence[dict]) -> list[dict]:
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": write_prompt(count=n, topic=topic, label=label, mix=mix, items=items_, earlier=already)},
        ]

    # write
    raw = await complete(ask(min(count + SPARE, WRITE_MAX), earlier), settings.groq_model, 0.3)
    title = extract_title_line(raw)
    kept, trace = _usable(parse_items(raw), len(items_), earlier)
    trace["written"] = len(parse_items(raw))
    meaning = await _safely(question_checks.repeats_by_meaning(kept, earlier, embed), set())
    kept = [it for i, it in enumerate(kept) if i not in meaning]
    trace["repeats"] += len(meaning)

    # verify
    verified = False
    if kept:
        reply = await _safely(
            asyncio.wait_for(complete([{"role": "user", "content": verify_prompt(items_, kept)}], settings.groq_model_fast, 0.0), VERIFY_TIMEOUT_S),
            "",
        )
        failed = failed_checks(parse_items(reply), len(kept))
        if failed is not None:
            verified = True
            trace["unsupported"] = len(failed)
            kept = [it for i, it in enumerate(kept) if i not in failed]
    trace["verified"] = verified
    for it in kept:
        it["_checked"] = verified

    # repair
    short = count - len(kept)
    trace["repaired"] = 0
    if short > 0 and clock() - started < REPAIR_BEFORE_S:
        raw = await _safely(complete(ask(short, [*kept, *earlier]), settings.groq_model, 0.3), "")
        extra, _ = _usable(parse_items(raw), len(items_), [*kept, *earlier])
        for it in extra[:short]:
            it["_checked"] = False
        kept += extra[:short]
        trace["repaired"] = len(extra[:short])

    questions = [_to_question(it, items_) for it in kept[:count]]
    trace["kept"] = len(questions)
    trace["seconds"] = round(clock() - started, 1)
    return Draft([q for q in questions if q is not None], title, trace)


def _to_question(item: dict, items: Sequence[Source]) -> QuizQuestion | None:
    source = items[item["source"] - 1] if isinstance(item.get("source"), int) and 0 < item["source"] <= len(items) else None
    data = {k: v for k, v in item.items() if k not in ("source", "_checked")}
    try:
        return QuizQuestion(
            **data,
            source=source.label if source else None,
            source_chunk=(source.chunk_id or None) if source else None,
            checked=item.get("_checked"),
        )
    except Exception:
        return None


async def _safely(awaitable: Awaitable, fallback):  # noqa: ANN001, ANN202
    """An optional step's result, or `fallback` if it failed in any way."""
    try:
        return await awaitable
    except Exception as e:  # noqa: BLE001 — every later step is optional by design
        log.info("quiz step skipped: %s", re.sub(r"\s+", " ", str(e))[:120])
        return fallback
