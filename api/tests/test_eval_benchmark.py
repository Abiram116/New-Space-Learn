"""The retrieval benchmark's own rules — so a wrong score is a bug in a
pipeline, never in the ruler."""

from __future__ import annotations

from collections import Counter

from eval import metrics
from eval.corpus import CATEGORIES, TOPICS, Question, questions, squash, supports
from eval.variants import Chunk, Result


def _chunk(text: str, i: int = 0) -> Chunk:
    return Chunk(document="d.pdf", index=i, text=text, locator="")


def test_the_question_set_is_well_formed():
    qs = questions()
    assert len({q.id for q in qs}) == len(qs) >= 100
    assert {q.category for q in qs} == set(CATEGORIES)
    assert all(q.topic in TOPICS and q.split in ("tune", "test") for q in qs)
    for q in qs:
        assert q.answerable == (q.category != "unanswerable"), q.id
        assert bool(q.answer) == q.answerable, q.id
        assert bool(q.history) == (q.category == "followup"), q.id
        assert all(len(quote) >= 12 for group in q.evidence for quote in group), q.id
    assert all(len(g) >= 2 for q in qs if q.category == "cross" for g in [q.evidence])
    # Every kind of question is in both halves, so a threshold tuned on one is
    # tested on the same kinds in the other.
    for category, n in Counter(q.category for q in qs if q.split == "test").items():
        assert n >= 2, category


def test_a_quote_matches_whatever_the_pdf_did_to_its_spacing():
    assert squash("Zig–zag  path\n(FPGM)") == "zigzagpathfpgm"
    assert supports("a newly hired facultymember who has not", ("a newly hired faculty member",))
    assert supports("the next-\nlargest element", ("next-largest element",))
    assert not supports("something else entirely", ("a newly hired faculty member",))


def test_scoring_an_answerable_question():
    q = Question(id="x", topic="cs", category="cross", question="?", evidence=(("alpha beta",), ("gamma delta",)), answer="a")
    ranking = [_chunk("nothing"), _chunk("has alpha beta in it", 1), _chunk("and gamma delta", 2)]
    row = metrics.score(q, Result(ranking=ranking, context=ranking[:2]))
    assert (row["rank"], row["hit@1"], row["hit@3"], row["rr"]) == (2, False, True, 0.5)
    # One of the two parts reached the model: found, but not in full.
    assert row["context_hit"] is True and row["context_full"] is False and row["abstained"] is False


def test_scoring_an_unanswerable_question_is_about_abstaining():
    q = Question(id="u", topic="cs", category="unanswerable", question="?")
    assert metrics.score(q, Result(ranking=[_chunk("x")], context=[]))["abstained"] is True
    passed = metrics.score(q, Result(ranking=[_chunk("x")], context=[_chunk("x")]))
    assert passed["abstained"] is False and "rank" not in passed
    summary = metrics.summarise([passed])
    assert summary["abstain_when_unanswerable"] == 0.0 and summary["hit@5"] is None
