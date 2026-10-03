"""Is the quiz workflow better than one prompt? Two checks.

    uv run python -m eval.quiz_check --coverage     # free: what repeated quizzes cover
    uv run python -m eval.quiz_check --questions    # model calls: are the questions right?

**Coverage.** Five quizzes in a row on each benchmark topic with no topic
typed. Before: every one searched for "core concepts" and got the same chunks.
Now: `coverage.spread` moves through the sections, least-used first. Counted:
how many different sections the five quizzes drew on, out of how many exist.

**Questions.** For each topic, one quiz written the old way (one call, kept
as written) and one by the workflow (write, check, verify, repair), from the
same material. Every final question is then graded by the large model, which
saw neither the writing nor the verifying: is the marked answer supported by
the material, and is it the only right choice? Saved after every quiz, so a
stopped run resumes where it stopped.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

from app.config import settings
from app.services import chunking, quiz_agent, retrieval
from app.services.coverage import Source, _Row, spread, want_sources
from app.services.pdf_layout import read_pdf

from .answers import PAUSE_S, _complete
from .corpus import TOPIC_NAMES, TOPICS, documents
from .pg import topic_id
from .variants import Final

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results" / "quizzes.json"
# The benchmark pauses between calls to stay inside a free-tier rate limit,
# which the product's own time limits would read as a slow model.
quiz_agent.VERIFY_TIMEOUT_S = 180.0
quiz_agent.REPAIR_BEFORE_S = 600.0

QUIZZES = 5
QUESTIONS = 5
MIX = {"easy": 2, "medium": 2, "hard": 1}


def coverage_check() -> dict:
    out = {}
    for topic, names in TOPICS.items():
        rows: list[_Row] = []
        for name in names:
            doc = next(d for d in documents() if d.name == name)
            rows += [_Row(f"{name}#{c.index}", name, c.index, c.section) for c in chunking.chunk(read_pdf(doc.data)[0])]
        sections = {(r.document_id, r.section) for r in rows}
        used: Counter[str] = Counter()
        drawn: set = set()
        for _ in range(QUIZZES):
            for chunk_id in spread(rows, used, want_sources(QUESTIONS)):
                used[chunk_id] += 1
                row = next(r for r in rows if r.id == chunk_id)
                drawn.add((row.document_id, row.section))
        out[topic] = {"sections": len(sections), "covered_now": len(drawn), "covered_before": "the same ≤7 chunks each time"}
        print(f"{topic:8} {len(drawn)} of {len(sections)} sections across {QUIZZES} quizzes")
    return out


_GRADE = """You are grading quiz questions against the material they were written from.
For each question reply whether the marked answer is SUPPORTED by the material, and whether it is the ONLY right choice.
Reply with a JSON object only: {{"grades": [{{"n": 1, "supported": true, "only_right": true}}]}}.

Material:
{material}

Questions:
{questions}"""


async def _grade(sources: list[Source], questions) -> list[dict]:
    lines = []
    for n, q in enumerate(questions, start=1):
        choices = "\n".join(f"  {'ABCD'[i]}) {c}" for i, c in enumerate(q.choices))
        lines.append(f"Q{n}: {q.q}\n{choices}\n  Marked answer: {'ABCD'[q.answer_index]}")
    raw = await _complete(
        [{"role": "user", "content": _GRADE.format(material=quiz_agent._sources_block(sources), questions="\n\n".join(lines))}],
        settings.groq_model,
        0.0,
        json_object=True,
    )
    await asyncio.sleep(PAUSE_S)
    try:
        data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
        return [g for g in data.get("grades", []) if isinstance(g, dict)]
    except (ValueError, AttributeError):
        return []


async def _questions_check() -> dict:
    saved = json.loads(OUT.read_text()) if OUT.exists() else {}
    variant = Final()
    from .index import Embedder

    embedder = Embedder()
    variant.index(documents(), embedder)
    for topic in TOPICS:
        for way in ("one prompt", "workflow"):
            key = f"{topic} / {way}"
            if key in saved:
                continue
            found = await retrieval.retrieve(
                TOPIC_NAMES[topic], subspace_id=topic_id(topic), config=retrieval.GENERATION,
                store=variant.store, embed=embedder.aembed,
            )
            sources = [Source(i, c.id, c.document_name, c.locator, c.content) for i, c in enumerate(found.chunks, start=1)]

            async def slow(messages, model, temperature):
                reply = await _complete(messages, model, temperature)
                await asyncio.sleep(PAUSE_S)
                return reply

            if way == "workflow":
                draft = await quiz_agent.write_quiz(
                    count=QUESTIONS, topic=None, label=TOPIC_NAMES[topic], mix=MIX, sources=sources,
                    conversation="", earlier=[], complete=slow, embed=embedder.aembed,
                )
                questions, trace = draft.questions, draft.trace
            else:
                raw = await slow(
                    [{"role": "user", "content": quiz_agent.write_prompt(count=QUESTIONS, topic=None, label=TOPIC_NAMES[topic], mix=MIX, items=sources, earlier=[])}],
                    settings.groq_model, 0.3,
                )
                items = [it for it in quiz_agent.parse_items(raw) if not quiz_agent.question_checks.problems(it, sources=len(sources))]
                questions = [q for q in (quiz_agent._to_question(it, sources) for it in items[:QUESTIONS]) if q]
                trace = {"written": len(quiz_agent.parse_items(raw)), "kept": len(questions)}
            grades = await _grade(sources, questions)
            ok = sum(1 for g in grades if g.get("supported") is True and g.get("only_right") is True)
            saved[key] = {"questions": len(questions), "graded": len(grades), "sound": ok, "trace": trace}
            OUT.write_text(json.dumps(saved, indent=1))
            print(key, saved[key], flush=True)
    embedder.save()
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--coverage", action="store_true")
    parser.add_argument("--questions", action="store_true")
    args = parser.parse_args()
    if args.coverage:
        result = coverage_check()
        data = json.loads(OUT.read_text()) if OUT.exists() else {}
        data["coverage"] = result
        OUT.write_text(json.dumps(data, indent=1))
    if args.questions:
        asyncio.run(_questions_check())


if __name__ == "__main__":
    main()
