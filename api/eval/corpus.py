"""The benchmark's documents and questions, and what counts as a right answer.

**Ground truth is text, not chunk numbers.** A question names short verbatim
quotes from the document that contain its answer. A retrieved chunk is right
when it contains one of them. That keeps the questions valid across any change
to how documents are cut up — which is exactly what the benchmark exists to
compare — where "chunk 17" would be wrong the moment chunking changed.

`evidence` is a list of groups. Each group is a list of alternative quotes
(any one will do); a question that needs two separate places in the document
has two groups. No groups means the documents do not answer it, and the right
behaviour is to say so.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"

#: Which topic each document belongs to. Search is scoped to a topic, as in the app.
TOPICS: dict[str, list[str]] = {
    "cs": ["binary_search.pdf", "gradient_descent.pdf", "bayes_theorem.pdf"],
    "systems": ["transmission_control_protocol.pdf", "database_normalization.pdf"],
    "bio": ["photosynthesis.pdf"],
}

#: The name a student would see on each topic (the follow-up resolver uses it).
TOPIC_NAMES = {"cs": "Algorithms and machine learning", "systems": "Networks and databases", "bio": "Biology"}

CATEGORIES = (
    "direct",  # asks for a fact in the document's own words
    "reworded",  # same fact, different vocabulary
    "followup",  # only makes sense with the chat before it
    "exact",  # a name, acronym, number, formula or code-like term
    "cross",  # needs two separate places in the document
    "unanswerable",  # the documents do not cover it
)


@dataclass(frozen=True)
class Question:
    id: str
    topic: str
    category: str
    question: str
    #: Chat before the question, oldest first — only for follow-ups.
    history: tuple[dict[str, str], ...] = ()
    evidence: tuple[tuple[str, ...], ...] = ()
    #: A short correct answer, for judging what the model says.
    answer: str = ""
    #: "tune" questions may be used to set thresholds; "test" ones never are.
    split: str = "test"

    @property
    def answerable(self) -> bool:
        return bool(self.evidence)


def squash(text: str) -> str:
    """Letters and digits only, lower-cased.

    PDF text loses spaces, breaks words across lines with a hyphen and swaps
    one dash for another, and each extractor does it differently. Matching on
    the letters and digits alone means a quote still matches after any of that,
    so the questions outlive a change of extractor as well as of chunker.
    """
    return "".join(ch for ch in text.lower() if ch.isalnum())


def supports(chunk_text: str, group: tuple[str, ...]) -> bool:
    squashed = squash(chunk_text)
    return any(squash(quote) in squashed for quote in group)


@cache
def questions() -> list[Question]:
    raw = json.loads((ROOT / "questions.json").read_text(encoding="utf-8"))
    return [
        Question(
            id=q["id"],
            topic=q["topic"],
            category=q["category"],
            question=q["question"],
            history=tuple(q.get("history", [])),
            evidence=tuple(tuple(g) for g in q.get("evidence", [])),
            answer=q.get("answer", ""),
            split=q.get("split", "test"),
        )
        for q in raw
    ]


@dataclass
class Document:
    name: str
    topic: str
    data: bytes = field(repr=False)


def documents() -> list[Document]:
    return [Document(name, topic, (CORPUS / name).read_bytes()) for topic, names in TOPICS.items() for name in names]
