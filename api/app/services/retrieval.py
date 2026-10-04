"""Finding the parts of a student's documents that answer a question.

One pipeline, used by chat and by every generator. Five stages, each a small
function that can be tested and measured without the others:

    resolve   a follow-up becomes a question that stands by itself
    search    candidates by meaning AND by keyword, in one database call
    fuse      the two rankings become one
    judge     do the documents cover this at all? if not, pass nothing
    select    the few chunks worth the model's attention

What each stage does is fixed here; *how much* is `RetrievalConfig`. Its
defaults are what production runs, and every number in it was set by the
benchmark in `api/eval` (see `eval/RESULTS.md`), which runs this same code
against the same SQL function on a local Postgres. To change retrieval, change
a config value and measure — not the pipeline.

The database is behind `Store`, so nothing here knows it is Supabase.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from . import query_resolver, supabase
from .embeddings import embed_question
from .query_resolver import Query

log = logging.getLogger("space_learn.retrieval")

#: BGE models are trained to embed a *question* with this in front of it and a
#: passage with nothing. Chunks are stored without it; only queries get it.
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@dataclass(frozen=True, slots=True)
class RetrievalConfig:
    # search
    candidates: int = 20
    query_prefix: str = BGE_QUERY_PREFIX
    keyword: bool = True
    # resolve
    resolve_followups: bool = True
    # fuse — reciprocal rank fusion: score = Σ weight / (rrf_k + rank)
    rrf_k: int = 60
    keyword_weight: float = 0.5
    # judge — fitted by `eval/calibrate.py` on the tune questions.
    judge: bool = True
    #: "none": the best match is this far in meaning AND shares this little of
    #: the question's wording. Deliberately strict — passing nothing for a
    #: question the documents do answer is the worst mistake available — so
    #: it sits where it catches small talk ("thanks!", "ok cool") and
    #: questions with none of their distinctive words in the topic, and no
    #: covered question in the benchmark.
    none_similarity: float = 0.60
    none_coverage: float = 0.15
    #: "weak": below these, sources are still passed, with a warning to the
    #: model that they may not answer the question. Looser on purpose: wrongly
    #: refusing a question the documents DO answer is the worse mistake, so
    #: the doubtful middle is flagged, not refused.
    weak_similarity: float = 0.71
    weak_coverage: float = 0.55
    # select
    max_chunks: int = 6
    budget_chars: int = 4200
    #: A chunk scoring below this share of the best one is left out.
    relative_floor: float = 0.0
    #: Let a candidate that directly continues a chosen chunk (same document
    #: and section, next or previous position) jump the queue.
    adjacent: bool = True


@dataclass(slots=True)
class Candidate:
    id: str
    document_id: str
    subspace_id: str
    chunk_index: int
    content: str
    locator: str
    section: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    similarity: float = 0.0
    vector_rank: int | None = None
    keyword_rank: int | None = None
    keyword_coverage: float = 0.0
    document_name: str = "source"
    #: Set by `fuse`.
    score: float = 0.0


class Store(Protocol):
    async def search(
        self, *, embedding: list[float], text: str, subspaces: Sequence[str], limit: int
    ) -> list[Candidate]: ...


class SupabaseStore:
    """The real one: the `search_chunks` SQL function, which also returns each
    chunk's document name — one round trip per search."""

    async def search(
        self, *, embedding: list[float], text: str, subspaces: Sequence[str], limit: int
    ) -> list[Candidate]:
        rows = await supabase.db_rpc(
            "search_chunks",
            {
                "query_embedding": embedding,
                "query_text": text,
                "subspaces": list(subspaces),
                "candidate_count": limit,
            },
            read_only=True,
        )
        if not isinstance(rows, list):
            return []
        return [candidate_from_row(r) for r in rows]


def candidate_from_row(r: dict[str, Any]) -> Candidate:
    return Candidate(
        id=str(r["id"]),
        document_id=str(r["document_id"]),
        subspace_id=str(r["subspace_id"]),
        chunk_index=int(r["chunk_index"]),
        content=r["content"],
        locator=r.get("locator") or "",
        section=r.get("section"),
        page_start=r.get("page_start"),
        page_end=r.get("page_end"),
        similarity=float(r.get("similarity") or 0.0),
        vector_rank=r.get("vector_rank"),
        keyword_rank=r.get("keyword_rank"),
        keyword_coverage=float(r.get("keyword_coverage") or 0.0),
        document_name=r.get("document_name") or "source",
    )


