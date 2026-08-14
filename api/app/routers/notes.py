"""Notes CRUD — supports user-authored and agent-generated origins."""

from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import ApiError, NotFound, NothingIndexed, UpstreamUnavailable
from ..guards import assert_subspace, subspace_label
from ..schemas import (
    Citation,
    NoteAiInline,
    NoteAiInlineOut,
    NoteCreate,
    NoteGenerate,
    NoteOut,
    NoteUpdate,
    OkOut,
)
from ..services import activity, personalization, rag, supabase
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


@router.get("/notes", response_model=list[NoteOut])
async def list_all_notes(
    user: CurrentUser = Depends(get_current_user), limit: int = 300
) -> list[NoteOut]:
    """Every note this user has, newest first, wherever it lives.

    Scoping notes to the topic you happen to be sitting in is a restriction the
    data never justified: a note is a thing the student wrote and should be
    reachable from anywhere they might want it — reading the Deadlock note while
    chatting about Virtual Memory is a completely ordinary thing to want, and
    the old sidebar made it a three-click round trip through another page.

    No `assert_*` guard because there is no caller-supplied row id to check:
    the filter IS `user_id`, applied server-side by PostgREST, which cannot
    return another user's rows. `test_guard_coverage.py` accepts this shape
    explicitly.

    The two joined names are fetched separately and stitched here rather than
    with a nested select, because PostgREST would repeat the subject name once
    per note; two small reads of a handful of rows each is less over the wire.
    """
    notes, subspaces, subjects = await asyncio.gather(
        supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user.id}"},
            order="updated_at.desc",
            limit=min(limit, 500),
        ),
        supabase.db_select(
            "subspaces", filters={"user_id": f"eq.{user.id}"}, select="id,subject_id,name"
        ),
        supabase.db_select("subjects", filters={"user_id": f"eq.{user.id}"}, select="id,name"),
    )
    subject_name = {s["id"]: s.get("name") for s in subjects}
    place = {
        s["id"]: (s.get("name"), subject_name.get(s.get("subject_id")))
        for s in subspaces
    }

    out: list[NoteOut] = []
    for row in notes:
        note = _to_note(row)
        sub_name, subj_name = place.get(row.get("subspace_id"), (None, None))
        out.append(
            note.model_copy(
                update={
                    "subspace_id": row.get("subspace_id"),
                    "subspace_name": sub_name,
                    "subject_name": subj_name,
                }
            )
        )
    return out


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
    # Gathered for the same reason as quizzes: independent reads should not
    # queue behind each other in front of a model call.
    retrieved, history, student_context = await asyncio.gather(
        rag.retrieve(subspace_id, topic, k=6),
        recent_history(user.id, subspace_id),
        personalization.build(user.id, "notes", subspace_id=subspace_id),
    )
    if not retrieved and not history:
        raise NothingIndexed()
    context = "\n\n".join(f"- {r.content}" for r in retrieved) or "(no indexed material yet)"
    grounded = bool(retrieved)
    recent = format_history(history) or "(no prior chat in this space)"
    if not settings.llm_configured:
        raise UpstreamUnavailable("Note generation isn't configured yet.")

    # The student's own words about how they want it, when they said anything.
    # Placed last in the prompt and marked as overriding, because a specific
    # request ("just a checklist") has to beat the general shape guidance
    # above it — otherwise the defaults quietly win and the instruction looks
    # ignored.
    style = (
        f"\n\nHOW THIS STUDENT WANTS IT — follow this over the guidance "
        f"above wherever they conflict:\n{body.instructions.strip()}"
        if body.instructions and body.instructions.strip()
        else ""
    )

    prompt = (
        f"Write a study note on '{topic}', within the subject '{label}' — "
        f"resolve any ambiguity in the topic name using that subject, not a "
        f"generic reading of the words.\n\n"
        f"Recent conversation in this space:\n{recent}\n\n"
        f"Material:\n{context}\n\n"
        "This is the note they will revise from, so it has to carry the "
        "actual content — not a summary of what the topic is about. Explain "
        "the mechanism, not just its name. Where the conversation above "
        "worked something out, keep the reasoning rather than the "
        "conclusion alone. Where a distinction was drawn, keep both sides "
        "of it. Include the concrete details that make a thing usable: the "
        "conditions, the formulas, the worked example, the exception. If "
        "the student got something wrong in the conversation and was "
        "corrected, the note should make the correct version unmissable.\n\n"
        f"{_length_rule(grounded)}\n\n"
        "Use headings to separate ideas, bullets for lists of things, bold "
        "for the term being defined, tables when comparing two things, and "
        "a blockquote for the one idea worth remembering above the rest. "
        "Never a heading with a single line under it."
        f"{style}\n\n"
        f"{_grounding_rule(grounded)}\n\n"
        "Reply in exactly this format and nothing else:\n\n"
        "TITLE: <the title>\n"
        "---\n"
        "<the note in markdown>\n\n"
        "The title is under 8 words with no trailing punctuation."
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

    title, note_body, parse_error = _split_titled_note(raw)

    if not title or not note_body:
        # Log the actual payload. Without this the user-facing message is the
        # only evidence there is, and "came back in an unexpected format" is
        # undebuggable — it cannot distinguish a truncated stream from bad
        # JSON from a model that answered in prose. Truncated because a note
        # body can be long and this is a log line, not an archive.
        log.warning(
            "note generation returned unusable output (%s); raw[:400]=%r",
            parse_error or "missing title or body",
            raw[:400],
        )
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


def _note_context(note_text: str) -> str:
    """What the model is shown of the note it's editing.

    Whole-note commands ("Summarise the note so far", "Expand the last point
    in this note") have nothing else to act on — an AI-generated note's own
    words never entered the indexed material or the chat history the rest of
    the prompt draws on, so without this the model was asked to summarise a
    note it had never actually seen.
    """
    return note_text.strip() or "(the note is empty so far)"


def _split_titled_note(raw: str) -> tuple[str | None, str | None, str | None]:
    """Pull `TITLE: …` / `---` / body out of a model response.

    **Why not JSON.** This asked for `{"title": ..., "body_md": ...}` and it
    failed almost every time in practice. Two separate ways: the model wrote
    real newlines inside the string (invalid — U+000A is a control
    character), and more often it dropped the opening quote altogether,
    emitting `"body_md": \nQ-learning converges...`. The second one is not
    recoverable by a lenient parser, because the value is not a string at
    all syntactically.

    The underlying problem is that JSON demands escaping over a long
    markdown payload, and escaping is exactly the thing a token predictor is
    worst at maintaining across hundreds of tokens. A line prefix and a
    delimiter have nothing to escape, so there is nothing to get wrong.

    Returns `(title, body, error)` — `error` is a short reason for the log
    when either part is missing.
    """

    text = raw.strip()
    # Models still sometimes wrap the whole reply in a fence.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    match = re.search(r"^\s*TITLE:\s*(.+?)\s*$", text, re.MULTILINE)
    if not match:
        return None, None, "no TITLE: line in the response"
    title = match.group(1).strip().strip('"').rstrip(".")[:140] or None

    rest = text[match.end() :]
    # The --- is the agreed separator, but a model that omits it has still
    # given us everything we need — the body is simply whatever follows.
    body = re.sub(r"^\s*-{3,}\s*\n?", "", rest.lstrip("\n"), count=1).strip()

    if not title:
        return None, None, "TITLE: line was empty"
    if not body:
        return None, None, "no body after the title"
    return title, body, None


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
    student_context = await personalization.build(
        user.id, "notes", subspace_id=subspace_id
    )
    note_text = _note_context(body.note_text)

    prompt = (
        f"The student is writing a note and typed this inline request: "
        f"'{body.prompt}'.\n\n"
        f"The note as it currently stands:\n{note_text}\n\n"
        f"Material:\n{context}\n\n"
        f"Recent conversation in this space:\n{recent}\n\n"
        "Write ONLY the markdown fragment to insert at their cursor — no "
        "title, no preamble, no restating the request. Ground it in the "
        "note, material and conversation above; do not invent facts not present "
        "in any of them.\n\n"
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
    # Carry the provenance back with the text. The retrieval already ran to
    # build the prompt above; discarding it here is what left an AI paragraph
    # in a note untraceable — see the note on `NoteAiInlineOut.citations`.
    # Only sources that actually reached the model are returned, so a claim
    # can never cite something the answer was not built from.
    citations = [
        Citation(
            marker=i,
            document_id=r.document_id,
            document_name=r.document_name,
            locator=r.locator,
            snippet=rag.snippet(r.content),
        )
        for i, r in enumerate(retrieved, start=1)
    ]
    return NoteAiInlineOut(content_md=content, citations=citations)


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


_CODE_SPAN = re.compile(r"```.*?```|`[^`\n]+`", re.S)


def _length_rule(grounded: bool) -> str:
    """How long the note should be, which depends on whether there is material.

    The single rule used to be "length follows the material — short when there
    genuinely isn't much to say". Read literally with an empty corpus, that is
    an instruction to write almost nothing, and it is why a note requested with
    no documents uploaded came back as four bullets.
    """
    if grounded:
        return (
            "Length follows the material: several hundred words when there is "
            "that much to say, short when there genuinely isn't. Do not pad, "
            "and do not compress a rich conversation into four bullets."
        )
    return (
        "There is no uploaded material for this topic, which is a reason to "
        "write MORE, not less — the note is the only thing the student will "
        "have to revise from. Write a full study note: several hundred words, "
        "structured, with the definitions, the mechanism, the trade-offs and "
        "at least one worked or concrete example. Do not hedge about the "
        "missing sources or apologise for them; just write the note."
    )


def _grounding_rule(grounded: bool) -> str:
    """What the note may be built from.

    With material, the rule is strict: every claim traceable, nothing invented.
    That is the product's central promise and it does not bend.

    With NO material it was the same sentence — "do not invent facts not
    present in either" — which forbade the model from using its own knowledge
    of the topic at all. The result was a note that could only paraphrase
    whatever happened to be in the recent chat, which is exactly the failure
    where asking for a note on one topic returned a rewrite of a different one.
    Space Learn is meant to be good without uploads and excellent with them;
    that instruction made it useless without them.
    """
    if grounded:
        return (
            "Ground every claim in the material and conversation above; do not "
            "invent facts not present in either."
        )
    return (
        "There is no indexed material, so write from your own knowledge of the "
        "subject, at the level the student is working at. Two rules still "
        "hold. First, the topic the student asked for is the subject of this "
        "note — if the recent conversation is about something else, ignore it "
        "rather than writing about what was discussed. Second, do not present "
        "anything as coming from the student's own documents or cite pages: "
        "there are none, and a fabricated citation is worse than no citation."
    )


def _demote_html(text: str) -> str:
    """Convert stray HTML in a model response into equivalent markdown.

    The editor stores markdown and is configured with `html: false`, so any
    tag that slips through is escaped and rendered as literal visible text —
    which is exactly how notes ended up containing a printed `<p>...</p>`.

    Instructing the model not to emit HTML is necessary but not sufficient:
    models regress under load and on unusual prompts, and a note is the
    student's own document. Belt and braces.

    Two things this has to get right that the first version didn't:

    1. **Entities, not just raw tags.** The model sometimes emits `&lt;p&gt;`
       rather than `<p>` — especially when the prompt tells it not to write
       HTML, which reads to some models as "escape it instead". The old guard
       returned early whenever there was no literal `<`, so entity-escaped
       tags passed through untouched, round-tripped through the markdown
       serializer, and landed in the note as visible `&lt;p&gt;`. That is the
       exact text a student reported seeing.
    2. **Code must survive.** A student asking about HTML or JSX gets an
       answer whose whole point is the tags in it. Stripping those would
       destroy the answer, so fenced blocks and inline spans are lifted out
       before any substitution runs and put back afterwards.
    """

    # Lift code out of harm's way first — everything below rewrites tags, and
    # inside a code span a tag is content, not markup.
    spans: list[str] = []

    def _stash(match: re.Match[str]) -> str:
        spans.append(match.group(0))
        return f"\x00{len(spans) - 1}\x00"

    text = _CODE_SPAN.sub(_stash, text)

    # Entity-encoded tags become real tags so the maps below can see them.
    # Done after stashing so `&lt;` written inside a code fence stays literal.
    # Peel escaping layers, not just one.
    #
    # `html.unescape` is a single pass: `&amp;lt;p&amp;gt;` becomes `&lt;p&gt;`
    # and stops there — still an entity, so the tag substitutions below never
    # see a `<` and the text ships with `&lt;p&gt;` visible. Double-escaping is
    # not hypothetical: it is what a save round-trip produces, and it is what a
    # student reported seeing twice. Bounded rather than `while changed`, so
    # malformed input cannot spin here. Matches `healEscapedHtml` on the
    # frontend, which had this right and this side did not.
    for _ in range(4):
        if "&" not in text:
            break
        unescaped = html.unescape(text)
        if unescaped == text:
            break
        text = unescaped

    if "<" in text:
        for pattern, replacement in _HTML_BLOCK_MAP:
            text = pattern.sub(replacement, text)
        # Anything still tag-shaped is decoration we have no mapping for; drop
        # the tag and keep whatever it wrapped.
        text = re.sub(r"</?[a-zA-Z][^>\n]{0,60}>", "", text)

    # Collapse the blank lines the substitutions above introduce.
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Restore code exactly as the model wrote it.
    text = re.sub(r"\x00(\d+)\x00", lambda m: spans[int(m.group(1))], text)
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
