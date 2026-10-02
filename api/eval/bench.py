"""Run a retrieval variant over the benchmark and record how it did.

    uv run python -m eval.bench                       # the baseline, retrieval only
    uv run python -m eval.bench --variant baseline --answers 36
    uv run python -m eval.bench --table               # rebuild RESULTS.md from saved runs

Everything runs on this machine against the documents in `eval/corpus/`: no
database is read or written. Retrieval costs nothing to run. `--answers N` also
asks the model N questions and grades them (2N model calls on your Groq key).

Each run is saved to `eval/results/<variant>.json`, and `RESULTS.md` lists every
saved run side by side — the before/after record for each change.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from . import answers, metrics
from .corpus import documents, questions
from .index import Embedder
from .variants import VARIANTS

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"

COLUMNS = [
    ("hit@1", "Found, rank 1"),
    ("hit@3", "Found, top 3"),
    ("hit@5", "Found, top 5"),
    ("mrr", "Mean rank score"),
    ("context_hit", "Answer reached the model"),
    ("context_full", "…in full"),
    ("abstain_when_unanswerable", "Said “not covered” when it wasn’t"),
    ("abstain_when_answerable", "Wrongly said “not covered”"),
    ("context_chars", "Characters sent"),
    ("search_ms", "Search ms"),
]
ANSWER_COLUMNS = [
    ("correct", "Correct"),
    ("refused_when_unanswerable", "Refused when not covered"),
    ("unsupported", "Unsupported claims"),
    ("citation_precision", "Citation precision"),
]


#: Plain numbers; every other column is a share and is shown as a percentage.
RAW = {"context_chars", "search_ms", "sampled", "scored"}


def _cell(value: object, key: str = "") -> str:
    if value is None:
        return "—"
    return str(value) if key in RAW else f"{float(value) * 100:.1f}%"


def check_questions() -> None:
    """Every quote a question relies on must really be in its topic's documents
    — otherwise the question can never be scored as found, for any pipeline."""
    from app.services.embeddings import extract_pdf_text

    from .corpus import squash

    text: dict[str, str] = {}
    for doc in documents():
        text[doc.topic] = text.get(doc.topic, "") + squash(extract_pdf_text(doc.data))
    missing = [
        f"{q.id}: {quote!r}" for q in questions() for group in q.evidence for quote in group if squash(quote) not in text[q.topic]
    ]
    if missing:
        raise SystemExit("These quotes are not in the documents:\n  " + "\n  ".join(missing))


def run(name: str, n_answers: int) -> dict:
    check_questions()
    variant = VARIANTS[name]()
    embedder = Embedder()
    print(f"indexing for “{name}”…")
    variant.index(documents(), embedder)
    qs = questions()
    results = [variant.search(q) for q in qs]
    embedder.save()
    embed_ms = embedder.time_one([q.question for q in qs[:12]])

    rows = [metrics.score(q, r) for q, r in zip(qs, results, strict=True)]
    out = {
        "variant": name,
        "description": variant.description,
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "chunks": sum(len(c) for c in getattr(variant, "chunks", {}).values()),
        # Embedding one question, uncached, on THIS machine. Production's tenth
        # of a CPU is far slower; compare variants with it, not with Render.
        "embed_ms": embed_ms,
        "retrieval": metrics.report(rows),
        "rows": rows,
    }
    if n_answers:
        by_id = {q.id: (q, r) for q, r in zip(qs, results, strict=True)}
        chosen = answers.sample(qs, n_answers)
        print(f"asking the model {len(chosen)} questions…")
        saved = RESULTS / f"{name}.json"
        earlier = json.loads(saved.read_text()).get("answer_rows") if saved.exists() else None
        answer_rows = asyncio.run(answers.run([by_id[q.id] for q in chosen], earlier))
        out["answers"] = answers.summarise(answer_rows, {q.id: q for q in qs})
        out["answer_rows"] = answer_rows
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out


def table() -> str:
    runs = sorted((json.loads(p.read_text()) for p in RESULTS.glob("*.json")), key=lambda r: r["ran_at"])
    lines = [
        "# Retrieval benchmark results",
        "",
        "One row per pipeline, oldest first, on the same documents and questions",
        "(`eval/corpus/`, `eval/questions.json`). Rebuilt by `python -m eval.bench --table`.",
        "",
        "## Retrieval — held-out test questions",
        "",
        "Thresholds are only ever tuned on the other questions, so these numbers are honest.",
        "",
        "| Pipeline | " + " | ".join(label for _, label in COLUMNS) + " |",
        "|---|" + "---|" * len(COLUMNS),
    ]
    for r in runs:
        test = r["retrieval"]["test"]
        lines.append(f"| `{r['variant']}` | " + " | ".join(_cell(test[key], key) for key, _ in COLUMNS) + " |")
    lines += ["", "## Retrieval — by kind of question (all questions, answer found in the top 5)", ""]
    cats = list(runs[0]["retrieval"]["by_category"]) if runs else []
    lines += ["| Pipeline | " + " | ".join(cats) + " |", "|---|" + "---|" * len(cats)]
    for r in runs:
        cells = []
        for c in cats:
            s = r["retrieval"]["by_category"][c]
            cells.append(_cell(s["abstain_when_unanswerable"] if c == "unanswerable" else s["hit@5"]))
        lines.append(f"| `{r['variant']}` | " + " | ".join(cells) + " |")
    lines += ["", "For `unanswerable` the figure is how often the pipeline passed no sources.", ""]
    answered = [r for r in runs if r.get("answers")]
    if answered:
        lines += ["## Answers — a graded sample", "", "| Pipeline | Graded | " + " | ".join(label for _, label in ANSWER_COLUMNS) + " |", "|---|---|" + "---|" * len(ANSWER_COLUMNS)]
        for r in answered:
            a = r["answers"]
            lines.append(f"| `{r['variant']}` | {a['scored']} | " + " | ".join(_cell(a[key], key) for key, _ in ANSWER_COLUMNS) + " |")
        lines.append("")
    lines += ["## What each pipeline is", ""] + [f"- **`{r['variant']}`** — {r['description']} ({r['chunks']} chunks; run {r['ran_at'][:10]})" for r in runs]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--variant", default="baseline", choices=sorted(VARIANTS))
    parser.add_argument("--answers", type=int, default=0, metavar="N", help="also grade N model answers (2N model calls)")
    parser.add_argument("--table", action="store_true", help="only rebuild RESULTS.md from saved runs")
    args = parser.parse_args()
    if not args.table:
        out = run(args.variant, args.answers)
        for split in ("test", "all"):
            print(f"\n{split}:")
            for key, label in COLUMNS:
                print(f"  {label:<40} {_cell(out['retrieval'][split][key], key)}")
        if "answers" in out:
            print("\nanswers:")
            for key, value in out["answers"].items():
                print(f"  {key:<40} {_cell(value, key)}")
    (ROOT / "RESULTS.md").write_text(table())
    print(f"\nwrote {ROOT / 'RESULTS.md'}")


if __name__ == "__main__":
    main()
