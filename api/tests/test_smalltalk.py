"""A greeting is answered as a greeting: nothing searched, nothing cited, and quickly.

Two halves. The check itself (`services/smalltalk.py`) — where the mistake
that matters is calling a real question small talk, so most of the cases here
are things it must refuse. Then the route: a "hi" in the middle of a session
makes no search, reaches the small model, and comes back with no citations.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.deps import CurrentUser
from app.routers import subspace_chat
from app.schemas import ChatSend
from app.services import answer_cache, rag
from app.services.smalltalk import PROMPT, is_small_talk

from .conftest import OWNER
from .test_chat_regenerate import SUBSPACE_ID, _parse_done_event

# ── The check ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "Hi", "hello", "Hello!", "heyyy", "Hi there", "good morning", "yo",
        "thanks", "Thank you so much!", "thx", "ok thanks", "cool, thanks a lot",
        "ok", "Okay.", "got it", "makes sense", "bye", "see you later", "good night",
        "how are you?", "Hi, how are you?", "what's up", "thanks 🙏", "👍", ":)",
    ],
)
def test_greetings_thanks_acknowledgements_and_goodbyes_are_small_talk(text):
    assert is_small_talk(text)


@pytest.mark.parametrize(
    "text",
    [
        "hi, what is 2NF?",
        "hello can you explain thrashing",
        "thanks, and what about 3NF?",
        "ok so why does that happen",
        "ok but why",
        "how are joins evaluated?",
        "how are you supposed to normalise this?",
        "what's up with the second example?",
        "good question",
        "nice, next one",
        "why?", "?", "??", "ok?", "hello?",
        "yes", "no", "sure", "go on", "continue", "more", "2NF", "",
        "thanks for explaining normal forms so clearly, it finally makes sense to me now",
    ],
)
def test_anything_that_asks_about_the_material_or_answers_the_tutor_is_not(text):
    assert not is_small_talk(text)


def test_an_acknowledgement_after_the_tutor_asked_something_is_an_answer_to_it():
    asked = [
        {"role": "user", "content": "What is 2NF?"},
        {"role": "assistant", "content": "No partial dependencies. Want a worked example?"},
    ]
    told = [asked[0], {"role": "assistant", "content": "No partial dependencies on the key."}]
    for reply in ("ok", "cool", "ok thanks"):
        assert not is_small_talk(reply, asked)
        assert is_small_talk(reply, told)
    # A greeting or a goodbye is one whatever came before it.
    assert is_small_talk("thanks, bye", asked)


# ── The prompt ─────────────────────────────────────────────────────────


def _system(**overrides) -> str:
    args = {
        "subspace_name": "Normal forms",
        "active_skill_instructions": [],
        "history": [],
        "question": "hi",
        "retrieved": [],
        "answer_only_from_docs": True,
        "always_show_citations": True,
        "suggest_followup": True,
    }
    messages, citations = rag.build_prompt(**{**args, **overrides})
    assert citations == []
    return messages[0]["content"]


def test_a_greeting_is_not_told_the_documents_do_not_cover_it():
    """With "answer only from my documents" on and no sources, the prompt says
    to reply that nothing indexed covers the question. Right for a question,
    absurd for "hi"."""
    assert "No sources were retrieved for this question" in _system()
    small = _system(small_talk=True)
    assert PROMPT in small
    assert "No sources were retrieved for this question" not in small
    assert "How to shape an answer" not in small
    assert "[[next:" not in small
    # Much the smaller prompt, too.
    assert len(small) < len(_system()) * 0.75


# ── Through the real route ─────────────────────────────────────────────


class _RecordingLLM:
    def __init__(self) -> None:
        self.calls: list[tuple[str | None, list[dict]]] = []

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        self.calls.append((model, messages))
        yield "Hello. Ready when you are."


async def _send(db, monkeypatch, text: str) -> tuple[dict, _RecordingLLM, list[str]]:
    """One turn in a topic that already has a conversation — the case the
    feedback was about, where a short message used to be rewritten as a
    follow-up before being searched."""
    answer_cache.clear()
    db.seed("subspaces", [{"id": SUBSPACE_ID, "user_id": OWNER, "subject_id": "s1", "name": "Normal forms"}])
    db.seed(
        "chat_messages",
        [
            {"id": "m1", "user_id": OWNER, "subspace_id": SUBSPACE_ID, "role": "user", "content": "What is 2NF?", "created_at": "2026-10-01T10:00:00Z"},
            {"id": "m2", "user_id": OWNER, "subspace_id": SUBSPACE_ID, "role": "assistant", "content": "No partial dependencies on the key.", "created_at": "2026-10-01T10:00:05Z"},
        ],
    )
    searched: list[str] = []

    async def search(question, **_):
        from app.services.query_resolver import Query
        from app.services.retrieval import Retrieval

        searched.append(question)
        return Retrieval(Query(question, question))

    async def embed(texts):
        searched.extend(texts)
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    llm = _RecordingLLM()
    monkeypatch.setattr(subspace_chat.rag, "search", search)
    monkeypatch.setattr(subspace_chat, "embed_question", embed)
    monkeypatch.setattr(subspace_chat, "get_llm", lambda: llm)
    response = await subspace_chat.send_chat(
        SUBSPACE_ID, ChatSend(text=text), user=CurrentUser(id=OWNER, email="s@example.com")
    )
    chunks = [c async for c in response.body_iterator]
    assert not any(b"event: citation" in (c if isinstance(c, bytes) else c.encode()) for c in chunks)
    return _parse_done_event(chunks), llm, searched


@pytest.mark.asyncio
async def test_a_greeting_mid_session_searches_nothing_and_cites_nothing(db, monkeypatch):
    done, llm, searched = await _send(db, monkeypatch, "Hello")

    assert searched == []  # no retrieval, no embedding (so no answer cache either)
    assert done["citations"] == []
    assert done["suggestion"] is None
    assert done["content"] == "Hello. Ready when you are."
    # One model call, the answer itself, on the small model.
    [(model, messages)] = llm.calls
    assert model == subspace_chat.settings.groq_model_fast
    assert PROMPT in messages[0]["content"]
    assert not any(m["content"].startswith("Sources:") for m in messages if m["role"] == "system")
    # Still a real turn in the student's history, marked for what it was.
    stored = [r["rows"][0] for r in db.inserts if r["table"] == "chat_messages"]
    assert [r["role"] for r in stored] == ["user", "assistant"]
    assert stored[1]["citations"] is None
    assert stored[1]["meta"]["small_talk"] is True


@pytest.mark.asyncio
async def test_a_greeting_followed_by_a_question_is_searched_like_any_question(db, monkeypatch):
    done, llm, searched = await _send(db, monkeypatch, "hi, what is 3NF?")

    assert searched == ["hi, what is 3NF?"]
    [(model, messages)] = llm.calls
    assert model == settings.groq_model  # the usual model, chosen by the routing table
    assert PROMPT not in messages[0]["content"]
    stored = [r["rows"][0] for r in db.inserts if r["table"] == "chat_messages"]
    assert stored[1]["meta"]["small_talk"] is False
    assert done["content"]
