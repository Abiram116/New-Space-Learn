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
from ..services import activity, personalization, rag, student_model, supabase
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
    # Two waves, not six sequential awaits.
    #
    # This is the highest-traffic request in the app and every one of these was
    # a separate round trip to a remote Postgres before the model call even
    # started. Only two real dependencies exist: the history window needs the
    # active skills' `memory_scope`, and retrieval needs the linked subspace
    # ids. Everything else was sequential by habit.
    settings_row, active_skills, linked_ids, snap = await asyncio.gather(
        _fetch_settings(user.id),
        _active_skills(user.id, subspace_id),
        _linked_subspace_ids(user.id, subspace_id),
        student_model.snapshot(user.id),
    )

    # A skill's memory_scope is a real behavior dimension, not decoration:
    # "topic"/"all" pull a longer history window so the model actually has
    # more to work with, not just a longer prompt for its own sake.
    scope_limit = {"session": 8, "topic": 20, "all": 40}
    history_limit = max(
        (scope_limit.get(s.get("memory_scope", "session"), 8) for s in active_skills),
        default=8,
    )
    prior, retrieved = await asyncio.gather(
        recent_history(user.id, subspace_id, limit=history_limit),
        rag.retrieve_with_links(subspace_id, body.text, linked_ids),
    )

    messages, citations_meta = rag.build_prompt(
        subspace_name=subspace["name"],
        # The skill's mode composed WITH this student's weak concepts, rather
        # than the two handed to the model as separate paragraphs to reconcile.
        active_skill_instructions=[
            personalization.for_skill(s, snap, subspace_id=subspace_id)
            for s in active_skills
        ],
        history=prior,
        question=body.text,
        retrieved=retrieved,
        answer_only_from_docs=bool(settings_row.get("answer_only_from_docs", True)),
        always_show_citations=bool(settings_row.get("always_show_citations", True)),
        # `render`, not `build` — the snapshot is already in hand above.
        student_context=personalization.render(snap, "chat", subspace_id=subspace_id),
    )
    # Recorded on the assistant row below, so a later "this helped" can be
    # attributed to the preferences that were actually in force.
    prefs_applied = personalization.applied_keys(snap)

    # Persist the user's turn immediately so refresh shows it even mid-stream.
    # Skipped on a regenerate: the question is already on the record from the
    # first attempt, and this is another attempt at the same one, not a new
    # turn — inserting it again would show the question twice for one answer
    # that changed.
    user_row: dict | None = None
    if not body.regenerate:
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
            # The model was told to cite only the sources it was given, but an
            # instruction isn't a guarantee. A marker pointing at a source that
            # doesn't exist renders as an unclickable citation — a broken
            # promise, which is worse than no citation at all.
            assistant_text, dropped = rag.strip_invalid_citations(
                assistant_text, len(citations_meta)
            )
            if dropped:
                log.warning(
                    "dropped out-of-range citation markers %s (had %d sources)",
                    dropped,
                    len(citations_meta),
                )
            # The retrieval audit trail. `chat_messages.citations` is the
            # user-facing record (doc, locator, snippet, kept forever on the
            # row) — this is the operator-facing one: which chunks the vector
            # search actually returned and how similar each was, so a "why
            # did it answer that" question can be answered from the log
            # without re-running the retrieval. One line per turn, not a new
            # table — this is exactly the amount of audit trail this product
            # needs today.
            used_markers = {int(n) for n in rag.cited_markers(assistant_text)}
            log.info(
                "chat turn subspace=%s user=%s retrieved=%s cited=%s",
                subspace_id,
                user.id,
                [
                    {
                        "marker": i,
                        "document_id": r.document_id,
                        "document_name": r.document_name,
                        "locator": r.locator,
                        "similarity": round(r.similarity, 4),
                    }
                    for i, r in enumerate(retrieved, start=1)
                ],
                sorted(used_markers),
            )
            saved = await supabase.db_insert(
                "chat_messages",
                {
                    "user_id": user.id,
                    "subspace_id": subspace_id,
                    "role": "assistant",
                    "content": assistant_text,
                    "citations": citations_meta or None,
                    # What shaped this answer. Feedback about it is only
                    # interpretable against the settings that produced it —
                    # "this helped" says nothing without knowing what was
                    # applied. Also the hook Phase 4's strategy label needs.
                    "meta": {
                        "chars": len(assistant_text),
                        "had_sources": bool(citations_meta),
                        "skill_ids": [s["id"] for s in active_skills],
                        "prefs_applied": prefs_applied,
                    },
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
                    "user_message_id": user_row["id"] if user_row else None,
                    "citations": citations_meta,
                    # The canonical stored text. Tokens were already streamed
                    # raw, so if any marker was stripped above the client's
                    # buffer now differs from what's in the database — it
                    # reconciles against this rather than showing one thing now
                    # and another after a refresh.
                    "content": assistant_text,
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

