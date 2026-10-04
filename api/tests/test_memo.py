"""The small caches: bounded, expiring, and only ever returning what the same call would."""

import asyncio

from app.services import embeddings, query_resolver
from app.services.memo import TTLCache


def test_entries_expire_and_the_oldest_go_first():
    now = [0.0]
    c: TTLCache[int] = TTLCache(maxsize=2, ttl=10, clock=lambda: now[0])
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)  # over the size: "a" goes
    assert c.get("a") is None and c.get("b") == 2 and c.get("c") == 3
    now[0] = 11
    assert c.get("b") is None  # expired


def test_reading_an_entry_keeps_it_from_being_the_next_to_go():
    c: TTLCache[int] = TTLCache(maxsize=2, ttl=100)
    c.set("a", 1)
    c.set("b", 2)
    assert c.get("a") == 1
    c.set("c", 3)
    assert c.get("a") == 1 and c.get("b") is None


def test_the_same_question_is_embedded_once(monkeypatch):
    embeddings._QUESTION_VECTORS.clear()
    calls: list[list[str]] = []

    async def fake(texts):
        calls.append(texts)
        return [[0.1, 0.2] for _ in texts]

    monkeypatch.setattr(embeddings, "embed_texts", fake)
    asyncio.run(embeddings.embed_question(["what is a class?"]))
    asyncio.run(embeddings.embed_question(["what is a class?"]))
    asyncio.run(embeddings.embed_question(["what is an object?"]))
    assert calls == [["what is a class?"], ["what is an object?"]]


def test_a_batch_is_never_cached():
    embeddings._QUESTION_VECTORS.clear()
    asyncio.run(embeddings.embed_question(["a", "b"]))
    assert len(embeddings._QUESTION_VECTORS) == 0


def test_a_rewrite_is_paid_for_once_but_a_caller_with_its_own_model_is_never_cached(monkeypatch):
    query_resolver._REWRITES.clear()
    monkeypatch.setattr(query_resolver.settings, "groq_api_key", "x")
    asked: list[str] = []

    async def ask(prompt: str) -> str:
        asked.append(prompt)
        return "How does the method resolution order work in Python?"

    monkeypatch.setattr(query_resolver, "_ask_model", ask)
    history = [
        {"role": "user", "content": "What is the MRO in Python classes?"},
        {"role": "assistant", "content": "It is the order in which classes are searched for a method."},
    ]
    first = asyncio.run(query_resolver.resolve("and how does it work?", history))
    second = asyncio.run(query_resolver.resolve("and how does it work?", history))
    assert first.standalone == second.standalone and first.how == "rewritten"
    assert len(asked) == 1

    own: list[str] = []

    async def mine(prompt: str) -> str:
        own.append(prompt)
        return "How does the method resolution order work in Python?"

    asyncio.run(query_resolver.resolve("and how does it work?", history, complete=mine))
    asyncio.run(query_resolver.resolve("and how does it work?", history, complete=mine))
    assert len(own) == 2
