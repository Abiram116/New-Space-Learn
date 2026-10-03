"""Answer quality: what the model actually says, given what retrieval handed it.

Retrieval can find the right page and the answer can still be wrong, or right
and unsupported. This runs a sample of questions through the *production*
prompt (`rag.build_prompt`, with "answer only from my documents" and citations
on) and the production model, then scores each answer three ways:

- **correct** — matches the reference answer; for a question the documents do
  not cover, correct means the model said so instead of answering.
- **unsupported** — makes a claim its sources do not back. Judged by a second,
  smaller model: imperfect, and applied identically to every variant, which is
  what a comparison needs.
- **citation precision** — worked out in code, no judge: of the `[[n]]`
  markers in the answer, the share pointing at a chunk that really contains
  the evidence.

It costs two model calls per question, so it is a sample (`--answers N`), not
the whole set.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re

from app.config import settings
from app.errors import ApiError
from app.services import rag
from app.services.llm import get_llm

from .corpus import CATEGORIES, TOPIC_NAMES, Question, supports
from .variants import Result

#: Seconds between model calls. A free-tier key allows only a few thousand
#: tokens a minute on the large model, and each question sends about two
#: thousand, so this is slow on purpose.
PAUSE_S = 20.0
#: How many times to wait out "at capacity" before giving up on one question.
RETRIES = 4

_JUDGE = """You are grading a study assistant's answer. Reply with JSON only:
{{"correct": true|false, "refused": true|false, "unsupported": true|false}}

- "refused": the answer says the material does not cover the question (and does not go on to answer it anyway).
- "correct": for a question with a reference answer, the answer states the same facts as the reference (wording may differ; extra correct detail is fine). For a question marked NOT COVERED, correct means refused.
- "unsupported": the answer states a fact that the SOURCES below do not contain. A refusal is never unsupported.

QUESTION: {question}
REFERENCE ANSWER: {reference}

SOURCES:
{sources}

ANSWER TO GRADE:
{answer}"""


def sample(questions: list[Question], n: int, seed: int = 7) -> list[Question]:
    """`n` questions spread evenly over the categories, the same ones every run."""
    rng = random.Random(seed)
    per = max(1, n // len(CATEGORIES))
    chosen: list[Question] = []
    for category in CATEGORIES:
        pool = [q for q in questions if q.category == category]
        rng.shuffle(pool)
        chosen.extend(pool[:per])
    return chosen


async def _complete(messages: list[dict], model: str, temperature: float, *, json_object: bool = False) -> str:
    extra = {"json_object": True} if json_object else {}
    for attempt in range(RETRIES + 1):
        try:
            parts: list[str] = []
            async for delta in get_llm().stream_chat(messages, model=model, temperature=temperature, **extra):
                parts.append(delta)
            return "".join(parts).strip()
        except ApiError:
            if attempt == RETRIES:
                raise
            await asyncio.sleep(PAUSE_S * (attempt + 2))
    raise AssertionError("unreachable")


def context_key(result: Result) -> str:
    """Identifies what the model was given, so a graded answer is reused only
    while a variant still hands it exactly the same sources."""
    return hashlib.sha1("\x1f".join(c.text for c in result.context).encode()).hexdigest()[:16]


async def answer_one(question: Question, result: Result) -> dict:
    retrieved = [
        rag.Retrieved(document_id=c.document, document_name=c.document, content=c.text, locator=c.locator, similarity=0.0)
        for c in result.context
    ]
    messages, _ = rag.build_prompt(
        subspace_name=TOPIC_NAMES[question.topic],
        active_skill_instructions=[],
        history=list(question.history),
        question=question.question,
        retrieved=retrieved,
        answer_only_from_docs=True,
        always_show_citations=True,
        # As production does: tell the model when retrieval doubted its sources.
        sources_doubtful=getattr(result.found, "confidence", "good") == "weak",
    )
    raw = await _complete(messages, settings.groq_model, 0.4)
    answer, _ = rag.strip_invalid_citations(raw, len(retrieved))
    await asyncio.sleep(PAUSE_S)

    sources = "\n\n".join(f"[{i}] {c.text}" for i, c in enumerate(result.context, start=1)) or "(none were given)"
    verdict_raw = await _complete(
        [
            {
                "role": "user",
                "content": _JUDGE.format(
                    question=question.question,
                    reference=question.answer or "NOT COVERED by the material",
                    sources=sources,
                    answer=answer,
                ),
            }
        ],
        settings.groq_model_fast,
        0.0,
        json_object=True,
    )
    await asyncio.sleep(PAUSE_S)
    match = re.search(r"\{.*\}", verdict_raw, re.DOTALL)
    try:
        verdict = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        verdict = {}

    cited = sorted(set(rag.cited_markers(answer)))
    good = [n for n in cited if any(supports(result.context[n - 1].text, g) for g in question.evidence)]
    return {
        "id": question.id,
        "category": question.category,
        "context": context_key(result),
        "answer": answer,
        "judged": bool(verdict),
        "correct": bool(verdict.get("correct")),
        "refused": bool(verdict.get("refused")),
        "unsupported": bool(verdict.get("unsupported")),
        "cited": len(cited),
        "cited_right": len(good),
    }


async def run(pairs: list[tuple[Question, Result]], earlier: list[dict] | None = None) -> list[dict]:
    """Grade each pair. `earlier` rows are reused when the question was already
    graded on the same sources, so a re-run only pays for what changed."""
    done = {(r["id"], r.get("context")): r for r in earlier or [] if r.get("judged")}
    rows = []
    for question, result in pairs:
        if (kept := done.get((question.id, context_key(result)))) is not None:
            rows.append(kept)
            continue
        try:
            rows.append(await answer_one(question, result))
        except Exception as e:  # one failed call must not lose the rest of the run
            rows.append({"id": question.id, "category": question.category, "error": str(e)[:200]})
        print(f"  answered {len(rows)}/{len(pairs)}", flush=True)
    return rows


def summarise(rows: list[dict], questions: dict[str, Question]) -> dict:
    scored = [r for r in rows if r.get("judged")]
    answerable = [r for r in scored if questions[r["id"]].answerable]
    unanswerable = [r for r in scored if not questions[r["id"]].answerable]
    cited = sum(r["cited"] for r in answerable)

    def rate(items: list[dict], key: str) -> float | None:
        return round(sum(bool(r[key]) for r in items) / len(items), 4) if items else None

    return {
        "sampled": len(rows),
        "scored": len(scored),
        "correct": rate(scored, "correct"),
        "correct_answerable": rate(answerable, "correct"),
        "refused_when_unanswerable": rate(unanswerable, "refused"),
        "refused_when_answerable": rate(answerable, "refused"),
        "unsupported": rate(scored, "unsupported"),
        "citation_precision": round(sum(r["cited_right"] for r in answerable) / cited, 4) if cited else None,
        "answers_with_citations": rate(answerable, "cited"),
    }
