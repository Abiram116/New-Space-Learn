"""Notes CRUD — supports user-authored and agent-generated origins."""

from __future__ import annotations

import re

import asyncio
import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, NothingIndexed, UpstreamUnavailable
from ..guards import assert_subspace, subspace_label
from ..schemas import (
    NoteAiInline,
    NoteAiInlineOut,
    NoteCreate,
    NoteGenerate,
    NoteOut,
    NoteUpdate,
    OkOut,
)
from ..services import activity, rag, student_model, supabase
from ..services.chat_context import format_history, recent_history
from ..services.llm import get_llm
from ..services.ratelimit import consume_llm_quota
from ..services.voice import NOTES_AGENT_VOICE

log = logging.getLogger("space_learn.notes")
router = APIRouter()


def _to_note(row: dict) -> NoteOut:
    return NoteOut(
        id=row["id"],
        title=row["title"],
        body_md=row.get("body_md", ""),
        origin=row.get("origin", "user"),
        source_ids=row.get("source_ids"),
        updated_at=row["updated_at"],
    )


@router.get("/subspaces/{subspace_id}/notes", response_model=list[NoteOut])
async def list_notes(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[NoteOut]:
    # The guard and the read are independent: the read is already scoped to
    # `user_id`, so it cannot return another user's rows even if the guard
    # were to fail. Running them together saves a round trip on a request
    # the notes page blocks on. The guard's result is still awaited, so an
    # unowned subspace raises 404 before anything is returned.
    _, rows = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="updated_at.desc",
        ),
    )
    return [_to_note(r) for r in rows]


@router.post(
    "/subspaces/{subspace_id}/notes", response_model=NoteOut, status_code=201
)
async def create_note(
    subspace_id: str,
    body: NoteCreate,
    user: CurrentUser = Depends(get_current_user),
) -> NoteOut:
    await assert_subspace(user.id, subspace_id)
    now = datetime.now(UTC).isoformat()
    inserted = await supabase.db_insert(
        "notes",
        {
            "user_id": user.id,
            "subspace_id": subspace_id,
            "title": body.title,
            "body_md": body.body_md,
            "origin": body.origin,
            "updated_at": now,
        },
    )
    return _to_note(inserted[0])


@router.post(
    "/subspaces/{subspace_id}/notes/generate", response_model=NoteOut, status_code=201
)
async def generate_note(
    subspace_id: str,
    body: NoteGenerate,
    user: CurrentUser = Depends(get_current_user),
) -> NoteOut:
    """Write a real study note from this space's material and recent chat,
    rather than just copying the last chat reply verbatim into a note row."""

    subspace = await assert_subspace(user.id, subspace_id)
    await consume_llm_quota(user.id, cost=2)

    topic = body.topic or "the key concepts in this material"
    label = subspace_label(subspace)
    retrieved = await rag.retrieve(subspace_id, topic, k=6)
    history = await recent_history(user.id, subspace_id)
    if not retrieved and not history:
        raise NothingIndexed()
    context = "\n\n".join(f"- {r.content}" for r in retrieved) or "(no indexed material yet)"
    recent = format_history(history) or "(no prior chat in this space)"
    student_context = student_model.format_for_prompt(await student_model.get(user.id))

    if not settings.llm_configured:
        raise UpstreamUnavailable("Note generation isn't configured yet.")

    prompt = (
        f"Write a study note on '{topic}', within the subject '{label}' — "
        f"resolve any ambiguity in the topic name using that subject, not a "
        f"generic reading of the words.\n\n"
        f"Recent conversation in this space:\n{recent}\n\n"
        f"Material:\n{context}\n\n"
        'Return ONLY a JSON object: {"title": str, "body_md": str}. '
        "title is under 8 words, no punctuation at the end. body_md is the "
        "note itself in markdown — headings, bullets, bold where it earns "
        "its place. Ground every claim in the material and conversation "
        "above; do not invent facts not present in either. No prose outside "
        "the JSON object."
    )

    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {
                    "role": "system",
                    "content": NOTES_AGENT_VOICE
                    + (f"\n\n{student_context}" if student_context else ""),
                },
                {"role": "user", "content": prompt},
            ],
            model=settings.groq_model,
            temperature=0.4,
        ):
            parts.append(delta)
        raw = "".join(parts)
    except ApiError:
        raise
    except Exception as e:
        log.exception("note generation failed")
        raise UpstreamUnavailable("Couldn't write a note just now.") from e

    start, end = raw.find("{"), raw.rfind("}")
    title, note_body = None, None
    if start != -1 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            title = str(data.get("title", "")).strip()[:140] or None
            note_body = str(data.get("body_md", "")).strip() or None
        except json.JSONDecodeError:
            pass

    if not title or not note_body:
        raise UpstreamUnavailable(
            "The note came back in an unexpected format. Try again."
        )

    now = datetime.now(UTC).isoformat()
    inserted = await supabase.db_insert(
        "notes",
        {
            "user_id": user.id,
            "subspace_id": subspace_id,
            "title": title,
            "body_md": note_body,
            "origin": "agent",
            "updated_at": now,
        },
    )
    await activity.touch_subspace(subspace_id)
    return _to_note(inserted[0])


