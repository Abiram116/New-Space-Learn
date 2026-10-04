"""Can a cheaper prompt, or a smaller model, answer as well?

Three arms on the same questions, the same retrieved sources and the same judge:

  A  the large model, the original prompt (full shape guidance, full diagram rule)
  B  the large model, the current prompt (short guidance for plainly simple questions)
  C  the small model, the current prompt

Each answer is graded as in `answers.py`: correct, refused, unsupported. What this
cannot grade is how an answer *looks* (headings, length); it grades whether it is
right and supported. So it can rule a change out, and cannot on its own rule it in.

    uv run python -m eval.route_check --arm B --n 18 &
    uv run python -m eval.route_check --arm C --n 18
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.config import settings
from app.services import rag, voice

from . import answers
from .corpus import documents, questions
from .index import Embedder
from .variants import VARIANTS

RESULTS = Path(__file__).parent / "results"


def _original_prompt(on: bool) -> None:
    """Switch `build_prompt` back to always sending the full guidance."""
    rag.shape_for = (lambda q: voice.RESPONSE_SHAPE) if on else voice.shape_for
    rag.wants_diagram = (lambda q: True) if on else voice.wants_diagram


def _no_fallback() -> None:
    """Production falls back to the other model when one is rate-limited. Here that would
    quietly answer an arm with the wrong model and make the comparison meaningless, so a
    refusal is an error and the question is recorded as one."""
    from app.services.llm import get_llm

    type(get_llm())._chain = lambda self, model, messages: [model or settings.groq_model]  # noqa: SLF001


async def run_arm(name: str, model: str, original: bool, pairs, pause: float) -> list[dict]:
    _original_prompt(original)
    _no_fallback()
    answers.PAUSE_S = pause
    rows = []
    for q, r in pairs:
        try:
            rows.append(await answers.answer_one(q, r, model))
        except Exception as e:  # noqa: BLE001
            rows.append({"id": q.id, "category": q.category, "error": str(e)[:200]})
        print(f"  [{name}] {len(rows)}/{len(pairs)}", flush=True)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=24)
    parser.add_argument("--pause", type=float, default=15.0)
    parser.add_argument("--arm", choices=["A", "B", "C"], required=True, help="one arm per process: the two models have separate rate limits, so B and C can run at once")
    args = parser.parse_args()
    variant = VARIANTS["v2-5-judge"]()
    embedder = Embedder()
    variant.index(documents(), embedder)
    qs = questions()
    chosen = answers.sample(qs, args.n)
    pairs = [(q, variant.search(q)) for q in chosen]
    by_id = {q.id: q for q in qs}
    arms = [
        ("A large, original prompt", settings.groq_model, True),
        ("B large, current prompt", settings.groq_model, False),
        ("C small, current prompt", settings.groq_model_fast, False),
    ]
    name, model, original = next(a for a in arms if a[0].startswith(args.arm + " "))
    rows = asyncio.run(run_arm(name, model, original, pairs, args.pause))
    out = {"arm": name, "model": model, "n": len(pairs), "summary": answers.summarise(rows, by_id), "rows": rows}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"route_check_{args.arm}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(name, json.dumps(out["summary"]), flush=True)
    embedder.save()


if __name__ == "__main__":
    main()
