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

from ..config import settings
from ..deps import CurrentUser, get_current_user
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
    retrieval,
    smalltalk,
    student_model,
    supabase,
    usage,
    why,
)
from ..services.chat_context import recent_history, topic_context
from ..services.embeddings import embed_question
from ..services.llm import get_llm, model_for
from ..services.query_resolver import Query
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
            suggestion=followup.clean((r.get("meta") or {}).get("suggestion")),
            personal=[str(x) for x in ((r.get("meta") or {}).get("personal") or [])][:5] or None,
            grounding=_grounding_out((r.get("meta") or {}).get("grounding")),
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
    # Validated before the quota is charged, so a rejected attachment does not
    # cost the student a request. Invalid images are dropped, not refused —
    # the text is the question, the image is an attachment to it.
    images = guardrails.validate_images(body.images)
    # An image costs more: it is a larger request, a slower model, and more
    # tokens in and out. Charging it as one plain turn would let a student
    # burn the free-tier budget three times faster than the quota implies.
    quota_cost = 2 if images else 1
    await consume_llm_quota(user.id, cost=quota_cost, daily=True)
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
        rag.linked_subspace_ids(user.id, subspace_id),
        student_model.snapshot(user.id),
    )

    history_limit = _history_limit(active_skills)
    # Where this turn is happening — subject, topic, linked topics, exam goal —
    # from rows already in hand: no extra query. It disambiguates every term
    # ("transformer" under Deep Learning is the architecture) and bounds what
    # the tutor will help with. See `chat_context.TopicContext`.
    ctx = topic_context(subspace, topics=snap.topics, linked_ids=linked_ids, settings=settings_row)
    scope = _scope(body.scope, settings_row)
    # A message that tries to change the tutor's role or rules. Never blocked —
    # the prompt's scope block decides what to do — but noted, and never cached.
    override = guardrails.looks_like_override(body.text)
    # `render_chat`, not `render` — the snapshot is already in hand above,
    # and chat (unlike quiz/cards/notes/brief) also runs the style bandit:
    # see `personalization.render_chat` / `style_bandit` for why chat is the
    # one task with a Thompson-sampled experiment layer. It depends on
    # nothing `recent_history`/`retrieve_with_links` produce (and they don't
    # depend on it either), so it runs alongside them rather than after —
    # style_bandit's own reads are cached per user, but on a cold cache this
    # is the difference between adding a full extra round trip to the
    # request and adding none.
    #
    # Retrieval needs the history too — a follow-up is searched as the question
    # it stands for — so it waits on the same fetch rather than a second one,
    # and still overlaps with everything else.
    history_task = asyncio.ensure_future(recent_history(user.id, subspace_id, limit=history_limit))

    async def find_sources() -> tuple[retrieval.Retrieval, bool]:
        earlier = _before_this_question(await history_task, body.text, body.regenerate)
        # "Hi", "thanks", "ok": nothing to look up, so nothing is — no follow-up
        # rewrite (a model call), no embedding, no search. Decided in code, from
        # a list of phrases (`services/smalltalk.py`); an image is always a question.
        if not images and smalltalk.is_small_talk(body.text, earlier):
            return retrieval.Retrieval(Query(body.text, body.text)), True
        found = await rag.search(
            body.text,
            subspace_id=subspace_id,
            linked_subspace_ids=linked_ids,
            history=earlier,
            topic=ctx.topic,
            subject=ctx.subject,
        )
        return found, False

    prior, (found, small_talk), (student_context, prefs_applied, style_applied) = await asyncio.gather(
        history_task,
        find_sources(),
        personalization.render_chat(snap, subspace_id, user.id),
    )
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
        answer_only_from_docs=scope == "files",
        always_show_citations=bool(settings_row.get("always_show_citations", True)),
        student_context=student_context,
        memory_summary=subspace.get("memory_summary") or "",
        sources_doubtful=found.confidence == "weak",
        suggest_followup=not small_talk,
        small_talk=small_talk,
        context=ctx,
        override_attempt=override,
    )

    # A question asked before, on the same sources and settings, is answered from what
    # was already written (see `answer_cache`): no model call, no tokens, no wait.
    cacheable = (
        settings.answer_cache_enabled
        and not body.regenerate
        and not images
        and not small_talk
        and not override
        and found.query.how == "as-is"
        and bool(retrieved)
    )
    cache_vec: list[float] = []
    cache_fp = ""
    cached: answer_cache.Cached | None = None
    if cacheable:
        try:
            cache_vec = (await embed_question([body.text]))[0]
            cache_fp = answer_cache.fingerprint(
                chunk_ids=[c.id for c in found.chunks],
                flags={
                    "scope": scope,
                    # Everything the prompt names that changes an answer: a renamed
                    # topic, a new link or a new exam goal is a different answer.
                    "context": ctx.key(),
                    "mentions": ctx.mentions(body.text),
                    "cite": bool(settings_row.get("always_show_citations", True)),
                    "skills": sorted(s["id"] for s in active_skills),
                    "prefs": prefs_applied,
                    "doubtful": found.confidence == "weak",
                },
            )
            cached = answer_cache.lookup(user.id, subspace_id, body.text, cache_vec, cache_fp)
        except Exception:  # noqa: BLE001 — a cache that fails must never fail the answer
            log.warning("answer cache unavailable", exc_info=True)
            cacheable = False

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

    # A regenerate REPLACES the answer it redoes. The answers already given to
    # this question are noted now and removed once the new one is saved, so a
    # failed attempt leaves the old answer in place and a good one leaves
    # exactly one — not a pile of attempts under the same question.
    superseded: list[str] = await _answers_to_replace(user.id, subspace_id) if body.regenerate else []

    # The model for this turn comes from the routing table (services/llm.py):
    # an image needs the vision model; small talk goes to the small one; and a
    # large model with nearly all of its day used is swapped for the small one
    # on purpose, so the answer starts at once instead of failing later.
    chat_task = "chat.smalltalk" if small_talk else "chat"
    model_for_turn = model_for(chat_task, images=bool(images))

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
                for piece in answer_cache.pieces(cached.answer):
                    buffer.append(piece)
                    yield _sse("token", {"delta": piece})
            else:
                with usage.task(chat_task):
                    async for delta in get_llm().stream_chat(
                        messages,
                        model=model_for_turn,
                        # Answering from their files is retrieval, not
                        # invention: less randomness, fewer made-up details.
                        temperature=0.2 if scope == "files" else 0.3,
                    ):
                        # The trailing "[[next: …]]" line is held back and never shown.
                        shown = follow.feed(delta)
                        if shown:
                            buffer.append(shown)
                            yield _sse("token", {"delta": shown})
                tail, suggestion = follow.finish()
                if tail:
                    buffer.append(tail)
                    yield _sse("token", {"delta": tail})
                # A suggestion that drifted off the material and the topic is
                # dropped in code, whatever the prompt said.
                suggestion = followup.on_topic(
                    suggestion, [r.content for r in retrieved] + [ctx.topic, ctx.subject, *ctx.linked]
                )
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
            # Then the clear cases word overlap can settle: a padded extra marker is dropped, a
            # marker moves to the source that holds the whole sentence. See `rag.tighten_citations`.
            assistant_text, tightened = rag.tighten_citations(assistant_text, [r.content for r in retrieved])
            if tightened:
                log.info("tightened %d citation marker(s)", tightened)
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
                "small-talk" if small_talk else found.query.how,
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
            # How much of the answer its own citations back, checked against the
            # student's files (no model call). Shown under the answer.
            grounded = (
                {"checked": 0, "backed": 0, "shaky": []}
                if small_talk
                else rag.grounding(assistant_text, [r.content for r in retrieved])
            )
            # What made this answer yours, in words (`services/why.py`): shown
            # under the reply and kept with it, so it survives a reload.
            personal = (
                []
                if small_talk
                else why.explain(
                    ctx=ctx,
                    style=cached.style if cached is not None else style_applied,
                    weak=personalization.chat_focus(snap, subspace_id),
                    sources=[c["document_name"] for c in (citations_meta or []) if c.get("marker") in used_markers],
                    scope=scope,
                )
            )
            saved = await supabase.db_insert(
                "chat_messages",
                {
                    "user_id": user.id,
                    "subspace_id": subspace_id,
                    "role": "assistant",
                    "content": assistant_text,
                    "citations": _used_sources(citations_meta, used_markers) or None,
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
                        # Nothing was searched because nothing was asked.
                        "small_talk": small_talk,
                        # How strictly this topic keeps to the files ("files" or
                        # "subject"), and whether the message tried to change the rules.
                        "scope": scope,
                        "override": override,
                        # Kept so the suggestion is still in the box after a reload.
                        "suggestion": suggestion,
                        "personal": personal,
                        "grounding": grounded,
                    },
                },
            )
            saved_id = saved[0]["id"] if saved else None
            if saved_id and superseded:
                for old_id in superseded:
                    try:
                        await supabase.db_delete(
                            "chat_messages",
                            filters={"id": f"eq.{old_id}", "user_id": f"eq.{user.id}"},
                        )
                    except Exception:  # noqa: BLE001 — a leftover old answer must never fail the new one
                        log.warning("could not remove superseded answer %s", old_id, exc_info=True)
            # Only a real answer is kept: a scope refusal or "not covered" must
            # never be handed to the next, on-topic wording of a question.
            if (
                cacheable
                and cached is None
                and cache_vec
                and answer_cache.worth_keeping(
                    assistant_text, cite=bool(settings_row.get("always_show_citations", True))
                )
            ):
                answer_cache.store(user.id, subspace_id, body.text, cache_vec, cache_fp, assistant_text, suggestion, style_applied)
            await activity.touch_subspace(subspace_id)
            await activity.bump(
                user.id,
                chat_messages=1,
                study_seconds=activity.SECONDS_PER_CHAT_MESSAGE,
            )
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
                    "citations": _used_sources(citations_meta, used_markers),
                    # The canonical stored text. Tokens were already streamed
                    # raw, so if any marker was stripped above the client's
                    # buffer now differs from what's in the database — it
                    # reconciles against this rather than showing one thing now
                    # and another after a refresh.
                    "content": assistant_text,
                    # One question the student might ask next, or null.
                    "suggestion": suggestion,
                    "personal": personal,
                    "grounding": grounded,
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


