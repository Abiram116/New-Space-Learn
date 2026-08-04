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

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, UpstreamUnavailable
from ..schemas import ChatMessageOut, ChatSend, Citation
from ..services import rag, supabase
from ..services.llm import get_llm

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
    await _assert_owned(user.id, subspace_id)
    rows = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.asc",
        limit=min(limit, 500),
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
    subspace = await _assert_owned(user.id, subspace_id)
    settings_row = await _fetch_settings(user.id)
    prior = await _recent_history(user.id, subspace_id)
    retrieved = await rag.retrieve(subspace_id, body.text)
    active_skills = await _active_skills(user.id, subspace_id)

    messages, citations_meta = rag.build_prompt(
        subspace_name=subspace["name"],
        active_skill_instructions=[s["instructions"] for s in active_skills],
        history=prior,
        question=body.text,
        retrieved=retrieved,
        answer_only_from_docs=bool(settings_row.get("answer_only_from_docs", True)),
        always_show_citations=bool(settings_row.get("always_show_citations", True)),
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
            await _bump_activity(user.id, subspace_id)
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


async def _assert_owned(user_id: str, subspace_id: str) -> dict:
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{subspace_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Subspace not found.")
    return rows[0]


async def _recent_history(user_id: str, subspace_id: str) -> list[dict[str, str]]:
    rows = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
        limit=8,
    )
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


async def _fetch_settings(user_id: str) -> dict:
    rows = await supabase.db_select(
        "user_settings", filters={"user_id": f"eq.{user_id}"}, limit=1
    )
    return rows[0] if rows else {}


async def _active_skills(user_id: str, subspace_id: str) -> list[dict]:
    _ = user_id  # RLS already scopes; explicit param for readability.
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


async def _bump_activity(user_id: str, subspace_id: str) -> None:
    try:
        await supabase.db_update(
            "subspaces",
            filters={"id": f"eq.{subspace_id}"},
            patch={"last_activity_at": datetime.now(UTC).isoformat()},
        )
        # Upsert today's activity row (increment chat count).
        today = date.today().isoformat()
        existing = await supabase.db_select(
            "daily_activity",
            filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
            limit=1,
        )
        if existing:
            await supabase.db_update(
                "daily_activity",
                filters={"user_id": f"eq.{user_id}", "day": f"eq.{today}"},
                patch={
                    "chat_messages": int(existing[0].get("chat_messages", 0)) + 1,
                    "study_seconds": int(existing[0].get("study_seconds", 0)) + 60,
                },
            )
        else:
            await supabase.db_insert(
                "daily_activity",
                {
                    "user_id": user_id,
                    "day": today,
                    "chat_messages": 1,
                    "study_seconds": 60,
                },
            )
    except UpstreamUnavailable:
        # Activity tracking is nice-to-have; never fail the chat over it.
        log.warning("activity bump failed, continuing")
