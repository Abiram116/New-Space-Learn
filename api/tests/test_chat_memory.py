"""Rolling per-topic chat memory: when it folds, what it stores, and the
guarantees the background task makes to the request that scheduled it.

Chat's live history window is short by design (8/20/40 turns — see
test_skill_history_scope.py), so `chat_memory.update_memory` is what keeps a
long-running topic from forgetting everything above that window. The
properties under test:

- it only bothers the model once enough turns have scrolled out of the live
  window (below the threshold, no LLM call and no write);
- it respects `memory_through` as a high-water mark, so already-folded turns
  are never re-summarized;
- an LLM failure is swallowed, not raised — a broken summarizer must never
  turn into a broken chat turn;
- `schedule_update` is single-flight per subspace, since two chat turns can
  finish back-to-back for the same topic.
"""

from __future__ import annotations

from app.services import chat_memory

from .conftest import OWNER

SUBSPACE_ID = "aaaaaaaa-0000-0000-0000-00000000c4a7"
HISTORY_LIMIT = 8


class _FakeLLM:
    def __init__(self, reply: str = "Working through recursion; kept confusing the base case with the loop guard.") -> None:
        self.calls = 0
        self.reply = reply
        self.fail = False

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        self.calls += 1
        if self.fail:
            raise RuntimeError("upstream down")
        yield self.reply


def _messages(n: int, *, start: int = 0) -> list[dict]:
    """`n` messages, newest first — the shape `_fold`'s
    `order="created_at.desc"` query expects back. Timestamps are plain
    zero-padded strings, which sort exactly like ISO timestamps would."""
    return [
        {
            "user_id": OWNER,
            "subspace_id": SUBSPACE_ID,
            "role": "user" if i % 2 == 0 else "assistant",
            "content": f"message {start + i}",
            "created_at": f"2026-01-01T00:{start + i:02d}:00Z",
        }
        for i in reversed(range(n))
    ]


def _seed(db, rows: list[dict]) -> None:
    db.seed("chat_messages", rows)


async def test_below_threshold_does_not_call_the_model_or_write(db, monkeypatch):
    """8 in the live window + 5 older-than-the-window messages is only 5
    unsummarized turns — under the 12-turn threshold, so this is a no-op."""
    _seed(db, _messages(13))
    llm = _FakeLLM()
    monkeypatch.setattr(chat_memory, "get_llm", lambda: llm)

    await chat_memory.update_memory(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)

    assert llm.calls == 0
    assert not any(u["table"] == "subspaces" for u in db.updates)


async def test_at_threshold_folds_and_advances_memory_through(db, monkeypatch):
    """Exactly 12 older-than-window messages: enough to fold. The write must
    carry the model's summary and advance memory_through to the newest of
    the folded messages, not the newest message overall."""
    rows = _messages(20)  # 8 in-window + 12 foldable
    _seed(db, rows)
    llm = _FakeLLM("Studying recursion; struggles with base cases.")
    monkeypatch.setattr(chat_memory, "get_llm", lambda: llm)

    await chat_memory.update_memory(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)

    assert llm.calls == 1
    updates = [u for u in db.updates if u["table"] == "subspaces"]
    assert len(updates) == 1
    patch = updates[0]["patch"]
    assert patch["memory_summary"] == "Studying recursion; struggles with base cases."
    # The 12 foldable messages are indices 0..11 (oldest first after the
    # window is dropped); the newest of those is message 11.
    assert patch["memory_through"] == "2026-01-01T00:11:00Z"


async def test_messages_already_before_memory_through_are_not_recounted(db, monkeypatch):
    """A prior fold already covers everything up to memory_through. Only
    messages strictly newer than it count toward the threshold — if that
    leaves fewer than 12, nothing happens even though the table has plenty
    of history overall."""
    rows = _messages(30)  # 8 window + 22 older
    _seed(db, rows)
    llm = _FakeLLM()
    monkeypatch.setattr(chat_memory, "get_llm", lambda: llm)

    # Everything up through message 15 is already folded; only messages
    # 16..21 (6 messages) are newer than that and outside the window.
    subspace = {
        "memory_summary": "Earlier: covered loops.",
        "memory_through": "2026-01-01T00:15:00Z",
    }
    await chat_memory.update_memory(OWNER, SUBSPACE_ID, subspace, HISTORY_LIMIT)

    assert llm.calls == 0
    assert not any(u["table"] == "subspaces" for u in db.updates)


async def test_llm_failure_is_swallowed_not_raised(db, monkeypatch):
    """A summarizer that's down must not turn into a broken chat turn — this
    is called from a fire-and-forget task with nothing to catch it."""
    _seed(db, _messages(20))
    llm = _FakeLLM()
    llm.fail = True
    monkeypatch.setattr(chat_memory, "get_llm", lambda: llm)

    await chat_memory.update_memory(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)  # must not raise

    assert not any(u["table"] == "subspaces" for u in db.updates)


async def test_schedule_update_is_single_flight_per_subspace(monkeypatch):
    """Two chat turns for the same topic finishing back-to-back must not both
    kick off a fold — the second call while one is already running is a
    no-op, and the guard clears once the running one finishes."""
    calls = 0

    async def _fake_update(user_id, subspace_id, subspace, history_limit):
        nonlocal calls
        calls += 1

    monkeypatch.setattr(chat_memory, "update_memory", _fake_update)
    chat_memory._in_progress.discard(SUBSPACE_ID)  # isolate from other tests

    chat_memory.schedule_update(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)
    assert SUBSPACE_ID in chat_memory._in_progress
    chat_memory.schedule_update(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)

    # Let both scheduled tasks run to completion.
    import asyncio

    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert calls == 1
    assert SUBSPACE_ID not in chat_memory._in_progress


async def test_a_different_subspace_is_not_blocked_by_another_ones_fold(monkeypatch):
    calls: list[str] = []

    async def _fake_update(user_id, subspace_id, subspace, history_limit):
        calls.append(subspace_id)

    monkeypatch.setattr(chat_memory, "update_memory", _fake_update)
    other = "bbbbbbbb-0000-0000-0000-00000000c4a7"
    chat_memory._in_progress.discard(SUBSPACE_ID)
    chat_memory._in_progress.discard(other)

    chat_memory.schedule_update(OWNER, SUBSPACE_ID, {}, HISTORY_LIMIT)
    chat_memory.schedule_update(OWNER, other, {}, HISTORY_LIMIT)

    import asyncio

    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert sorted(calls) == sorted([SUBSPACE_ID, other])