@router.post(
    "/subspaces/{subspace_id}/notes/ai-inline", response_model=NoteAiInlineOut
)
async def note_ai_inline(
    subspace_id: str,
    body: NoteAiInline,
    user: CurrentUser = Depends(get_current_user),
) -> NoteAiInlineOut:
    """Backs the `/ai <prompt>` command typed inline in the notes editor —
    returns a markdown fragment to insert at the cursor, not a new note."""

    await assert_subspace(user.id, subspace_id)
    await consume_llm_quota(user.id)

    if not settings.llm_configured:
        raise UpstreamUnavailable("AI isn't configured yet.")

    retrieved = await rag.retrieve(subspace_id, body.prompt, k=6)
    context = "\n\n".join(f"- {r.content}" for r in retrieved) or "(no indexed material yet)"
    history = await recent_history(user.id, subspace_id)
    recent = format_history(history) or "(no prior chat in this space)"
    student_context = student_model.format_for_prompt(await student_model.get(user.id))

    prompt = (
        f"The student is writing a note and typed this inline request: "
        f"'{body.prompt}'.\n\n"
        f"Material:\n{context}\n\n"
        f"Recent conversation in this space:\n{recent}\n\n"
        "Write ONLY the markdown fragment to insert at their cursor — no "
        "title, no preamble, no restating the request. Ground it in the "
        "material and conversation above; do not invent facts not present "
        "in either.\n\n"
        "Output PLAIN MARKDOWN ONLY. Never emit HTML tags — no <p>, <br>, "
        "<h1>, <ul>, <div>, <strong>. The editor renders markdown and shows "
        "any HTML you write as literal visible text, so a stray <p> ends up "
        "printed in the student's note. Use markdown syntax for every "
        "structure: # for headings, - for bullets, > for quotes, ``` for "
        "code, **bold**. Do not wrap the whole answer in a code fence."
    )

    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {
                    "role": "system",
                    "content": NOTES_AGENT_VOICE
                    + (f"\n\n{student_context}" if student_context else ""),
                },
                {"role": "user", "content": prompt},
            ],
            model=settings.groq_model,
            temperature=0.4,
        ):
            parts.append(delta)
        content = "".join(parts).strip()
    except ApiError:
        raise
    except Exception as e:
        log.exception("inline note AI failed")
        raise UpstreamUnavailable("Couldn't reach the AI just now.") from e

    content = _demote_html(content)
    if not content:
        raise UpstreamUnavailable("Came back empty. Try rephrasing.")
    return NoteAiInlineOut(content_md=content)


# Block-level tags the model reaches for most, mapped to their markdown
# equivalent so structure survives the conversion instead of being deleted.
_HTML_BLOCK_MAP = [
    (re.compile(r"</?(p|div|section|article)\b[^>]*>", re.I), "\n"),
    (re.compile(r"<br\s*/?>", re.I), "\n"),
    (re.compile(r"<h1\b[^>]*>", re.I), "\n# "),
    (re.compile(r"<h2\b[^>]*>", re.I), "\n## "),
    (re.compile(r"<h3\b[^>]*>", re.I), "\n### "),
    (re.compile(r"<li\b[^>]*>", re.I), "\n- "),
    (re.compile(r"<blockquote\b[^>]*>", re.I), "\n> "),
    (re.compile(r"</?(strong|b)\b[^>]*>", re.I), "**"),
    (re.compile(r"</?(em|i)\b[^>]*>", re.I), "*"),
]


def _demote_html(text: str) -> str:
    """Convert stray HTML in a model response into equivalent markdown.

    The editor stores markdown and is configured with `html: false`, so any
    tag that slips through is escaped and rendered as literal visible text —
    which is exactly how notes ended up containing a printed `<p>...</p>`.

    Instructing the model not to emit HTML is necessary but not sufficient:
    models regress under load and on unusual prompts, and a note is the
    student's own document. Belt and braces.
    """
    if "<" not in text:
        return text.strip()

    for pattern, replacement in _HTML_BLOCK_MAP:
        text = pattern.sub(replacement, text)
    # Anything still tag-shaped is decoration we have no mapping for; drop the
    # tag and keep whatever it wrapped.
    text = re.sub(r"</?[a-zA-Z][^>\n]{0,60}>", "", text)
    # Collapse the blank lines the substitutions above introduce.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@router.patch("/notes/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: str,
    body: NoteUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> NoteOut:
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        rows = await supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Note not found.")
        return _to_note(rows[0])
    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = await supabase.db_update(
        "notes",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"},
        patch=patch,
    )
    if not updated:
        raise NotFound("Note not found.")
    return _to_note(updated[0])


@router.delete("/notes/{note_id}", response_model=OkOut)
async def delete_note(
    note_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "notes", filters={"user_id": f"eq.{user.id}", "id": f"eq.{note_id}"}
    )
    return OkOut()