async def _answers_to_replace(user_id: str, subspace_id: str) -> list[str]:
    """Ids of the assistant messages after the student's latest question —
    the answers a regenerate is replacing."""
    rows = await supabase.db_select(
        "chat_messages",
        select="id,role",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
        limit=8,
    )
    out: list[str] = []
    for r in rows:
        if r.get("role") == "user":
            break
        if r.get("role") == "assistant":
            out.append(r["id"])
    return out


def _used_sources(citations: list[dict], used: set[int]) -> list[dict]:
    """The sources an answer actually cited, with their original marker numbers.

    Retrieval hands the model several candidate sources; an answer may lean on
    two of them, or on none (a refusal, a greeting, "that is not in your
    files"). Saving and showing all of them said "Answered from 6 sources" under
    an answer that used no source at all. Markers keep their numbers, so the
    text's [[3]] still points at source 3."""
    return [c for c in citations if c.get("marker") in used]


def _grounding_out(raw: object) -> dict | None:
    """The stored check, or None when there is nothing to show."""
    if not isinstance(raw, dict) or not raw.get("checked"):
        return None
    return {
        "checked": int(raw["checked"]),
        "backed": int(raw.get("backed") or 0),
        "shaky": [str(x)[:140] for x in (raw.get("shaky") or [])][:2],
    }


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


def _scope(requested: str | None, settings_row: dict) -> str:
    """The topic's strictness for this turn: "files" or "subject".

    Chosen per topic in the chat when the client sends one; otherwise the
    account-wide `answer_only_from_docs` decides ("files" when on, which is
    the default). Either way the tutor keeps to the topic and subject — scope
    is about where answers may come FROM, not what it will talk about."""
    if requested in ("files", "subject"):
        return requested
    return "files" if bool(settings_row.get("answer_only_from_docs", True)) else "subject"


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
    # created_at.asc: see the identical comment on skills.list_active_skills —
    # without an explicit order, which active skill "wins" a conflict (the
    # last one in `active_skill_instructions`, per `for_skill`'s own
    # docstring) could vary between two requests with the same active set.
    return await supabase.db_select(
        "skills", filters={"id": f"in.({ids})"}, order="created_at.asc"
    )

