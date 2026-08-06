"""Chat: list previous messages + POST that streams the assistant reply.

The stream uses Server-Sent Events (`text/event-stream`). Event types the
frontend consumes:

  event: token          data: {"delta":"…"}
  event: citation       data: {"marker":1,"document_id":"…",...}
  event: done           data: {"message_id":"…"}
  event: error          data: {"code":"upstream_unavailable","message":"…"}

We assemble the assistant message server-side while streaming, then insert
one row when the stream ends so history stays consistent.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..deps import CurrentUser, get_current_user
from ..errors import ApiError
from ..guards import assert_subspace
from ..schemas import ChatMessageOut, ChatSend, Citation
from ..services import activity, rag, student_model, supabase
from ..services.chat_context import recent_history
from ..services.llm import get_llm
from ..services.ratelimit import consume_llm_quota

log = logging.getLogger("space_learn.chat")
router = APIRouter()


@router.get(
    "/subspaces/{subspace_id}/messages", response_model=list[ChatMessageOut]
)
async def list_messages(
    subspace_id: str,
    user: CurrentUser = Depends(get_current_user),
    limit: int = 100,
) -> list[ChatMessageOut]:
    # Guard and history read run together — see the note in notes.list_notes.
    _, rows = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "chat_messages",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="created_at.asc",
            limit=min(limit, 500),
        ),
    )
    return [
        ChatMessageOut(
            id=r["id"],
            role=r["role"],
            content=r["content"],
            citations=[Citation(**c) for c in (r.get("citations") or [])] or None,
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/subspaces/{subspace_id}/chat")
async def send_chat(
    subspace_id: str,
    body: ChatSend,
    user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    subspace = await assert_subspace(user.id, subspace_id)
    # Bounce over-eager callers before we do any DB or LLM work.
    await consume_llm_quota(user.id)
    settings_row = await _fetch_settings(user.id)
    active_skills = await _active_skills(user.id, subspace_id)
    # A skill's memory_scope is a real behavior dimension, not decoration:
    # "topic"/"all" pull a longer history window so the model actually has
    # more to work with, not just a longer prompt for its own sake.
    scope_limit = {"session": 8, "topic": 20, "all": 40}
    history_limit = max(
        (scope_limit.get(s.get("memory_scope", "session"), 8) for s in active_skills),
        default=8,
    )
    prior = await recent_history(user.id, subspace_id, limit=history_limit)
    linked_ids = await _linked_subspace_ids(user.id, subspace_id)
    retrieved = await rag.retrieve_with_links(subspace_id, body.text, linked_ids)
    student_context = student_model.format_for_prompt(await student_model.get(user.id))

    messages, citations_meta = rag.build_prompt(
        subspace_name=subspace["name"],
        active_skill_instructions=[_skill_prompt(s) for s in active_skills],
        history=prior,
        question=body.text,
        retrieved=retrieved,
        answer_only_from_docs=bool(settings_row.get("answer_only_from_docs", True)),
        always_show_citations=bool(settings_row.get("always_show_citations", True)),
        student_context=student_context,
    )

    # Persist the user's turn immediately so refresh shows it even mid-stream.
    user_row = (
        await supabase.db_insert(
            "chat_messages",
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "role": "user",
                "content": body.text,
            },
        )
    )[0]

    async def gen() -> AsyncIterator[bytes]:
        buffer: list[str] = []
        try:
            # Emit citations up front so the UI can render source cards
            # while tokens are still streaming in.
            for c in citations_meta:
                yield _sse("citation", c)
            async for delta in get_llm().stream_chat(messages):
                buffer.append(delta)
                yield _sse("token", {"delta": delta})
            assistant_text = "".join(buffer).strip() or "(no reply)"
            saved = await supabase.db_insert(
                "chat_messages",
                {
                    "user_id": user.id,
                    "subspace_id": subspace_id,
                    "role": "assistant",
                    "content": assistant_text,
                    "citations": citations_meta or None,
                },
            )
            saved_id = saved[0]["id"] if saved else None
            await activity.touch_subspace(subspace_id)
            await activity.bump(
                user.id,
                chat_messages=1,
                study_seconds=activity.SECONDS_PER_CHAT_MESSAGE,
            )
            yield _sse(
                "done",
                {
                    "message_id": saved_id,
                    "user_message_id": user_row["id"],
                    "citations": citations_meta,
                },
            )
        except ApiError as e:
            yield _sse("error", {"code": e.code, "message": e.message})
        except Exception as e:  # last-resort safety net
            log.exception("chat stream failed: %s", e)
            yield _sse(
                "error",
                {
                    "code": "internal_error",
                    "message": "Chat stopped unexpectedly.",
                },
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


# ── Internals ──────────────────────────────────────────────────────────


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()



async def _linked_subspace_ids(user_id: str, subspace_id: str) -> list[str]:
    links = await supabase.db_select(
        "subspace_links",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        select="linked_subspace_id",
    )
    return [row["linked_subspace_id"] for row in links]


async def _fetch_settings(user_id: str) -> dict:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    return rows[0] if rows else {}


def _skill_prompt(skill: dict) -> str:
    """A skill's reasoning-style instructions, plus its output-format
    dimension when set — one composed prompt fragment, not two."""
    text = skill.get("instructions", "").strip()
    output_format = (skill.get("output_format") or "").strip()
    if output_format:
        text += f"\n\nOutput format: {output_format}"
    return text


async def _active_skills(user_id: str, subspace_id: str) -> list[dict]:
    # Safe without a user filter only because the caller already proved this
    # subspace belongs to `user_id` — the service-role key ignores RLS.
    _ = user_id
    links = await supabase.db_select(
        "subspace_skills",
        filters={"subspace_id": f"eq.{subspace_id}"},
        select="skill_id",
    )
    if not links:
        return []
    ids = ",".join(link["skill_id"] for link in links)
    return await supabase.db_select(
        "skills", filters={"id": f"in.({ids})"}
    )

