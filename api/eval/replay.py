"""Replay saved answers through citation post-processing, for free.

`answers.py` pays for model calls (about fifteen minutes of free-tier quota for 36
questions). Citation hygiene is plain string work done AFTER the model answers, so
it does not need new answers to evaluate: take the answers already graded, give
them back the exact sources they were written from (retrieval is free and
deterministic), run a post-processing step over them, and score the citations.

    cd api && uv run python -m eval.replay [variant]

Prints citation precision (of the [[n]] markers in the answers, the share pointing
at a source that really holds the evidence) and coverage (answers that still carry
a citation), for each candidate step, plus every marker that is still wrong.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Callable

from app.services import rag

from .bench import RESULTS
from .corpus import documents, questions, supports
from .index import Embedder
from .variants import VARIANTS

Step = Callable[[str, list[str]], str]

_MARK = re.compile(r"\[\[(\d+)\]\]")


def identity(text: str, sources: list[str]) -> str:
    return text


def tighten(text: str, sources: list[str]) -> str:
    return rag.tighten_citations(text, sources)[0]


STEPS: dict[str, Step] = {
    "as saved": identity,
    "+ tighten_citations": tighten,
}


def load(variant: str):
    # "v2-5-judge-notes" is the pipeline `v2-5-judge` run on the `notes` topic alone.
    base = variant.rpartition("-")[0]
    if base not in VARIANTS:
        base = variant
    qs = {q.id: q for q in questions()}
    saved = json.loads((RESULTS / f"{variant}.json").read_text())
    rows = [r for r in saved["answer_rows"] if r.get("judged") and qs[r["id"]].answerable]
    chosen = [qs[r["id"]] for r in rows]
    v = VARIANTS[base]()
    embedder = Embedder()
    v.index(documents(), embedder)
    contexts = {q.id: [c.text for c in v.search(q).context] for q in chosen}
    embedder.save()
    return qs, rows, contexts


def score(qs, rows, contexts, step: Step, *, show: bool = False) -> dict:
    cited = good = with_cite = 0
    misses: list[str] = []
    for r in rows:
        q = qs[r["id"]]
        sources = contexts[r["id"]]
        text = step(r["answer"], sources)
        marks = sorted({int(n) for n in _MARK.findall(text) if 1 <= int(n) <= len(sources)})
        cited += len(marks)
        with_cite += bool(marks)
        for n in marks:
            if any(supports(sources[n - 1], g) for g in q.evidence):
                good += 1
            elif show:
                best = max(range(len(sources)), key=lambda k: rag.support(text, sources[k]))
                misses.append(f"{r['id']} [[{n}]] (best source for the text would be [{best + 1}])")
    n = len(rows)
    return {
        "answers": n,
        "cited": cited,
        "good": good,
        "precision": round(good / cited, 4) if cited else None,
        "coverage": round(with_cite / n, 4) if n else None,
        "misses": misses,
    }


def main() -> None:
    variant = sys.argv[1] if len(sys.argv) > 1 else "v2-5-judge"
    qs, rows, contexts = load(variant)
    print(f"{len(rows)} answerable graded answers from {variant}\n")
    for name, step in STEPS.items():
        s = score(qs, rows, contexts, step, show=(name == "as saved"))
        print(f"{name:<28} precision {s['precision']}  ({s['good']}/{s['cited']})  coverage {s['coverage']}")
        if name == "as saved":
            for m in s["misses"]:
                print("    wrong:", m)


if __name__ == "__main__":
    main()
