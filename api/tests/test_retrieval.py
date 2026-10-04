"""The retrieval pipeline, stage by stage, with the database replaced by a
list. What the stages do is fixed here; how well they work on real documents
is the benchmark's job (api/eval), not this file's."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.services import retrieval
from app.services.retrieval import Candidate, RetrievalConfig, fuse, judge, select

ON = retrieval.DEFAULT


def cand(id: str, *, v: int | None = None, k: int | None = None, sim: float = 0.8, cov: float = 0.8,
         doc: str = "d", index: int = 0, section: str | None = "S", size: int = 500) -> Candidate:
    return Candidate(id, doc, "sub", index, "x" * size, "p. 1", section=section, similarity=sim,
                     vector_rank=v, keyword_rank=k, keyword_coverage=cov)


class FakeStore:
    def __init__(self, rows: list[Candidate]) -> None:
        self.rows, self.calls = rows, []

    async def search(self, *, embedding, text, subspaces, limit):
        self.calls.append({"text": text, "subspaces": list(subspaces), "limit": limit})
        return list(self.rows)


async def fake_embed(texts: list[str]) -> list[list[float]]:
    fake_embed.seen = texts
    return [[0.0] * 384 for _ in texts]


# ── fuse ───────────────────────────────────────────────────────────────


def test_a_chunk_found_both_ways_outranks_one_found_either_way():
    ranked = fuse([cand("meaning", v=1), cand("keyword", k=1), cand("both", v=2, k=2)], ON)
    assert [c.id for c in ranked] == ["both", "meaning", "keyword"]


def test_keywords_can_be_switched_off_and_then_only_meaning_counts():
    off = replace(ON, keyword=False)
    ranked = fuse([cand("meaning", v=3), cand("keyword", k=1)], off)
    assert [c.id for c in ranked] == ["meaning"]  # a keyword-only hit has no score


def test_the_order_is_the_same_every_time():
    rows = [cand("b", v=1, k=None, sim=0.7), cand("a", v=None, k=1, sim=0.7)]
    tie = replace(ON, keyword_weight=1.0)  # equal scores: decided by similarity, then id
    assert [c.id for c in fuse(list(rows), tie)] == [c.id for c in fuse(list(reversed(rows)), tie)] == ["a", "b"]


# ── judge ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sim,cov,expected",
    [
        (0.80, 0.90, "good"),
        (0.80, 0.05, "good"),  # close in meaning: wording does not have to match
        (0.50, 0.95, "good"),  # far in meaning but it says the words: an exact term
        (0.65, 0.40, "weak"),  # the doubtful middle is passed on, with a warning
        (0.50, 0.05, "none"),  # small talk, or a subject the topic never mentions
    ],
)
def test_coverage_is_judged_on_both_signals(sim, cov, expected):
    assert judge([cand("a", v=1, sim=sim, cov=cov)], ON) == expected


def test_the_best_of_each_signal_may_come_from_different_chunks():
    assert judge([cand("a", v=1, sim=0.5, cov=0.9), cand("b", v=2, sim=0.45, cov=0.0)], ON) == "good"


def test_nothing_found_is_none_and_judging_can_be_switched_off():
    assert judge([], ON) == "none"
    assert judge([cand("a", v=1, sim=0.1, cov=0.0)], replace(ON, judge=False)) == "good"


# ── select ─────────────────────────────────────────────────────────────


def test_selection_stops_at_the_count_and_at_the_size():
    ranking = fuse([cand(str(i), v=i, index=i * 10) for i in range(1, 12)], ON)
    assert len(select(ranking, replace(ON, max_chunks=3, budget_chars=10**6))) == 3
    assert len(select(ranking, replace(ON, max_chunks=10, budget_chars=1200))) == 2
    # The best chunk is always sent, however large.
    big = fuse([cand("big", v=1, size=9000), cand("next", v=2)], ON)
    assert [c.id for c in select(big, replace(ON, budget_chars=1000))] == ["big"]


def test_a_chunks_direct_continuation_jumps_the_queue():
    ranking = fuse(
        [cand("top", v=1, index=5), cand("other", v=2, doc="e"), cand("far", v=3, doc="f"), cand("next", v=9, index=6)],
        ON,
    )
    two = replace(ON, max_chunks=2, budget_chars=10**6)
    assert [c.id for c in select(ranking, two)] == ["top", "next"]
    assert [c.id for c in select(ranking, replace(two, adjacent=False))] == ["top", "other"]


def test_only_a_neighbour_in_the_same_document_and_section_counts():
    ranking = fuse(
        [cand("top", v=1, index=5), cand("same-index-other-doc", v=8, doc="e", index=6),
         cand("other-section", v=9, index=4, section="T"), cand("second", v=2, doc="g")],
        ON,
    )
    assert [c.id for c in select(ranking, replace(ON, max_chunks=2))] == ["top", "second"]


def test_a_score_floor_drops_the_long_tail():
    ranking = fuse([cand("a", v=1, k=1), cand("b", v=20)], ON)
    assert [c.id for c in select(ranking, replace(ON, relative_floor=0.8, adjacent=False))] == ["a"]


# ── the pipeline ───────────────────────────────────────────────────────


async def test_the_question_is_embedded_with_the_query_prefix_and_searched_across_linked_topics():
    store = FakeStore([cand("a", v=1, k=1)])
    found = await retrieval.retrieve(
        "What is momentum?", subspace_id="main", linked_subspace_ids=["linked"], store=store, embed=fake_embed
    )
    assert fake_embed.seen == [retrieval.BGE_QUERY_PREFIX + "What is momentum?"]
    assert store.calls == [{"text": "What is momentum?", "subspaces": ["main", "linked"], "limit": ON.candidates}]
    assert [c.id for c in found.chunks] == ["a"] and found.confidence == "good" and not found.abstained


async def test_a_follow_up_is_searched_as_the_question_it_stands_for():
    store = FakeStore([cand("a", v=1, k=1)])

    async def rewrite(prompt: str) -> str:
        assert "Why does it converge?" in prompt and "gradient descent" in prompt
        return "Why does gradient descent converge?"

    history = [{"role": "user", "content": "What is gradient descent?"}, {"role": "assistant", "content": "An optimiser."}]
    found = await retrieval.retrieve(
        "Why does it converge?", subspace_id="main", history=history, store=store, embed=fake_embed, complete=rewrite
    )
    assert fake_embed.seen == [retrieval.BGE_QUERY_PREFIX + "Why does gradient descent converge?"]
    # Keywords: the student's own words still count, plus what the rewrite named.
    assert store.calls[0]["text"] == "Why does it converge? Why does gradient descent converge?"
    assert found.query.how == "rewritten" and found.trace()["query"] == "Why does gradient descent converge?"


async def test_material_judged_irrelevant_passes_nothing_and_says_it_abstained():
    store = FakeStore([cand("a", v=1, sim=0.5, cov=0.0)])
    found = await retrieval.retrieve("thanks!", subspace_id="main", store=store, embed=fake_embed)
    assert found.chunks == [] and found.confidence == "none" and found.abstained
    assert found.trace()["candidates"][0] == {"chunk": "a", "sim": 0.5, "v": 1, "k": None, "cov": 0.0, "used": False}


async def test_an_empty_topic_is_not_an_abstention():
    found = await retrieval.retrieve("anything", subspace_id="main", store=FakeStore([]), embed=fake_embed)
    assert found.chunks == [] and found.confidence == "none" and not found.abstained


async def test_the_generators_are_never_refused_and_get_more():
    store = FakeStore([cand(str(i), v=i, sim=0.4, cov=0.0, index=i * 10) for i in range(1, 10)])
    found = await retrieval.retrieve("core concepts", subspace_id="main", config=retrieval.GENERATION, store=store, embed=fake_embed)
    assert len(found.chunks) == 6 and found.confidence == "good"


def test_the_production_config_is_what_the_benchmark_measured():
    """Changing a default changes what students get. It should be a decision
    with a benchmark row behind it, not a drive-by edit."""
    assert RetrievalConfig(
        candidates=20, query_prefix=retrieval.BGE_QUERY_PREFIX, keyword=True, resolve_followups=True, rrf_k=60,
        keyword_weight=0.5, judge=True, none_similarity=0.60, none_coverage=0.15, weak_similarity=0.71,
        weak_coverage=0.55, max_chunks=6, budget_chars=4200, relative_floor=0.0, adjacent=True,
    ) == ON


def test_a_nul_character_never_reaches_the_database():
    from app.schemas import ChatSend

    assert ChatSend(text="what\x00 is this").text == "what is this"


async def test_nul_is_stripped_before_searching():
    store = FakeStore([])
    await retrieval.retrieve("bad\x00text", subspace_id="main", store=store, embed=fake_embed)
    assert store.calls[0]["text"] == "badtext"
