"""A re-asked question is answered from the stored answer — only when that is safe."""

from __future__ import annotations

import pytest

from app.deps import CurrentUser
from app.routers import subspace_chat
from app.schemas import ChatSend
from app.services import answer_cache
from app.services.query_resolver import Query
from app.services.retrieval import Candidate, Retrieval

from .conftest import OWNER
from .test_chat_regenerate import SUBSPACE_ID, _parse_done_event

V = [0.1, 0.2, 0.3, 0.4]


def test_the_same_or_a_nearly_identical_question_is_a_hit_and_a_different_one_is_not():
    answer_cache.clear()
    fp = answer_cache.fingerprint(chunk_ids=["c1"], flags={"cite": True})
    answer_cache.store("u", "s", "What is thrashing?", V, fp, "Paging too much.", None)
    assert answer_cache.lookup("u", "s", "what is thrashing", [9, 9, 9, 9], fp)  # same words
    assert answer_cache.lookup("u", "s", "Whats thrashing exactly", [0.1, 0.2, 0.3, 0.41], fp)  # near-identical vector
    assert answer_cache.lookup("u", "s", "What is a page fault?", [0.4, -0.3, 0.2, -0.1], fp) is None


def test_different_sources_or_settings_or_people_never_share_an_answer():
    answer_cache.clear()
    fp = answer_cache.fingerprint(chunk_ids=["c1"], flags={"cite": True})
    answer_cache.store("u", "s", "What is thrashing?", V, fp, "Paging too much.", None)
    other_sources = answer_cache.fingerprint(chunk_ids=["c1", "c2"], flags={"cite": True})
    other_settings = answer_cache.fingerprint(chunk_ids=["c1"], flags={"cite": False})
    assert answer_cache.lookup("u", "s", "What is thrashing?", V, other_sources) is None
    assert answer_cache.lookup("u", "s", "What is thrashing?", V, other_settings) is None
    assert answer_cache.lookup("someone-else", "s", "What is thrashing?", V, fp) is None
    assert answer_cache.lookup("u", "another-topic", "What is thrashing?", V, fp) is None


def test_a_stored_answer_arrives_in_small_pieces_that_rejoin_exactly():
    text = "x" * 130
    assert "".join(answer_cache.pieces(text)) == text
    assert len(answer_cache.pieces(text)) > 1


# ── Through the real route ─────────────────────────────────────────────


class _CountingLLM:
    def __init__(self) -> None:
        self.calls = 0

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        self.calls += 1
        yield "Thrashing is excessive paging [[1]]."


async def _with_sources(question, **_):
    chunk = Candidate(id="c1", document_id="d1", subspace_id=SUBSPACE_ID, chunk_index=0, content="Thrashing is when a system pages too much.", locator="p. 1")
    return Retrieval(Query(question, question), chunks=[chunk], ranking=[chunk], confidence="good")


async def _ask(db, monkeypatch, llm, *, regenerate=False, text="What is thrashing?") -> dict:
    db.seed("subspaces", [{"id": SUBSPACE_ID, "user_id": OWNER, "subject_id": "s1", "name": "Thrashing"}])
    monkeypatch.setattr(subspace_chat.rag, "search", _with_sources)
    monkeypatch.setattr(subspace_chat, "get_llm", lambda: llm)

    async def vec(texts):
        return [V for _ in texts]

    monkeypatch.setattr(subspace_chat, "embed_question", vec)
    response = await subspace_chat.send_chat(
        SUBSPACE_ID, ChatSend(text=text, regenerate=regenerate), user=CurrentUser(id=OWNER, email="s@example.com")
    )
    return _parse_done_event([c async for c in response.body_iterator])


@pytest.mark.asyncio
async def test_asking_the_same_thing_again_costs_no_model_call_and_gives_the_same_answer(db, monkeypatch):
    answer_cache.clear()
    llm = _CountingLLM()
    first = await _ask(db, monkeypatch, llm)
    second = await _ask(db, monkeypatch, llm)
    assert llm.calls == 1
    assert second["content"] == first["content"]
    # Still a real message: both turns are stored in the student's history.
    stored = [r["rows"][0]["role"] for r in db.inserts if r["table"] == "chat_messages"]
    assert stored.count("assistant") == 2


@pytest.mark.asyncio
async def test_regenerate_is_never_served_from_the_cache(db, monkeypatch):
    answer_cache.clear()
    llm = _CountingLLM()
    await _ask(db, monkeypatch, llm)
    await _ask(db, monkeypatch, llm, regenerate=True)
    assert llm.calls == 2


@pytest.mark.asyncio
async def test_the_switch_turns_it_off(db, monkeypatch):
    answer_cache.clear()
    monkeypatch.setattr(subspace_chat.settings, "answer_cache_enabled", False)
    llm = _CountingLLM()
    await _ask(db, monkeypatch, llm)
    await _ask(db, monkeypatch, llm)
    assert llm.calls == 2


@pytest.mark.asyncio
async def test_a_failed_answer_and_a_cached_answer_do_not_use_up_the_students_day(db, monkeypatch):
    from app.services import ratelimit

    answer_cache.clear()
    ratelimit.reset()
    llm = _CountingLLM()
    await _ask(db, monkeypatch, llm)  # a real answer: one used
    await _ask(db, monkeypatch, llm)  # served from the cache: free
    used = sum(c for _, c in ratelimit._daily[OWNER])  # noqa: SLF001
    assert used == 1


@pytest.mark.asyncio
async def test_chat_goes_to_the_small_model_when_the_large_one_is_nearly_out(db, monkeypatch):
    from app.services import usage

    answer_cache.clear()
    usage.reset()
    usage.record(subspace_chat.settings.groq_model, {"prompt_tokens": 190_000, "completion_tokens": 5_000})
    seen: list = []

    class Llm:
        async def stream_chat(self, messages, *, model=None, temperature=0.4):
            seen.append(model)
            yield "Thrashing is excessive paging."

    await _ask(db, monkeypatch, Llm())
    assert seen == [subspace_chat.settings.groq_model_fast]
    usage.reset()
