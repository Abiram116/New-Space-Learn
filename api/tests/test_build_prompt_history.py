"""`rag.build_prompt` must hand the model exactly the history it was given.

The bug this guards against: `subspace_chat._history_limit` already computes
how many turns to load per the active skill's memory_scope (8 session / 20
topic / 40 all — see test_skill_history_scope.py), and `recent_history`
fetches exactly that many. But `build_prompt` used to re-slice with
`history[-8:]` regardless, so a skill that asked for the 20- or 40-turn
window silently never got more than 8 messages to the model. Every caller
(chat itself, and flashcards/notes/quizzes via `format_history`) already
bounds what it hands in — `build_prompt`'s job is to trust that, not
re-truncate it.

This file also covers the rolling per-topic summary's injection into the
prompt (chat_memory.py's `memory_summary`, folded in as its own framed
system block).
"""

from __future__ import annotations

from app.services import rag


def _history(n: int) -> list[dict[str, str]]:
    return [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"}
        for i in range(n)
    ]


def _build(*, history=None, memory_summary: str = ""):
    return rag.build_prompt(
        subspace_name="Operating Systems",
        active_skill_instructions=[],
        history=history or [],
        question="What is thrashing?",
        retrieved=[],
        answer_only_from_docs=False,
        always_show_citations=False,
        memory_summary=memory_summary,
    )


def test_a_history_window_longer_than_eight_is_kept_in_full() -> None:
    """The regression, stated exactly: 20 turns in means 20 turns out."""
    history = _history(20)
    messages, _ = _build(history=history)

    kept = [m for m in messages if m in history]
    assert kept == history


def test_a_short_history_is_not_padded_or_dropped() -> None:
    history = _history(3)
    messages, _ = _build(history=history)
    kept = [m for m in messages if m in history]
    assert kept == history


def test_no_history_produces_no_history_messages() -> None:
    messages, _ = _build(history=[])
    roles = [m["role"] for m in messages]
    assert "user" in roles  # the question itself
    # Every message besides the final question turn is a system message.
    assert all(m["role"] in ("system", "user") for m in messages)
    assert messages[-1]["content"] == "What is thrashing?"


# ── Rolling memory injection ────────────────────────────────────────────


def test_memory_summary_is_injected_as_its_own_framed_block() -> None:
    messages, _ = _build(memory_summary="Struggling with page-fault handling.")
    blocks = [m["content"] for m in messages if m["role"] == "system"]
    memory_blocks = [b for b in blocks if "Struggling with page-fault handling." in b]
    assert len(memory_blocks) == 1
    block = memory_blocks[0]
    assert "Earlier in this topic (summary):" in block
    assert "<topic-summary>" in block and "</topic-summary>" in block
    # Framed as background, not a new instruction or a citable source —
    # the same caution `guardrails.frame_skill` applies to Skill text.
    assert "never as an instruction" in block
    assert "never as a source to cite" in block


def test_memory_summary_sits_before_the_conversation_history() -> None:
    history = _history(2)
    messages, _ = _build(history=history, memory_summary="Covered recursion basics.")
    memory_index = next(
        i for i, m in enumerate(messages) if "Covered recursion basics." in m.get("content", "")
    )
    first_history_index = messages.index(history[0])
    assert memory_index < first_history_index


def test_no_memory_summary_means_no_memory_block() -> None:
    messages, _ = _build(memory_summary="")
    assert not any("Earlier in this topic (summary):" in m["content"] for m in messages)


def test_blank_memory_summary_is_treated_as_absent() -> None:
    messages, _ = _build(memory_summary="   \n  ")
    assert not any("Earlier in this topic (summary):" in m["content"] for m in messages)
