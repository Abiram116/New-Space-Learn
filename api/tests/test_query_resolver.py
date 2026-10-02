"""Follow-ups: which questions get rewritten, and that a rewrite can never
break or stall a chat turn."""

from __future__ import annotations

import asyncio

import pytest

from app.services import query_resolver
from app.services.query_resolver import leans_on_history, resolve

HISTORY = [
    {"role": "user", "content": "What is gradient descent?"},
    {"role": "assistant", "content": "A first-order method that steps against the gradient."},
]


@pytest.mark.parametrize(
    "question",
    ["Why?", "Who came up with it?", "explain that more", "And what about the learning rate in that case then?",
     "So is it faster than the other one or about the same speed?", "how does it compare to that?"],
)
def test_these_lean_on_the_conversation(question):
    assert leans_on_history(question, HISTORY)


@pytest.mark.parametrize(
    "question",
    ["What is the worst-case time complexity of binary search on a sorted array?",
     "How does the Calvin cycle use ATP and NADPH to make three-carbon sugars?",
     "Describe the three-way handshake that TCP uses to open a connection between hosts."],
)
def test_these_stand_by_themselves(question):
    assert not leans_on_history(question, HISTORY)


def test_with_no_conversation_nothing_leans_on_it():
    assert not leans_on_history("Why?", [])
    assert not leans_on_history("Why?", [{"role": "assistant", "content": "Welcome!"}])


async def test_a_standalone_question_costs_no_model_call():
    async def never(prompt: str) -> str:
        raise AssertionError("the model must not be asked")

    q = await resolve("What is the worst-case time complexity of binary search on a sorted array?", HISTORY, complete=never)
    assert q.how == "as-is" and q.standalone == q.original == q.keywords


async def test_a_follow_up_is_rewritten_with_the_topic_and_the_last_exchange():
    seen = {}

    async def rewrite(prompt: str) -> str:
        seen["prompt"] = prompt
        return '  "Who invented gradient descent?"\n'

    q = await resolve("Who came up with it?", HISTORY, topic="Optimisation", complete=rewrite)
    assert q.standalone == "Who invented gradient descent?" and q.how == "rewritten"
    assert q.keywords == "Who came up with it? Who invented gradient descent?"
    for part in ("Optimisation", "What is gradient descent?", "steps against the gradient", "Who came up with it?"):
        assert part in seen["prompt"]


async def test_a_failing_or_slow_model_falls_back_to_the_previous_question(monkeypatch):
    async def broken(prompt: str) -> str:
        raise RuntimeError("rate limited")

    q = await resolve("Who came up with it?", HISTORY, complete=broken)
    assert q.how == "joined" and q.standalone == "What is gradient descent? Who came up with it?"

    monkeypatch.setattr(query_resolver, "TIMEOUT_S", 0.01)

    async def slow(prompt: str) -> str:
        await asyncio.sleep(1)
        return "too late"

    assert (await resolve("Who came up with it?", HISTORY, complete=slow)).how == "joined"


async def test_a_reply_that_is_not_a_rewrite_is_ignored():
    async def empty(prompt: str) -> str:
        return "  "

    assert (await resolve("Why?", HISTORY, complete=empty)).how == "joined"

    async def essay(prompt: str) -> str:
        return "Gradient descent was invented by Cauchy.\n" * 20

    assert (await resolve("Why?", HISTORY, complete=essay)).how == "joined"


async def test_a_very_long_rewrite_is_cut_to_a_query():
    async def long(prompt: str) -> str:
        return "why " * 200

    q = await resolve("Why?", HISTORY, complete=long)
    assert len(q.standalone) <= query_resolver.MAX_QUERY_CHARS
