"""Finding the chunk a citation came from, so the preview can highlight it."""

from app.routers.documents import pick_cited
from app.services.rag import _snippet


def chunk(i: int, text: str) -> dict:
    return {"chunk_index": i, "locator": "p. 5", "content": text}


def test_the_snippet_is_matched_to_the_chunk_it_was_cut_from():
    a = chunk(10, "Scaled dot-product attention computes a weighted sum of the values. " * 6)
    b = chunk(11, "Multi-head attention runs several attention layers in parallel. " * 6)
    assert pick_cited([a, b], _snippet(b["content"])) is b
    assert pick_cited([a, b], _snippet(a["content"])) is a


def test_whitespace_and_line_breaks_do_not_get_in_the_way():
    c = chunk(3, "An RNN\nimplicitly   encodes order\nthrough hidden-state updates, so nothing extra is needed.")
    assert pick_cited([c], _snippet(c["content"])) is c


def test_with_no_match_the_first_chunk_on_the_page_is_the_fallback_and_nothing_gives_none():
    a, b = chunk(1, "alpha " * 30), chunk(2, "beta " * 30)
    assert pick_cited([a, b], "something else entirely") is a
    assert pick_cited([], "anything") is None
