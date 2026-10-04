"""Do the agents write good work? Flashcards and quizzes, graded on the benchmark material.

    uv run python -m eval.agents --cards      # model calls: write a deck per topic, check it
    uv run python -m eval.agents --report     # free: print the agents section from saved results

**Flashcards.** For each benchmark topic the production deck writer is given the
same retrieved material a student's request would get, and every card is checked
without another model:

- *well formed*: a question for the front, an answer for the back, a real source;
- *no repeats*: no two fronts asking the same thing;
- *grounded*: how much of the back's own vocabulary appears in the passage the card
  names as its source. A card that says things its source does not say scores low.
  This is lexical, so it can miss a correct paraphrase and cannot catch a subtle
  falsehood; it separates cards made from the passage from cards made up.

**Quizzes** have their own, heavier check (`eval.quiz_check`: an independent grader
reads every final question against its material). `--report` folds its saved result in.

**Notes** are not covered here: the note prompts are built inside the request
handler, so there is nothing to call without a database. Extracting them is the
first step to measuring notes the same way.

Results: `eval/results/agents.json`; `eval/REPORT.md` shows them.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from app.services import card_writer, question_checks, retrieval
from app.services.coverage import Source

from .answers import PAUSE_S, _complete
from .corpus import TOPIC_NAMES, TOPICS, documents
from .index import Embedder
from .pg import topic_id
from .variants import Final

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results" / "agents.json"
CARDS = 8
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset("the a an and or of to in on at by for with from as is are was were be it its this that these those which who what how why when where does do not can may also than then they their there".split())
GROUNDED_AT = 0.5


def vocab(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 2 and w not in _STOP}


def grounded_share(back: str, source: str) -> float:
    """Of the back's own vocabulary, the share that appears in its source."""
    want = vocab(back)
    return len(want & vocab(source)) / len(want) if want else 0.0


def score_deck(cards: list[dict], sources: list[Source]) -> dict:
    """Pure checks on a written deck: separated out so they can be tested without a model."""
    by_number = {s.number: s for s in sources}
    shares = []
    for c in cards:
        src = by_number.get(c.get("source"))
        shares.append(grounded_share(c["back"], src.content) if src else 0.0)
    fronts = [{"front": c["front"]} for c in cards]
    repeated = len(question_checks.repeats_by_wording(fronts, []))
    # `repeats_by_wording(kept, earlier)` compares to earlier items; compare within the deck:
    dupes = sum(1 for i, c in enumerate(fronts) if question_checks.repeats_by_wording([c], fronts[:i]))
    return {
        "cards": len(cards),
        "question_fronts": sum(c["front"].strip().endswith("?") for c in cards),
        "with_source": sum(1 for c in cards if c.get("source") in by_number),
        "repeated_fronts": max(repeated, dupes),
        "grounded": sum(s >= GROUNDED_AT for s in shares),
        "mean_grounded_share": round(sum(shares) / len(shares), 3) if shares else 0.0,
    }


async def cards_check() -> dict:
    saved = json.loads(OUT.read_text()) if OUT.exists() else {}
    variant = Final()
    embedder = Embedder()
    variant.index(documents(), embedder)
    for topic in TOPICS:
        key = f"cards / {topic}"
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

        deck = await card_writer.write_deck(
            count=CARDS, topic=TOPIC_NAMES[topic], label=TOPIC_NAMES[topic], sources=sources,
            conversation="", earlier=[], complete=slow,
        )
        cards = [{"front": c.front, "back": c.back, "source": next((s.number for s in sources if s.label == c.source), None)} for c in deck.cards]
        saved[key] = {**score_deck(cards, sources), "asked": CARDS, "trace": deck.trace, "title": deck.title}
        OUT.write_text(json.dumps(saved, indent=1))
        print(key, saved[key], flush=True)
    return saved


def render() -> str:
    saved = json.loads(OUT.read_text()) if OUT.exists() else {}
    quizzes = ROOT / "results" / "quizzes.json"
    quiz = json.loads(quizzes.read_text()) if quizzes.exists() else {}
    L = ["# Agent evaluation", "", f"Rebuilt by `python -m eval.agents --report` on {datetime.now(UTC).date()}.", ""]
    L += ["## Flashcards", ""]
    rows = {k: v for k, v in saved.items() if k.startswith("cards / ")}
    if rows:
        L += ["| Topic | Asked | Kept | Question fronts | With a source | Repeated fronts | Grounded in their source | Mean grounded share |", "|---|---|---|---|---|---|---|---|"]
        for k, v in rows.items():
            L.append(f"| {k.split(' / ')[1]} | {v['asked']} | {v['cards']} | {v['question_fronts']} | {v['with_source']} | {v['repeated_fronts']} | {v['grounded']} of {v['cards']} | {v['mean_grounded_share']:.0%} |")
        L += ["", "“Grounded” means at least half of the back's own vocabulary appears in the passage it names. Lexical, so a faithful paraphrase can score low; it is for telling made-from-the-passage from made-up.", ""]
    else:
        L += ["Not run yet: `python -m eval.agents --cards`.", ""]
    L += ["## Quizzes", ""]
    if quiz:
        L += ["| Topic / way | Questions | Graded | Sound (supported and the only right choice) |", "|---|---|---|---|"]
        for k, v in quiz.items():
            if isinstance(v, dict) and "sound" in v:
                L.append(f"| {k} | {v['questions']} | {v['graded']} | {v['sound']} |")
        L.append("")
    else:
        L += ["Not run yet: `python -m eval.quiz_check --questions`.", ""]
    L += ["## Notes", "", "Not measured: the prompts are built inside the request handler. See the docstring of `eval/agents.py`.", ""]
    return "\n".join(L)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards", action="store_true")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args()
    if args.cards:
        asyncio.run(cards_check())
    print(render() if args.report else f"saved {OUT}")


if __name__ == "__main__":
    main()
