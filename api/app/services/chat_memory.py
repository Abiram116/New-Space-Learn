"""Rolling per-topic chat memory.

The live history window chat hands the model is deliberately short — 8, 20,
or 40 turns depending on the active skill's `memory_scope` (see
`subspace_chat._history_limit`) — because a large in-context window is real
latency and Groq cost paid on every single turn, whether or not the
question actually needs it. But a topic can run for hundreds of messages,
and nothing above that window was ever remembered.

This module folds messages that have scrolled out of the live window into a
durable, compact summary stored on the subspace row (`memory_summary`,
`memory_through`), so `rag.build_prompt` can hand the model what happened
earlier without paying full-transcript cost on every turn.

It runs as a fire-and-forget background task kicked off after a chat turn's
assistant message is already persisted — `schedule_update` must never be
awaited from the response path. Any failure here (DB, LLM, whatever) is
logged and swallowed; a broken summarizer must never turn into a broken chat.
"""

from __future__ import annotations

import asyncio
import logging

from ..config import settings
from . import supabase
from .llm import get_llm

log = logging.getLogger("space_learn.chat_memory")

#: Fold once at least this many messages have scrolled out of the live
#: history window and haven't been folded yet. Below this, a model call to
#: summarize a handful of turns costs more than it's worth.
_FOLD_THRESHOLD = 12

#: Never hand the summarizer more than this many messages in one pass, even
#: if a topic went quiet for a long time and a large backlog built up —
#: bounds the prompt regardless of how far behind `memory_through` is.
_MAX_INPUT_MESSAGES = 40

#: Per-message truncation before it goes into the summarizer's prompt. One
#: pasted essay or long code block in a single turn shouldn't blow out the
#: summarization prompt on its own.
_MESSAGE_CHAR_CAP = 600

_SUMMARY_WORD_CAP = 120

#: One subspace's memory is only ever folded by one request at a time. Two
#: chat turns finishing back-to-back would otherwise both read the same
#: `memory_through`, both summarize the same backlog, and the second write
#: would race (or clobber) the first. A plain in-process set is enough here:
#: this is a single-user deployment, and nothing awaits between the
#: membership check and the add, so there's no gap for two calls to both
#: pass the check within one event loop.
_in_progress: set[str] = set()


def schedule_update(
    user_id: str, subspace_id: str, subspace: dict, history_limit: int
) -> None:
    """Fire-and-forget: kick off a background fold for this subspace, unless
    one is already running for it.

    Call this only after the turn's assistant message has actually been
    persisted, so the messages being folded are genuinely on the record. It
    never blocks and never raises — the returned task's own errors are
    caught inside `update_memory`.
    """
    if subspace_id in _in_progress:
        return
    _in_progress.add(subspace_id)

    async def _run() -> None:
        try:
            await update_memory(user_id, subspace_id, subspace, history_limit)
        finally:
            _in_progress.discard(subspace_id)

    asyncio.create_task(_run())


async def update_memory(
    user_id: str, subspace_id: str, subspace: dict, history_limit: int
) -> None:
    """Fold turns that have scrolled out of the live history window into the
    topic's rolling summary, if enough of them have piled up.

    Safe to call directly and await (tests do) — every failure inside,
    including an LLM error, is caught here so it never propagates.
    """
    try:
        await _fold(user_id, subspace_id, subspace, history_limit)
    except Exception:
        log.exception("chat memory update failed for subspace=%s", subspace_id)


async def _fold(
    user_id: str, subspace_id: str, subspace: dict, history_limit: int
) -> None:
    memory_through = subspace.get("memory_through")
    prior_summary = subspace.get("memory_summary") or ""

    # `history_limit + _MAX_INPUT_MESSAGES` covers the live window plus the
    # most we'd ever fold in one pass — enough to answer both "how many have
    # fallen out of the window" and "what are they" in one query.
    rows = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        select="role,content,created_at",
        order="created_at.desc",
        limit=history_limit + _MAX_INPUT_MESSAGES,
    )
    rows.reverse()  # oldest first

    # The most recent `history_limit` messages are already in the live
    # prompt window (rag.build_prompt gets them directly) — folding them
    # into the summary too would just duplicate what the model already sees.
    older = rows[:-history_limit] if history_limit else rows
    # `memory_through` is a high-water mark, not a DB-side filter: applied
    # here rather than pushed into `filters` so this stays a plain equality
    # query like every other one in this codebase.
    if memory_through:
        older = [r for r in older if r["created_at"] > memory_through]
    if len(older) < _FOLD_THRESHOLD:
        return

    to_fold = older[-_MAX_INPUT_MESSAGES:]
    transcript = "\n".join(f"{r['role']}: {_truncate(r['content'])}" for r in to_fold)
    summary = await _summarize(prior_summary, transcript)
    if not summary:
        return

    await supabase.db_update(
        "subspaces",
        filters={"id": f"eq.{subspace_id}"},
        patch={"memory_summary": summary, "memory_through": to_fold[-1]["created_at"]},
    )


async def _summarize(prior_summary: str, transcript: str) -> str | None:
    prompt = (
        "Summarize the durable facts from this study conversation in at "
        f"most {_SUMMARY_WORD_CAP} words: what the student is working on, "
        "what they struggled with or got wrong, any goals or deadlines they "
        "mentioned, and any decisions or conventions agreed on. Plain prose, "
        "no chit-chat, no restating the obvious, nothing that isn't a "
        "durable fact.\n\n"
    )
    if prior_summary:
        prompt += f"Previous summary:\n{prior_summary}\n\n"
    prompt += f"New messages:\n{transcript}"

    chunks: list[str] = []
    async for delta in get_llm().stream_chat(
        [{"role": "system", "content": prompt}],
        model=settings.groq_model_fast,
        temperature=0.2,
    ):
        chunks.append(delta)
    return "".join(chunks).strip() or None


def _truncate(text: str) -> str:
    text = text or ""
    return text if len(text) <= _MESSAGE_CHAR_CAP else text[:_MESSAGE_CHAR_CAP].rstrip() + "…"
