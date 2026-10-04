"""One report over everything the evaluation suite has measured: `eval/REPORT.md`.

    uv run python -m eval.report            # rebuild it from saved results (free, no model calls)
    uv run python -m eval.report --free     # re-run the checks that need no model first, then rebuild

It is the one file to read or send. Nothing here calls a model: it reads what the
other scripts saved in `results/`, and says when each was last run, so a stale number
looks stale.

| Script | Measures | Saves |
|---|---|---|
| `bench` | retrieval; with `--answers N`, graded answers | `results/<variant>.json`, `RESULTS.md` |
| `ablate` | what each retrieval stage is worth; the doubtful-sources warning | `results/ablation.json`, `ABLATION.md` |
| `route_check` | the cheaper prompt and the small model, answer by answer | `results/route_check_<arm>.json` |
| `agents` | flashcards (quizzes come from `quiz_check`) | `results/agents.json` |
| `quiz_check` | quiz coverage and question soundness | `results/quizzes.json` |
| `system` | prompt size, history budget, caches, tiers, capacity, latency, invariants | `results/system.json` |
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import agents, system

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"

PRUNING = """Idea: send the model only the sentences of each retrieved passage that share terms with the question
(plus the sentence either side, and always the first), to save tokens. Tried on the 98 answerable questions with
production's own retrieval:

| | Before pruning | After pruning |
|---|---|---|
| Evidence reached the model | 90 of 98 (91.8%) | 88 of 98 (89.8%) |
| Characters sent | 391,547 | 362,090 (7.5% fewer) |

It changed the passages for 51 of 98 questions, saved about a twelfth of the text, and lost the evidence for two
(the steps of the three-way handshake, and how cacti take in carbon). Passages here are short and on topic, so there
is little to cut and a real chance of cutting the one sentence that mattered. **Rejected**; worth measuring again
only if chunks get longer."""


def load(name: str) -> dict | None:
    path = RESULTS / name
    return json.loads(path.read_text()) if path.exists() else None


def pct(x: object) -> str:
    return f"{x:.1%}" if isinstance(x, int | float) else "—"


def demote(md: str, by: int = 1) -> str:
    return "\n".join(("#" * by + line if line.startswith("#") else line) for line in md.splitlines())


def rag_section() -> list[str]:
    L = ["## 1. RAG: finding the right passage, and what the model then says", ""]
    final = load("v2-5-judge.json")
    if final:
        r = final["retrieval"]["all"]
        L += [f"Production's retrieval (`{final['variant']}`, run {final['ran_at'][:10]}) on all {len(final['rows'])} benchmark questions. The questions are direct, reworded, follow-ups, exact-term, cross-section and unanswerable.", "", "| Measure | Result |", "|---|---|"]
        for key, label in (("hit@1", "Right passage ranked first"), ("hit@5", "…within the top five"), ("context_hit", "Evidence reached the model"), ("context_full", "All parts of a multi-part answer reached it")):
            if key in r:
                L.append(f"| {label} | {pct(r[key])} |")
        a = final.get("answers")
        if a:
            L += ["", "Graded answers (a sample; the model's own answer judged against a reference):", "", "| Measure | Result |", "|---|---|"]
            for key, label in (("sampled", "Questions sampled"), ("correct", "Correct"), ("refused_when_unanswerable", "Refused when the documents don't cover it"), ("unsupported", "Made an unsupported claim"), ("citation_precision", "Citations pointing at the right passage")):
                v = a.get(key)
                L.append(f"| {label} | {v if key == 'sampled' else pct(v)} |")
        L.append("")
    else:
        L += ["No retrieval run saved: `python -m eval.bench --variant v2-5-judge --answers 36`.", ""]

    L += ["### A cheaper prompt, and a smaller model", "", "Same questions, same retrieved sources, same judge. Correct / unsupported are shares of the questions graded."]
    arms = [load(f"route_check_{k}.json") for k in "ABC"]
    if any(arms):
        L += ["", "| Arm | Model | Questions | Correct | Refused when uncovered | Unsupported | Citations right |", "|---|---|---|---|---|---|---|"]
        for v in arms:
            if v:
                s = v["summary"]
                L.append(f"| {v['arm']} | `{v['model']}` | {s['scored']} | {pct(s['correct'])} | {pct(s['refused_when_unanswerable'])} | {pct(s['unsupported'])} | {pct(s['citation_precision'])} |")
        L += ["", "Reading it: the shorter prompt costs nothing in correctness here, and citations were no worse. The small model matches on correctness but cites the right passage less often and makes twice the unsupported claims, so chat stays on the large model. 18 questions is a small sample: this can rule a change out; it cannot on its own rule one in. It grades whether answers are right and supported, not how they look."]
    else:
        L += ["", "Not run: `python -m eval.route_check --arm A|B|C`."]
    L += ["", "### Measured and rejected: pruning passages", "", PRUNING, ""]
    return L


def appendix() -> list[str]:
    L = ["## Appendix: the retrieval write-ups, in full", ""]
    for name, title in (("RESULTS.md", "A. Retrieval, one stage added at a time"), ("ABLATION.md", "B. Each stage removed in turn")):
        path = ROOT / name
        if path.exists():
            L += [f"### {title}", "", demote(path.read_text().strip(), 2), ""]
    L += ["## How to re-run", "", "```", "uv run python -m eval.report --free   # prompt size, caches, tiers, capacity, test suite (seconds, no model)", "uv run python -m eval.system --live    # also time the real model (uses the Groq key)", "uv run python -m eval.bench --variant v2-5-judge --answers 36     # retrieval + graded answers", "uv run python -m eval.route_check --arm B   # --arm C in a second terminal; they use different models", "uv run python -m eval.agents --cards", "uv run python -m eval.quiz_check --questions", "```", "", "Everything that calls a model is paced for a free-tier key and spends from its daily allowance. Use a key that is not the one production runs on."]
    return L


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--free", action="store_true", help="re-run the checks that need no model first")
    args = parser.parse_args()
    if args.free:
        subprocess.run([sys.executable, "-m", "eval.system"], cwd=ROOT.parent, check=False)
    sysdata = load("system.json")
    parts = ["# Space Learn: evaluation report", "", f"Built {datetime.now(UTC).date()} from the saved results in `eval/results/`. Sections: **1** RAG, **2** agents, **3** system design (cost, caching, capacity, latency, guarantees).", ""]
    parts += rag_section()
    parts += ["## 2. Agents", "", demote(agents.render(), 1), ""]
    parts += ["## 3. System design", "", demote(system.render(sysdata), 1) if sysdata else "_Not run: `python -m eval.system`._", ""]
    parts += appendix()
    (ROOT / "REPORT.md").write_text("\n".join(parts) + "\n")
    print(f"wrote {ROOT / 'REPORT.md'}")


if __name__ == "__main__":
    main()
