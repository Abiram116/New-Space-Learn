"""The retrieval pipelines being compared.

A variant takes the documents once (`index`) and then answers searches. It
returns two things, because they are judged differently:

- `ranking` — its best ten chunks in order. Recall and rank are measured here:
  did the search *find* the answer, and how high.
- `context` — the chunks it would actually hand to the model. Whether the model
  could answer, and whether the pipeline correctly passed *nothing* for a
  question the documents do not cover, are measured here.

`baseline` is today's production behaviour, built from the production
functions themselves (`chunk_text`, `embed_texts`) with the same arithmetic the
`match_document_chunks` SQL function does: cosine similarity against every
chunk in the topic, best four. New pipelines are added to `VARIANTS` and
measured against it on the same questions.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from app.services.embeddings import chunk_text, extract_pdf_text

from .corpus import Document, Question
from .index import Embedder

RANKING_DEPTH = 10


@dataclass(frozen=True)
class Chunk:
    document: str
    index: int
    text: str
    locator: str


@dataclass
class Result:
    ranking: list[Chunk]
    context: list[Chunk]
    #: What was actually searched for, when it differs from the question.
    query: str = ""
    scores: list[float] = field(default_factory=list)
    ms: float = 0.0

    @property
    def abstained(self) -> bool:
        return not self.context


class Variant:
    name = ""
    description = ""

    def index(self, docs: list[Document], embedder: Embedder) -> None:
        raise NotImplementedError

    def search(self, question: Question) -> Result:
        raise NotImplementedError


class Baseline(Variant):
    name = "baseline"
    description = "Production today: 900-character chunks, one vector search on the latest message, best 4, no cut-off."
    k = 4

    def index(self, docs: list[Document], embedder: Embedder) -> None:
        self.embedder = embedder
        self.chunks: dict[str, list[Chunk]] = {}
        self.vectors: dict[str, np.ndarray] = {}
        for doc in docs:
            pieces = chunk_text(extract_pdf_text(doc.data))
            self.chunks.setdefault(doc.topic, []).extend(Chunk(doc.name, c.index, c.content, c.locator) for c in pieces)
        for topic, chunks in self.chunks.items():
            self.vectors[topic] = embedder.embed([c.text for c in chunks])

    def search(self, question: Question) -> Result:
        query = self.embedder.embed([question.question])[0]
        started = time.perf_counter()  # the search itself; embedding is timed separately
        similarity = self.vectors[question.topic] @ query
        order = np.argsort(-similarity)[:RANKING_DEPTH]
        ranking = [self.chunks[question.topic][i] for i in order]
        return Result(
            ranking=ranking,
            context=ranking[: self.k],
            query=question.question,
            scores=[float(similarity[i]) for i in order],
            ms=(time.perf_counter() - started) * 1000,
        )


VARIANTS: dict[str, type[Variant]] = {v.name: v for v in (Baseline,)}
