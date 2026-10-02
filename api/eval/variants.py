"""The retrieval pipelines being compared.

A variant takes the documents once (`index`) and then answers searches. It
returns two things, because they are judged differently:

- `ranking` — its best ten chunks in order. Recall and rank are measured here:
  did the search *find* the answer, and how high.
- `context` — the chunks it would actually hand to the model. Whether the model
  could answer, and whether the pipeline correctly passed *nothing* for a
  question the documents do not cover, are measured here.

`baseline` is production as it was when the benchmark was written — its
chunker is frozen in `legacy.py` — with the same arithmetic the
`match_document_chunks` SQL function does: cosine similarity against every
chunk in the topic, best four. New pipelines are added to `VARIANTS` and
measured against it on the same questions.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from app.services import chunking
from app.services.pdf_layout import read_pdf

from .corpus import Document, Question
from .index import Embedder
from .legacy import chunk_text, extract_pdf_text

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


class ChunksV2(Baseline):
    """Only the chunks change; the search is the baseline's."""

    name = "chunks-v2"
    description = "Structure-aware chunks (sections, pages, heading path embedded with the text); search unchanged."

    def index(self, docs: list[Document], embedder: Embedder) -> None:
        self.embedder = embedder
        self.chunks = {}
        self.vectors = {}
        embed_texts: dict[str, list[str]] = {}
        for doc in docs:
            for c in chunking.chunk(read_pdf(doc.data)[0]):
                self.chunks.setdefault(doc.topic, []).append(Chunk(doc.name, c.index, c.content, c.locator))
                embed_texts.setdefault(doc.topic, []).append(c.embed_text)
        for topic, texts in embed_texts.items():
            self.vectors[topic] = embedder.embed(texts)


VARIANTS: dict[str, type[Variant]] = {v.name: v for v in (Baseline, ChunksV2)}