@dataclass(slots=True)
class Retrieval:
    """What a search found, and how — enough to explain any answer afterwards."""

    query: Query
    #: The chunks to give the model. Empty when the documents don't cover it.
    chunks: list[Candidate] = field(default_factory=list)
    #: Every candidate, best first, before judging and selecting.
    ranking: list[Candidate] = field(default_factory=list)
    #: "good", "weak" (passed, but may not answer the question) or "none"
    #: (nothing passed: the documents don't cover it, or there are none).
    confidence: str = "none"

    @property
    def abstained(self) -> bool:
        """There was material to search, and none of it was judged relevant."""
        return bool(self.ranking) and not self.chunks

    def trace(self, keep: int = 8) -> dict[str, Any]:
        """A compact record for the message's `meta`: what was searched, what
        came back, and what was kept."""
        chosen = {c.id for c in self.chunks}
        return {
            "query": self.query.standalone if self.query.how != "as-is" else None,
            "how": self.query.how,
            "confidence": self.confidence,
            "candidates": [
                {
                    "chunk": c.id,
                    "sim": round(c.similarity, 3),
                    "v": c.vector_rank,
                    "k": c.keyword_rank,
                    "cov": round(c.keyword_coverage, 2),
                    "used": c.id in chosen,
                }
                for c in self.ranking[:keep]
            ],
        }


# ── The stages ─────────────────────────────────────────────────────────


def fuse(candidates: list[Candidate], config: RetrievalConfig) -> list[Candidate]:
    """One ranking from two. A chunk found both ways outranks one found either
    way; ties go to the closer in meaning, so the order is always the same."""
    for c in candidates:
        c.score = 0.0
        if c.vector_rank is not None:
            c.score += 1.0 / (config.rrf_k + c.vector_rank)
        if config.keyword and c.keyword_rank is not None:
            c.score += config.keyword_weight / (config.rrf_k + c.keyword_rank)
    ranked = [c for c in candidates if c.score > 0]
    ranked.sort(key=lambda c: (-c.score, -c.similarity, c.id))
    return ranked


def judge(ranking: list[Candidate], config: RetrievalConfig) -> str:
    """How far the documents seem to cover the question: "good", "weak" or "none".

    Judged on the best evidence either search produced: how close the closest
    chunk is in meaning, and how much of the question's wording (weighted by
    how rare each word is in the topic) the best match contains. Either alone
    can be fooled — two passages can be "similar" without one answering the
    other, and common words match anything — so it takes both being low to
    doubt the material.

    A small embedding model cannot separate "covered" from "not covered"
    cleanly: the two overlap. So there are three answers, not two. Only the
    clear cases pass nothing; the doubtful middle is passed on with a warning,
    and the model — which can read — makes the call.
    """
    if not ranking:
        return "none"
    if not config.judge:
        return "good"
    similarity = max(c.similarity for c in ranking)
    coverage = max(c.keyword_coverage for c in ranking)
    if similarity < config.none_similarity and coverage < config.none_coverage:
        return "none"
    if similarity < config.weak_similarity and coverage < config.weak_coverage:
        return "weak"
    return "good"


def select(ranking: list[Candidate], config: RetrievalConfig) -> list[Candidate]:
    """The chunks to send: best first, until the count or the size runs out."""
    if not ranking:
        return []
    floor = ranking[0].score * config.relative_floor
    pool = [c for c in ranking if c.score >= floor]
    chosen: list[Candidate] = []
    used = 0

    def take(c: Candidate) -> bool:
        nonlocal used
        if c in chosen or len(chosen) >= config.max_chunks:
            return False
        if chosen and used + len(c.content) > config.budget_chars:
            return False
        chosen.append(c)
        used += len(c.content)
        return True

    for c in pool:
        if not take(c):
            continue
        if config.adjacent:
            for other in ranking:
                if (
                    other.document_id == c.document_id
                    and other.section == c.section
                    and abs(other.chunk_index - c.chunk_index) == 1
                ):
                    take(other)
    return chosen


# ── The pipeline ───────────────────────────────────────────────────────

DEFAULT = RetrievalConfig()
#: For the generators (notes, cards, quizzes): they search by a topic name,
#: not a question, want more material, and have their own way of handling
#: "nothing indexed", so nothing is judged irrelevant here.
GENERATION = replace(DEFAULT, resolve_followups=False, judge=False, max_chunks=6, budget_chars=6000)

Embed = Callable[[list[str]], Awaitable[list[list[float]]]]


async def retrieve(
    question: str,
    *,
    subspace_id: str,
    linked_subspace_ids: Sequence[str] = (),
    history: list[dict[str, str]] | None = None,
    topic: str = "",
    config: RetrievalConfig = DEFAULT,
    store: Store | None = None,
    embed: Embed = embed_question,
    complete: query_resolver.Complete | None = None,
) -> Retrieval:
    question = question.replace("\x00", "")  # PostgreSQL text cannot hold it
    if config.resolve_followups and history:
        query = await query_resolver.resolve(question, history, topic=topic, complete=complete)
    else:
        query = Query(question.strip(), question.strip())

    vectors = await embed([config.query_prefix + query.standalone])
    if not vectors:
        return Retrieval(query)
    candidates = await (store or SupabaseStore()).search(
        embedding=vectors[0],
        text=query.keywords if config.keyword else "",
        # A linked topic's material competes on merit with the topic's own.
        subspaces=[subspace_id, *linked_subspace_ids],
        limit=config.candidates,
    )
    ranking = fuse(candidates, config)
    confidence = judge(ranking, config)
    chunks = select(ranking, config) if confidence != "none" else []
    return Retrieval(query, chunks=chunks, ranking=ranking, confidence=confidence)
