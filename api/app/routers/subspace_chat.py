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
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..config import settings
from ..deps import CurrentUser, get_chat_user, get_current_user
from ..errors import ApiError
from ..guards import assert_subspace
from ..schemas import ChatMessageOut, ChatSend, Citation
from ..services import (
    activity,
    answer_cache,
    chat_memory,
    context_budget,
    followup,
    guardrails,
    personalization,
    rag,
    ratelimit,
    readcache,
    retrieval,
    student_model,
    supabase,
    usage,
)
from ..services.chat_context import recent_history
from ..services.embeddings import embed_question
from ..services.llm import get_llm
from ..services.ratelimit import consume_llm_quota
from .skills import usable_skills_filter

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
            limit=max(1, min(limit, 500)),
        ),
    )
    return [
        ChatMessageOut(
            id=r["id"],
            role=r["role"],
            content=r["content"],
            citations=[Citation(**c) for c in (r.get("citations") or [])] or None,
            created_at=r["created_at"],
            suggestion=followup.clean((r.get("meta") or {}).get("suggestion")),
        )
        for r in rows
    ]


@router.post("/subspaces/{subspace_id}/chat")
async def send_chat(
    subspace_id: str,
    body: ChatSend,
    user: CurrentUser = Depends(get_chat_user),
) -> StreamingResponse:
    # This is the highest-traffic request in the app, and every database read in
    # it is a round trip to another country before the model call can even start.
    # So nothing waits for anything it does not depend on:
    #
    #   * the ownership check, the snapshot, the topic's skills and links are all
    #     started at once. The check gates everything that is USED (a request for
    #     someone else's topic is refused before any of it is read back), but it
    #     does not have to finish before the other reads begin: each of them is
    #     already scoped to this student or this topic, and their results are
    #     dropped unread if the check fails.
    #   * history needs only the skills (for its window size), and retrieval needs
    #     only the history (a follow-up is searched as the question it stands for)
    #     and the links, so that chain overlaps with the snapshot.
    #   * the student's own message is saved while the model starts, not before it.
    #
    # `settings` comes out of the snapshot (it carries the whole settings row) and
    # the snapshot may be a couple of minutes old: see `student_model.snapshot`.
    subspace_t = asyncio.ensure_future(assert_subspace(user.id, subspace_id))
    snap_t = asyncio.ensure_future(student_model.snapshot(user.id, max_age=_SNAPSHOT_MAX_AGE_S))
    links_t = asyncio.ensure_future(rag.linked_subspace_ids(user.id, subspace_id))
    skills_t = asyncio.ensure_future(_active_skills(user.id, subspace_id))

    async def load_history() -> list[dict[str, str]]:
        active = await skills_t
        return await recent_history(user.id, subspace_id, limit=_history_limit(active))

    history_t = asyncio.ensure_future(load_history())
    reads = (subspace_t, snap_t, links_t, skills_t, history_t)
    try:
        subspace = await subspace_t
        # Bounce over-eager callers before we do any model work.
        # Validated before the quota is charged, so a rejected attachment does not
        # cost the student a request. Invalid images are dropped, not refused —
        # the text is the question, the image is an attachment to it.
        images = guardrails.validate_images(body.images)
        # An image costs more: it is a larger request, a slower model, and more
        # tokens in and out. Charging it as one plain turn would let a student
        # burn the free-tier budget three times faster than the quota implies.
        quota_cost = 2 if images else 1
        await consume_llm_quota(user.id, cost=quota_cost, daily=True)
    except BaseException:
        _abandon(reads)
        raise

    async def find_sources() -> retrieval.Retrieval:
        earlier = _before_this_question(await history_t, body.text, body.regenerate)
        return await rag.search(
            body.text,
            subspace_id=subspace_id,
            linked_subspace_ids=await links_t,
            history=earlier,
            topic=subspace["name"],
        )

    # `render_chat`, not `render` — chat (unlike quiz/cards/notes/brief) also runs
    # the style bandit: see `personalization.render_chat` / `style_bandit` for why
    # chat is the one task with a Thompson-sampled experiment layer. It depends on
    # nothing history or retrieval produce, so it runs alongside them.
    async def personalise():
        return await personalization.render_chat(await snap_t, subspace_id, user.id)

    try:
        prior, found, (student_context, prefs_applied, style_applied), snap, active_skills = (
            await asyncio.gather(history_t, find_sources(), personalise(), snap_t, skills_t)
        )
    except BaseException:
        _abandon(reads)
        ratelimit.refund(user.id, quota_cost)
        raise
    settings_row = snap.settings or {}
    history_limit = _history_limit(active_skills)
    retrieved = [rag.as_retrieved(c) for c in found.chunks]
    messages, citations_meta = rag.build_prompt(
        subspace_name=subspace["name"],
        # The skill's mode composed WITH this student's weak concepts, rather
        # than the two handed to the model as separate paragraphs to reconcile.
        active_skill_instructions=[
            personalization.for_skill(s, snap, subspace_id=subspace_id)
            for s in active_skills
        ],
        # Shortened, free of stale citation markers and within a size ceiling: see
        # `context_budget`. Retrieval above still saw the full history, so a follow-up
        # is resolved against what was really said.
        history=context_budget.fit_history(prior),
        question=body.text,
        retrieved=retrieved,
        images=images,
        answer_only_from_docs=bool(settings_row.get("answer_only_from_docs", True)),
        always_show_citations=bool(settings_row.get("always_show_citations", True)),
        student_context=student_context,
        memory_summary=subspace.get("memory_summary") or "",
        sources_doubtful=found.confidence == "weak",
        suggest_followup=True,
    )

    # A question asked before, on the same sources and settings, is answered from what
    # was already written (see `answer_cache`): no model call, no tokens, no wait.
    cacheable = (
        settings.answer_cache_enabled
        and not body.regenerate
        and not images
        and found.query.how == "as-is"
        and bool(retrieved)
    )
    cache_fp = ""
    cached: answer_cache.Cached | None = None
    if cacheable:
        try:
            cache_fp = answer_cache.fingerprint(
                chunk_ids=[c.id for c in found.chunks],
                flags={
                    "only_docs": bool(settings_row.get("answer_only_from_docs", True)),
                    "cite": bool(settings_row.get("always_show_citations", True)),
                    "skills": sorted(s["id"] for s in active_skills),
                    "prefs": prefs_applied,
                    "doubtful": found.confidence == "weak",
                },
            )
            # The same words need no vector. A reworded question does, but only when
            # an answer to something is stored under these exact sources: embedding a
            # question costs real CPU on this machine, and on a first question
            # there is nothing to compare it with.
            cached = answer_cache.lookup(user.id, subspace_id, body.text, None, cache_fp)
            if cached is None and answer_cache.has_entries(user.id, subspace_id, cache_fp):
                vector = (await embed_question([body.text]))[0]
                cached = answer_cache.lookup(user.id, subspace_id, body.text, vector, cache_fp)
        except Exception:  # noqa: BLE001 — a cache that fails must never fail the answer
            log.warning("answer cache unavailable", exc_info=True)
            cacheable = False

    # Persist the user's turn so refresh shows it even mid-stream — but alongside the
    # model call, not ahead of it (it is awaited before the first word goes out).
    # Skipped on a regenerate: the question is already on the record from the
    # first attempt, and this is another attempt at the same one, not a new
    # turn — inserting it again would show the question twice for one answer
    # that changed.
    user_insert_t: asyncio.Future | None = None
    if not body.regenerate:
        user_insert_t = asyncio.ensure_future(
            supabase.db_insert(
                "chat_messages",
                {
                    "user_id": user.id,
                    "subspace_id": subspace_id,
                    "role": "user",
                    "content": body.text,
                },
            )
        )

    # When the large model has used nearly all of its day, go to the small one on purpose:
    # the answer starts at once, instead of failing against a spent allowance first.
    # (An image needs the vision model whatever the allowance.)
    large_nearly_spent = usage.near_daily_limit(
        settings.groq_model, settings.groq_daily_token_limit, settings.groq_switch_at
    )
    if large_nearly_spent and not images:
        log.warning("large model nearly out of its daily tokens; answering this turn with the small one")
    model_for_turn = (
        settings.groq_model_vision
        if images
        else (settings.groq_model_fast if large_nearly_spent else None)
    )

    user_row: dict | None = None

    async def user_saved() -> None:
        """The student's message is on the record. Awaited before the first word of
        the answer goes out, so an answer never appears for a question that was lost."""
        nonlocal user_row
        if user_insert_t is not None and user_row is None:
            user_row = (await user_insert_t)[0]

    if user_insert_t is not None:
        user_insert_t.add_done_callback(_quiet)

    async def gen() -> AsyncIterator[bytes]:
        buffer: list[str] = []
        follow = followup.FollowUpFilter()
        suggestion: str | None = None
        try:
            # Emit citations up front so the UI can render source cards
            # while tokens are still streaming in.
            for c in citations_meta:
                yield _sse("citation", c)
            # The vision model, only when there is something to see.
            #
            # This is a real trade, not a free upgrade: the image-capable model
            # is smaller than the 70B used for text, so attaching a screenshot
            # buys sight at the cost of reasoning. Routing every turn through it
            # "for consistency" would quietly make every text answer worse.
            if cached is not None:
                # Nothing was generated, so it does not count against the student's day either.
                ratelimit.refund(user.id, quota_cost)
                log.info("chat turn answered from the answer cache subspace=%s user=%s", subspace_id, user.id)
                suggestion = cached.suggestion
                await user_saved()
                for piece in answer_cache.pieces(cached.answer):
                    buffer.append(piece)
                    yield _sse("token", {"delta": piece})
            else:
                with usage.task("chat"):
                    async for delta in get_llm().stream_chat(
                        messages,
                        model=model_for_turn,
                    ):
                        # The trailing "[[next: …]]" line is held back and never shown.
                        shown = follow.feed(delta)
                        if shown:
                            await user_saved()
                            buffer.append(shown)
                            yield _sse("token", {"delta": shown})
                tail, suggestion = follow.finish()
                if tail:
                    buffer.append(tail)
                    yield _sse("token", {"delta": tail})
            await user_saved()
            assistant_text = "".join(buffer).strip() or "(no reply)"
            # The model was told to cite only the sources it was given, but an
            # instruction isn't a guarantee. A marker pointing at a source that
            # doesn't exist renders as an unclickable citation — a broken
            # promise, which is worse than no citation at all.
            assistant_text = rag.normalize_citation_markers(assistant_text, len(citations_meta))
            assistant_text, dropped = rag.strip_invalid_citations(
                assistant_text, len(citations_meta)
            )
            if dropped:
                log.warning(
                    "dropped out-of-range citation markers %s (had %d sources)",
                    dropped,
                    len(citations_meta),
                )
            # A marker pointing at a source that doesn't contain its sentence,
            # when another source plainly does, is moved there. Like the line
            # above, the client reconciles to the stored `content` on "done".
            assistant_text, moved = rag.repoint_citations(assistant_text, [r.content for r in retrieved])
            if moved:
                log.info("moved %d citation marker(s) to the source that supports them", moved)
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
                "chat turn subspace=%s user=%s query=%s confidence=%s retrieved=%s cited=%s",
                subspace_id,
                user.id,
                found.query.how,
                found.confidence,
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
            # Saving the answer and filing it for next time (which embeds the question,
            # real work for this CPU) overlap; neither waits for the other.
            remember = (
                _remember_answer(
                    user.id, subspace_id, body.text, cache_fp, assistant_text, suggestion, style_applied
                )
                if cacheable and cached is None
                else _nothing()
            )
            saved, _ = await asyncio.gather(
                supabase.db_insert(
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
                            # {key: value} for the three style dimensions in
                            # force on this message (real preference or sampled
                            # experiment) — `style_bandit` reads this back to
                            # score a later feedback tap against it.
                            "style": cached.style if cached is not None else style_applied,
                            # What was searched for, what came back and what was
                            # used — so "why did it answer that?" can be read off
                            # the message instead of re-run.
                            "retrieval": found.trace(),
                            # Kept so the suggestion is still in the box after a reload.
                            "suggestion": suggestion,
                        },
                    },
                ),
                remember,
            )
            saved_id = saved[0]["id"] if saved else None
            # The bookkeeping (the topic's "last opened", today's counters) is not
            # something the student is waiting for, and it is three more round
            # trips in a row. It runs after the answer is out; a task of its own so
            # that a closed tab cannot cancel it half-way.
            _spawn(_after_turn(user.id, subspace_id))
            # Fire-and-forget: folds older turns into the topic's rolling
            # summary once enough have scrolled out of the live history
            # window. Scheduled, not awaited — must never delay this
            # response, and never fails it (see chat_memory.update_memory).
            chat_memory.schedule_update(user.id, subspace_id, subspace, history_limit)
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
                    # One question the student might ask next, or null.
                    "suggestion": suggestion,
                },
            )
        except ApiError as e:
            # No answer was made, so no answer is used up.
            ratelimit.refund(user.id, quota_cost)
            yield _sse("error", {"code": e.code, "message": e.message})
        except Exception as e:  # last-resort safety net
            ratelimit.refund(user.id, quota_cost)
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


