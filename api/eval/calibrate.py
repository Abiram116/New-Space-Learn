"""Fits the "do the documents cover this?" thresholds, and shows the evidence.

    uv run python -m eval.calibrate

The pipeline doubts the material when the best match is both far in meaning
and shares little of the question's wording (see `retrieval.judge`). It has
two tiers — "none" passes no sources, "weak" passes them with a warning — and
each is a pair of thresholds. They are chosen here on the `tune` questions
only: the pair that catches the most uncovered questions while catching at
most the allowed share of covered ones. They are then scored on the `test`
questions, which played no part in choosing them. Copy the result into
`RetrievalConfig`'s defaults.
"""

from __future__ import annotations

from dataclasses import replace

from .corpus import documents, questions
from .index import Embedder
from .variants import Resolve

#: The share of covered tune questions each tier may catch by mistake. "none"
#: passes no sources, so it may catch nobody; "weak" only adds a warning.
NONE_ALLOWED = 0.0
WEAK_ALLOWED = 0.07


def features() -> list[dict]:
    variant = Resolve()
    variant.config = replace(variant.config, judge=False)
    embedder = Embedder()
    variant.index(documents(), embedder)
    rows = []
    for q in questions():
        found = variant.search(q).found
        rows.append(
            {
                "id": q.id,
                "split": q.split,
                "answerable": q.answerable,
                "similarity": max((c.similarity for c in found.ranking), default=0.0),
                "coverage": max((c.keyword_coverage for c in found.ranking), default=0.0),
            }
        )
    embedder.save()
    return rows


def rates(rows: list[dict], similarity: float, coverage: float) -> tuple[float, float]:
    """(share of uncovered questions below both thresholds, share of covered ones)."""

    def below(r: dict) -> bool:
        return r["similarity"] < similarity and r["coverage"] < coverage

    no = [r for r in rows if not r["answerable"]]
    yes = [r for r in rows if r["answerable"]]
    return sum(map(below, no)) / max(1, len(no)), sum(map(below, yes)) / max(1, len(yes))


def fit(rows: list[dict], allowed: float) -> tuple[float, float]:
    tune = [r for r in rows if r["split"] == "tune"]
    best = (0.0, 0.0, 0.0)  # (caught, similarity, coverage)
    for s in [x / 100 for x in range(50, 91)]:
        for c in [x / 20 for x in range(0, 23)]:
            caught, wrong = rates(tune, s, c)
            # Most caught; then the gentlest thresholds that achieve it.
            if wrong <= allowed and (caught, -s, -c) > (best[0], -best[1], -best[2]):
                best = (caught, s, c)
    return best[1], best[2]


def main() -> None:
    rows = features()
    for label, answerable in (("covered", True), ("NOT covered", False)):
        sims = sorted(r["similarity"] for r in rows if r["answerable"] == answerable)
        cov = sorted(r["coverage"] for r in rows if r["answerable"] == answerable)
        print(
            f"{label:12} n={len(sims):3}  similarity min {sims[0]:.3f} median {sims[len(sims) // 2]:.3f} max {sims[-1]:.3f}"
            f"   coverage min {cov[0]:.2f} median {cov[len(cov) // 2]:.2f} max {cov[-1]:.2f}"
        )
    for tier, allowed in (("none", NONE_ALLOWED), ("weak", WEAK_ALLOWED)):
        similarity, coverage = fit(rows, allowed)
        print(f"\n{tier}_similarity={similarity:.2f}  {tier}_coverage={coverage:.2f}")
        for split in ("tune", "test"):
            caught, wrong = rates([r for r in rows if r["split"] == split], similarity, coverage)
            print(f"  {split}: catches {caught:.0%} of uncovered questions and {wrong:.1%} of covered ones")


if __name__ == "__main__":
    main()
