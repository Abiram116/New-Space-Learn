"""Does every stage earn its place?

    uv run python -m eval.ablate              # retrieval: remove one stage at a time
    uv run python -m eval.ablate --warning    # answers: with and without the "doubtful sources" warning

`RESULTS.md` adds the stages one at a time, which flatters whichever comes
later. This asks the opposite question of the finished pipeline: take ONE
stage out and see what is lost. A stage whose removal changes nothing is a
stage to delete.

`--warning` checks the one stage retrieval metrics cannot see. When retrieval
doubts its sources it passes them with a warning to the model; whether that
warning changes what the model says can only be measured on answers. It asks
the model every question the documents do not cover, and every covered
question that was wrongly doubted, once with the warning and once without
(four model calls per question, paced for a free-tier key).

Both write `eval/ABLATION.md`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import replace
from pathlib import Path

from app.services import retrieval

from . import answers, metrics
from .corpus import documents, questions
from .index import Embedder
from .variants import Final, Result

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results" / "ablation.json"

ON = retrieval.DEFAULT
REMOVALS = {
    "(nothing removed: production)": ON,
    "query prefix": replace(ON, query_prefix=""),
    "keyword search": replace(ON, keyword=False),
    "follow-up rewrite": replace(ON, resolve_followups=False),
    "adjacent promotion": replace(ON, adjacent=False),
    "six chunks (back to four)": replace(ON, max_chunks=4),
}
KEYS = ("hit@1", "hit@5", "context_hit", "context_full", "context_chars")


def _load() -> dict:
    return json.loads(OUT.read_text()) if OUT.exists() else {}


def retrieval_ablation() -> dict:
    variant = Final()
    embedder = Embedder()
    variant.index(documents(), embedder)
    out = {}
    for label, config in REMOVALS.items():
        variant.config = config
        rows = [metrics.score(q, variant.search(q)) for q in questions()]
        report = metrics.report(rows)
        out[label] = {
            "all": {k: report["all"][k] for k in KEYS},
            "test": {k: report["test"][k] for k in KEYS},
            "followup": report["by_category"]["followup"]["context_hit"],
            "exact": report["by_category"]["exact"]["context_hit"],
        }
        print(f"{label:32} reached the model {report['all']['context_hit']:.1%}  (test {report['test']['context_hit']:.1%})")
    embedder.save()
    return out


def warning_check() -> dict:
    variant = Final()
    embedder = Embedder()
    variant.index(documents(), embedder)
    doubted: list[tuple] = []
    for q in questions():
        result = variant.search(q)
        if result.found.confidence == "weak":
            doubted.append((q, result))
    embedder.save()
    print(f"{len(doubted)} questions were passed with doubtful sources "
          f"({sum(not q.answerable for q, _ in doubted)} not covered, {sum(q.answerable for q, _ in doubted)} covered)")

    by_id = {q.id: q for q in questions()}
    earlier = _load().get("warning", {})
    out = {}
    for label, confidence in (("with the warning", "weak"), ("without it", "good")):
        pairs = []
        for q, r in doubted:
            found = replace(r.found, confidence=confidence)
            pairs.append((q, Result(ranking=r.ranking, context=r.context, found=found)))
        rows = asyncio.run(answers.run(pairs, earlier.get(label, {}).get("rows")))
        judged = [r for r in rows if r.get("judged")]
        no = [r for r in judged if not by_id[r["id"]].answerable]
        yes = [r for r in judged if by_id[r["id"]].answerable]
        out[label] = {
            "refused_uncovered": [sum(r["refused"] for r in no), len(no)],
            "unsupported_uncovered": [sum(r["unsupported"] for r in no), len(no)],
            "correct_covered": [sum(r["correct"] for r in yes), len(yes)],
            "refused_covered": [sum(r["refused"] for r in yes), len(yes)],
            "rows": rows,
        }
        print(label, {k: v for k, v in out[label].items() if k != "rows"})
    return out


def write(data: dict) -> None:
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    lines = ["# Ablation: what each stage is worth", "", "Rebuilt by `python -m eval.ablate`. Production's pipeline with one stage removed at a time.", ""]
    if "retrieval" in data:
        lines += [
            "## Retrieval",
            "",
            "| Removed | Ranked first | Reached the model | …held-out test | Follow-ups reached | Exact terms reached | Characters sent |",
            "|---|---|---|---|---|---|---|",
        ]
        for label, r in data["retrieval"].items():
            lines.append(
                f"| {label} | {r['all']['hit@1']:.1%} | {r['all']['context_hit']:.1%} | {r['test']['context_hit']:.1%} "
                f"| {r['followup']:.1%} | {r['exact']:.1%} | {r['all']['context_chars']} |"
            )
        lines.append("")
    if "warning" in data:
        lines += [
            "## The “doubtful sources” warning (graded answers)",
            "",
            "Every question retrieval passed on as doubtful, answered twice.",
            "",
            "| | Refused an uncovered question | Unsupported claim on one | Correct on a covered question | Wrongly refused one |",
            "|---|---|---|---|---|",
        ]
        for label, r in data["warning"].items():
            cell = lambda pair: f"{pair[0]} of {pair[1]}"  # noqa: E731
            lines.append(
                f"| {label} | {cell(r['refused_uncovered'])} | {cell(r['unsupported_uncovered'])} "
                f"| {cell(r['correct_covered'])} | {cell(r['refused_covered'])} |"
            )
        lines.append("")
    (ROOT / "ABLATION.md").write_text("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--warning", action="store_true", help="grade answers with and without the warning (model calls)")
    args = parser.parse_args()
    data = _load()
    if args.warning:
        data["warning"] = warning_check()
    else:
        data["retrieval"] = retrieval_ablation()
    write(data)
    print(f"\nwrote {ROOT / 'ABLATION.md'}")


if __name__ == "__main__":
    main()