#: How old the snapshot chat builds its prompt from may be. A quiz, a feedback tap or a
#: settings change clears it regardless (see `deps.get_chat_user`); this only bounds
#: how long the passing of time alone is ignored.
_SNAPSHOT_MAX_AGE_S = 120.0

_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    """Run `coro` to completion on its own: not tied to the response, and kept
    referenced so it cannot be collected half-way."""
    task = asyncio.ensure_future(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


def _quiet(future: asyncio.Future) -> None:
    """Mark a future's failure as seen. Its owner may never get to look (the
    request failed first), and an unseen failure is logged as a warning at exit."""
    if not future.cancelled():
        future.exception()


def _abandon(futures) -> None:
    for future in futures:
        future.add_done_callback(_quiet)
        future.cancel()


async def _nothing() -> None:
    return None


async def _after_turn(user_id: str, subspace_id: str) -> None:
    await asyncio.gather(
        activity.touch_subspace(subspace_id),
        activity.bump(
            user_id,
            chat_messages=1,
            study_seconds=activity.SECONDS_PER_CHAT_MESSAGE,
        ),
    )
    # Home and Profile should count this message; the snapshot chat itself reuses
    # does not need to (see `student_model.invalidate_reads`).
    student_model.invalidate_reads(user_id)


async def _remember_answer(
    user_id: str,
    subspace_id: str,
    question: str,
    fingerprint: str,
    answer: str,
    suggestion: str | None,
    style: dict | None,
) -> None:
    try:
        vector = (await embed_question([question]))[0]
        answer_cache.store(user_id, subspace_id, question, vector, fingerprint, answer, suggestion, style)
    except Exception:  # noqa: BLE001 — a cache that fails must never fail the answer
        log.warning("answer cache could not store this answer", exc_info=True)


def _before_this_question(history: list[dict[str, str]], question: str, regenerate: bool) -> list[dict[str, str]]:
    """The conversation as it stood before this question was asked.

    On a regenerate the question is already the last thing the student said,
    so it (and anything after it) is dropped: otherwise a follow-up would be
    resolved against itself as "the previous question"."""
    if not regenerate:
        return history
    for i in range(len(history) - 1, -1, -1):
        if history[i].get("role") == "user" and history[i].get("content") == question:
            return history[:i]
    return history


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()



#: A skill's memory_scope is a real behavior dimension, not decoration:
#: "topic"/"all" pull a longer history window so the model actually has more
#: to work with, not just a longer prompt for its own sake.
_SCOPE_LIMIT = {"session": 8, "topic": 20, "all": 40}


def _history_limit(active_skills: list[dict]) -> int:
    """How many prior turns to load, given whichever active skills ask for the
    widest window.

    One skill wanting "all" of the topic's history outweighs another still
    set to "session" — a skill can only ask for *more* context than the
    8-message default, never take it away from a skill that wants it. Pulled
    out of `send_chat` as its own function because it is real branching logic
    (unknown/missing memory_scope silently falls back to 8) that was
    otherwise only reachable by mocking a live chat request.
    """
    return max(
        (_SCOPE_LIMIT.get(s.get("memory_scope", "session"), 8) for s in active_skills),
        default=8,
    )


_SKILLS = readcache.UserCache[list[dict]](maxsize=512, ttl=120.0)


async def _active_skills(user_id: str, subspace_id: str) -> list[dict]:
    """The skills switched on for this topic. Read on every turn, changed only when
    the student toggles one (a write, which clears this: see `readcache`)."""
    hit = _SKILLS.get(user_id, subspace_id)
    if hit is not None:
        return hit
    began = time.monotonic()
    skills = await _read_active_skills(user_id, subspace_id)
    _SKILLS.set(user_id, subspace_id, skills, read_at=began)
    return skills


async def _read_active_skills(user_id: str, subspace_id: str) -> list[dict]:
    # Safe without a user filter only because the caller proves this subspace
    # belongs to the user before anything read here is used — the service-role key
    # ignores RLS.
    links = await supabase.db_select(
        "subspace_skills",
        filters={"subspace_id": f"eq.{subspace_id}"},
        select="skill_id",
    )
    if not links:
        return []
    ids = ",".join(link["skill_id"] for link in links)
    # created_at.asc: see the identical comment on skills.list_active_skills —
    # without an explicit order, which active skill "wins" a conflict (the
    # last one in `active_skill_instructions`, per `for_skill`'s own
    # docstring) could vary between two requests with the same active set.
    return await supabase.db_select(
        "skills", filters=usable_skills_filter(user_id, ids), order="created_at.asc"
    )
