"""Regenerate must not double-store the question.

Regenerating an answer resends the same question that is already on the
record from the first attempt. `ChatSend.regenerate` tells the handler that,
so it skips re-inserting the user turn — otherwise the student's own question
would appear twice in their history for one answer that changed, and a
regenerate would silently duplicate every question it touched. The answer
itself is always stored either way: nothing about a student's history
disappears, only the redundant restatement of a question already asked.

This is the one router in the app with zero test coverage before this file,
because `send_chat` streams and touches nine services. The seam that makes it
testable without a real Supabase or a real Groq key: `rag.retrieve_with_links`
and `get_llm` are both monkeypatched at their call sites, and everything else
(`student_model.snapshot`, `activity.bump`, ...) already degrades gracefully
against an empty `FakeDb` — the same guarantee `test_student_model.py` and
`test_feedback.py` rely on for a fresh account.
"""

from __future__ import annotations

import json

import pytest

from app.deps import CurrentUser
from app.routers import subspace_chat
from app.schemas import ChatSend

from .conftest import OWNER

SUBSPACE_ID = "aaaaaaaa-0000-0000-0000-00000000c4a7"


class _FakeLLM:
    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        yield "Hello"
        yield " there."


async def _run(db, monkeypatch: pytest.MonkeyPatch, *, regenerate: bool) -> dict:
    db.seed(
        "subspaces",
        [{"id": SUBSPACE_ID, "user_id": OWNER, "subject_id": "s1", "name": "Thrashing"}],
    )
    # No documents indexed — retrieval would otherwise call the
    # `match_document_chunks` RPC, which `FakeDb` deliberately refuses (see
    # its docstring). Empty is also the honest state for this test: nothing
    # here is about retrieval quality.
    monkeypatch.setattr(subspace_chat.rag, "retrieve_with_links", _no_sources)
    monkeypatch.setattr(subspace_chat, "get_llm", lambda: _FakeLLM())

    response = await subspace_chat.send_chat(
        SUBSPACE_ID,
        ChatSend(text="What is thrashing?", regenerate=regenerate),
        user=CurrentUser(id=OWNER, email="s@example.com"),
    )

    chunks = [chunk async for chunk in response.body_iterator]
    return _parse_done_event(chunks)


async def _no_sources(subspace_id, question, linked_ids):
    return []


def _parse_done_event(chunks: list[bytes | str]) -> dict:
    body = "".join(c.decode() if isinstance(c, bytes) else c for c in chunks)
    for block in body.split("\n\n"):
        if block.startswith("event: done"):
            data_line = next(line for line in block.split("\n") if line.startswith("data:"))
            return json.loads(data_line[len("data:") :].strip())
    raise AssertionError(f"no 'done' event in stream:\n{body}")


@pytest.mark.asyncio
async def test_first_message_stores_both_the_question_and_the_answer(db, monkeypatch):
    done = await _run(db, monkeypatch, regenerate=False)

    roles = [row["rows"][0]["role"] for row in db.inserts if row["table"] == "chat_messages"]
    assert roles == ["user", "assistant"]
    assert done["user_message_id"] is not None
    assert done["content"] == "Hello there."


@pytest.mark.asyncio
async def test_regenerate_stores_only_the_new_answer(db, monkeypatch):
    """The behavioural fix: a second attempt at the same question must not
    write a second 'user' row, or every regenerate would duplicate the
    question in the student's own history."""
    done = await _run(db, monkeypatch, regenerate=True)

    roles = [row["rows"][0]["role"] for row in db.inserts if row["table"] == "chat_messages"]
    assert roles == ["assistant"]
    # Nothing was stored to point at — the 'done' event says so honestly
    # rather than inventing an id for a row that doesn't exist.
    assert done["user_message_id"] is None


@pytest.mark.asyncio
async def test_regenerate_still_answers_from_the_resent_text(db, monkeypatch):
    """Skipping the insert must not skip the actual work — the model still
    receives and answers the question, it just isn't re-filed."""
    done = await _run(db, monkeypatch, regenerate=True)
    assert done["content"] == "Hello there."
