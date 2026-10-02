"""What a run is scored on. Pure functions over (question, result) pairs."""

from __future__ import annotations

from statistics import median

from .corpus import CATEGORIES, Question, supports
from .variants import Chunk, Result

KS = (1, 3, 5)


def first_hit(question: Question, chunks: list[Chunk]) -> int | None:
    """1-based position of the first chunk that supports any part of the answer."""
    for position, chunk in enumerate(chunks, start=1):
        if any(supports(chunk.text, group) for group in question.evidence):
            return position
    return None


def covered(question: Question, chunks: list[Chunk]) -> float:
    """The share of the answer's parts that some chunk supports (1.0 = all)."""
    if not question.evidence:
        return 0.0
    return sum(any(supports(c.text, group) for c in chunks) for group in question.evidence) / len(question.evidence)


def score(question: Question, result: Result) -> dict:
    row: dict = {"id": question.id, "category": question.category, "split": question.split, "query": result.query}
    row["abstained"] = result.abstained
    row["context_chars"] = sum(len(c.text) for c in result.context)
    row["ms"] = round(result.ms, 2)
    if question.answerable:
        rank = first_hit(question, result.ranking)
        row["rank"] = rank
        for k in KS:
            row[f"hit@{k}"] = rank is not None and rank <= k
        row["rr"] = 1 / rank if rank else 0.0
        row["context_hit"] = first_hit(question, result.context) is not None
        row["context_full"] = covered(question, result.context) == 1.0
    return row


def _mean(values: list) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def summarise(rows: list[dict]) -> dict:
    answerable = [r for r in rows if "rank" in r]
    unanswerable = [r for r in rows if "rank" not in r]
    out = {
        "questions": len(rows),
        "answerable": len(answerable),
        **{f"hit@{k}": _mean([r[f"hit@{k}"] for r in answerable]) for k in KS},
        "mrr": _mean([r["rr"] for r in answerable]),
        # The answer reached the model at all / in full.
        "context_hit": _mean([r["context_hit"] for r in answerable]),
        "context_full": _mean([r["context_full"] for r in answerable]),
        # Said "not in your documents" when it was not / when it was.
        "abstain_when_unanswerable": _mean([r["abstained"] for r in unanswerable]),
        "abstain_when_answerable": _mean([r["abstained"] for r in answerable]),
        "context_chars": round(median(r["context_chars"] for r in rows)) if rows else 0,
        "search_ms": round(median(r["ms"] for r in rows), 2) if rows else 0,
    }
    return out


def report(rows: list[dict]) -> dict:
    return {
        "all": summarise(rows),
        "test": summarise([r for r in rows if r["split"] == "test"]),
        "tune": summarise([r for r in rows if r["split"] == "tune"]),
        "by_category": {c: summarise([r for r in rows if r["category"] == c]) for c in CATEGORIES},
    }
