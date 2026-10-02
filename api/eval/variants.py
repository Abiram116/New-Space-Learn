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

import asyncio
import time
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

from app.services import chunking, retrieval
from app.services.pdf_layout import read_pdf

from . import rewrites
from .corpus import TOPIC_NAMES, Document, Question
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
    #: The pipeline's own result, for variants that run the real pipeline.
    found: Any = None

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


class Pipeline(Variant):
    """The production pipeline (`app.services.retrieval`) with a given config,
    searching the real SQL function on a local Postgres. Each subclass below
    switches on one more stage, so the table shows what each stage bought."""

    config = retrieval.DEFAULT

    def index(self, docs: list[Document], embedder: Embedder) -> None:
        from .pg import PgStore

        self.embedder = embedder
        self.store = PgStore()
        rows = []
        for doc in docs:
            for c in chunking.chunk(read_pdf(doc.data)[0]):
                rows.append(
                    {
                        "topic": doc.topic, "document": doc.name, "index": c.index, "content": c.content,
                        "locator": c.locator, "section": c.section, "page_start": c.page_start,
                        "page_end": c.page_end, "embed_text": c.embed_text,
                    }
                )
        for row, vector in zip(rows, embedder.embed([r["embed_text"] for r in rows]), strict=True):
            row["vector"] = vector
        self.store.load(rows)
        self.chunks = {"all": rows}  # for the chunk count in the report

    def search(self, question: Question) -> Result:
        from .pg import topic_id

        started = time.perf_counter()
        found = asyncio.run(
            retrieval.retrieve(
                question.question,
                subspace_id=topic_id(question.topic),
                history=list(question.history),
                topic=TOPIC_NAMES[question.topic],
                config=self.config,
                store=self.store,
                embed=self.embedder.aembed,
                complete=rewrites.complete,
            )
        )
        as_chunk = lambda c: Chunk(c.document_name, c.chunk_index, c.content, c.locator)  # noqa: E731
        return Result(
            ranking=[as_chunk(c) for c in found.ranking[:RANKING_DEPTH]],
            context=[as_chunk(c) for c in found.chunks],
            query=found.query.standalone,
            scores=[c.score for c in found.ranking[:RANKING_DEPTH]],
            ms=(time.perf_counter() - started) * 1000,
            found=found,
        )


_OFF = replace(
    retrieval.DEFAULT, query_prefix="", keyword=False, resolve_followups=False, judge=False,
    max_chunks=4, budget_chars=100_000, relative_floor=0.0, adjacent=False,
)
_ON = retrieval.DEFAULT


class Prefix(Pipeline):
    name = "v2-1-prefix"
    description = "chunks-v2, plus the embedding model's query prefix on the question."
    config = replace(_OFF, query_prefix=retrieval.BGE_QUERY_PREFIX)


class Hybrid(Pipeline):
    name = "v2-2-hybrid"
    description = "…plus keyword search beside the vector search, merged by rank."
    config = replace(Prefix.config, keyword=True)


class Resolve(Pipeline):
    name = "v2-3-resolve"
    description = "…plus follow-ups rewritten into standalone questions before searching."
    config = replace(Hybrid.config, resolve_followups=True)


class Select(Pipeline):
    name = "v2-4-select"
    description = "…plus selection: up to six chunks within a size budget, a chunk's direct continuation promoted."
    config = replace(
        Resolve.config, max_chunks=_ON.max_chunks, budget_chars=_ON.budget_chars,
        relative_floor=_ON.relative_floor, adjacent=_ON.adjacent,
    )


class Final(Pipeline):
    name = "v2-5-judge"
    description = "…plus judging coverage: nothing passed when clearly uncovered, a warning when doubtful. This is production."
    config = _ON


VARIANTS: dict[str, type[Variant]] = {
    v.name: v for v in (Baseline, ChunksV2, Prefix, Hybrid, Resolve, Select, Final)
}
