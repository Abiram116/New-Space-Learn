"""Does the tutor actually *obey* the student model? Measured, not assumed.

`tests/test_student_model_benchmark.py` proves the preference reaches the
prompt. That is necessary and not sufficient: a model can be told "open with a
concrete example" and open with a definition anyway. This asks the real model
the same question under different profiles and scores what comes back.

Run manually — it spends quota:

    uv run python scripts/bench_student_model.py
    uv run python scripts/bench_student_model.py --runs 3

**What it measures, and what it cannot.** The scores are deterministic proxies,
not judgements: length in words for the depth preference, and which of several
opening moves the first sentences match for the style preference. A proxy can be
gamed and does not understand the text. That is the honest trade — an LLM judge
would read better and would itself be an unvalidated model whose agreement with
a human nobody has measured. Proxies are at least reproducible, and a *relative*
comparison between two profiles is the claim being tested: not "is this answer
good" but "is this answer different in the direction the student asked for".

Exit code is non-zero if a preference shows no measurable effect, so this can
gate a release if you ever want it to.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.config import settings
from app.services import personalization
from app.services import student_model as sm
from app.services.llm import get_llm

#: Where each run is appended. A single result is an anecdote — the value of
#: this file is that a regression shows up as a trend rather than as one bad
#: afternoon, and that the numbers quoted in the docs can be checked against
#: something rather than taken on trust.
HISTORY = Path(__file__).resolve().parents[2] / "docs" / "engineering" / "bench-history.jsonl"

#: Depth must produce a visibly longer answer. Deliberately well below the
#: observed effect (~6.8x): the claim under test is directional, and a
#: threshold set near the observed value would fail on sampling variance
#: rather than on a real regression.
DEPTH_RATIO_MIN = 1.30

#: One question, asked identically under every profile. Fixed and neutral so
#: the only variable is the student model.
QUESTION = "What is a derivative?"

PROFILES: dict[str, dict] = {
    "(none)": {},
    "examples + short": {
        "learning_style": "examples first, then the general rule",
        "teaching_preference": "Keep explanations short and direct.",
    },
    "formal + deep": {
        "learning_style": "the precise definition first, then examples",
        "teaching_preference": (
            "Go into real depth; I would rather have too much than too little."
        ),
    },
}

#: Openings that indicate the answer led with a worked case.
EXAMPLE_MARKERS = (
    "imagine", "suppose", "think of", "consider a", "say you", "picture",
    "for example", "a car", "speedometer",
)
#: Openings that indicate the answer led with the formal statement.
FORMAL_MARKERS = (
    "the derivative of", "formally", "by definition", "is defined as",
    "the limit", "let f", "f(x)",
)


@dataclass
class Result:
    profile: str
    words: list[int] = field(default_factory=list)
    opened_example: int = 0
    opened_formal: int = 0
    opened_mixed: int = 0

    @property
    def mean_words(self) -> float:
        return sum(self.words) / len(self.words) if self.words else 0.0


def _style_verdict(wanted: int, other: int, mixed: int) -> tuple[str, bool]:
    """Three outcomes, not two.

    The first version compared `wanted > other` and called anything else a
    failure — so a run where every opening classified as `mixed` (0 vs 0) was
    reported as the preference being ignored. It was not: the marker sets
    simply could not tell, which is a limit of the proxy rather than a fact
    about the product.

    Conflating "the model did the opposite" with "the measurement was
    inconclusive" is how a benchmark trains you to ignore it. Only the former
    fails the run.
    """
    if wanted > other:
        return "PASS", False
    if other > wanted:
        return "FAIL", True
    if mixed:
        return "INCONCLUSIVE", False
    return "FAIL", True


def _snap(model: dict) -> sm.Snapshot:
    return sm.Snapshot(
        settings={"student_model": model},
        topics=[],
        concepts=[],
        activity_days=[],
        streak_days=0,
        feedback=[],
    )


def _opening(text: str) -> str:
    """Classify the first two sentences by which markers they contain."""
    head = " ".join(re.split(r"(?<=[.!?])\s+", text.strip())[:2]).lower()
    ex = any(m in head for m in EXAMPLE_MARKERS)
    fm = any(m in head for m in FORMAL_MARKERS)
    if ex and not fm:
        return "example"
    if fm and not ex:
        return "formal"
    return "mixed"


async def _ask(profile_model: dict) -> str:
    context = personalization.render(_snap(profile_model), "chat")
    system = "You are a study tutor. Answer the student's question."
    if context:
        system += f"\n\n{context}"
    parts: list[str] = []
    async for delta in get_llm().stream_chat(
        [{"role": "system", "content": system}, {"role": "user", "content": QUESTION}],
        model=settings.groq_model,
        temperature=0.4,
    ):
        parts.append(delta)
    return "".join(parts)


async def main(runs: int) -> int:
    if not settings.llm_configured:
        print("LLM is not configured — nothing to measure.")
        return 2

    results = {name: Result(name) for name in PROFILES}
    for name, model in PROFILES.items():
        for i in range(runs):
            text = await _ask(model)
            r = results[name]
            r.words.append(len(text.split()))
            opening = _opening(text)
            if opening == "example":
                r.opened_example += 1
            elif opening == "formal":
                r.opened_formal += 1
            else:
                r.opened_mixed += 1
            print(f"  {name:18s} run {i + 1}/{runs}: {len(text.split()):4d} words, opened {opening}")

    print(f"\n{'profile':20s} {'mean words':>11s} {'example-led':>12s} {'formal-led':>11s}")
    print("-" * 58)
    for r in results.values():
        print(
            f"{r.profile:20s} {r.mean_words:11.0f} "
            f"{r.opened_example:>11d}/{runs} {r.opened_formal:>10d}/{runs}"
        )

    short = results["examples + short"]
    deep = results["formal + deep"]

    print("\nverdict")
    failures = 0

    # Depth: the deep profile must produce visibly more text than the short one.
    ratio = deep.mean_words / short.mean_words if short.mean_words else 0
    ok = ratio >= DEPTH_RATIO_MIN
    failures += 0 if ok else 1
    print(
        f"  depth preference   {'PASS' if ok else 'FAIL'}  "
        f"deep/short length ratio {ratio:.2f} (want >= {DEPTH_RATIO_MIN:.2f})"
    )

    # Style: each profile should lead the way it asked for, more often than not.
    verdict, bad = _style_verdict(short.opened_example, short.opened_formal, short.opened_mixed)
    failures += 1 if bad else 0
    print(
        f"  example-first      {verdict:12s}  "
        f"{short.opened_example}/{runs} example-led, {short.opened_formal} formal-led, "
        f"{short.opened_mixed} unclassified"
    )

    verdict, bad = _style_verdict(deep.opened_formal, deep.opened_example, deep.opened_mixed)
    failures += 1 if bad else 0
    print(
        f"  definition-first   {verdict:12s}  "
        f"{deep.opened_formal}/{runs} formal-led, {deep.opened_example} example-led, "
        f"{deep.opened_mixed} unclassified"
    )

    print(
        f"\n{failures} of 3 checks failed."
        if failures
        else "\nAll checks passed — the stated preferences are visible in the output."
    )

    _record(results, ratio, runs, failures)
    return 1 if failures else 0


def _record(results: dict[str, Result], ratio: float, runs: int, failures: int) -> None:
    """Append this run to the history file.

    Written as JSON Lines because the interesting operation is "append one run
    and diff against the last", which a line-oriented format supports without
    parsing the whole history or rewriting it.
    """
    entry = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "runs_per_profile": runs,
        "model": settings.groq_model,
        "question": QUESTION,
        "depth_ratio": round(ratio, 2),
        "depth_ratio_min": DEPTH_RATIO_MIN,
        "failures": failures,
        "profiles": {
            name: {
                "mean_words": round(r.mean_words, 1),
                "opened_example": r.opened_example,
                "opened_formal": r.opened_formal,
                "opened_mixed": r.opened_mixed,
            }
            for name, r in results.items()
        },
    }
    try:
        HISTORY.parent.mkdir(parents=True, exist_ok=True)
        with HISTORY.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
        print(f"recorded to {HISTORY.relative_to(HISTORY.parents[2])}")
    except OSError as e:
        # Never fail the benchmark over bookkeeping — the measurement is the
        # point, the history is the convenience.
        print(f"(could not write history: {e})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--runs",
        type=int,
        default=2,
        help="samples per profile. The model is sampled, so one run is an anecdote.",
    )
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.runs)))
