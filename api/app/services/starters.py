"""Questions to start a topic's chat from, written from the topic's own files.

The chat used to open with the same four ideas for every topic ("Summarise the
key ideas in my files", "What might an exam ask about this?"). True of any
file, so they said nothing about this one, and students skipped them.

These are made from what the files actually contain: the section headings
ingestion already stored on every chunk, plus the opening lines of a few of
those sections. The small fast model turns that into four questions, once per
set of files — the result is cached until a file is added or removed, so a
topic's chat costs one short call the first time it opens and nothing after.

If the model is slow, rate-limited or answers badly, the headings alone still
make usable questions ("How does gradient descent work?"), so the chat never
waits on this and never opens empty-handed when there is something to ask.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re

from ..config import settings
from . import supabase, usage
from .llm import get_llm, loads_lenient
from .memo import TTLCache

log = logging.getLogger("space_learn.starters")

#: How many questions a chat opens with.
COUNT = 4
#: The longest a question may be, in characters (about 12 words).
MAX_LEN = 90
#: Headings read per topic, spread across its files.
MAX_SECTIONS = 12
#: Sections whose opening lines the model also sees.
EXCERPTS = 5
EXCERPT_CHARS = 220
TIMEOUT_S = 6.0

#: A set of files gets its questions once; a new or deleted file is a new key.
_CACHE: TTLCache[list[str]] = TTLCache(maxsize=512, ttl=12 * 3600)

# Headings that name a part of a document, not an idea in it.
_BOILERPLATE = re.compile(
    r"^(introduction|intro|overview|summary|conclusions?|references|bibliography|contents|"
    r"table of contents|abstract|appendix.*|acknowledg(e)?ments?|exercises?|problems|"
    r"questions|further reading|notes|preface|index|chapter \d+|section \d+|part [ivx\d]+|"
    r"(lecture|unit|module|week) \d+.*)$",
    re.IGNORECASE,
)

_PROMPT = """A student has just opened their study files for the topic "{topic}"{subject_clause} and is about to ask a tutor about them.
Below are section headings from those files, and the opening lines of some sections.

Write {count} questions the student could ask first. Rules:
- Every question must be about "{topic}"{subject_rule}. A file in this topic can contain sections about something else (a tool, a setup guide, an appendix); skip those and never ask about them.
- Each names a specific idea, term or method from the headings or excerpts. Never "the key ideas", "this topic" or "my files".
- Each is one short question, under 12 words, ending with "?".
- Make them different kinds: one asks what something is, one how something works or why, one compares two things or asks for an example, one checks understanding.
- Use the files' own words. Do not invent ideas that are not there.

Reply with JSON only: {{"questions": ["...", "..."]}}

Headings:
{headings}

Excerpts:
{excerpts}"""


def _leaf(section: str) -> str:
    """The last part of a heading path ("Optimisers › Momentum" → "Momentum")."""
    return section.split("›")[-1].strip().strip(".:")


def _usable(heading: str) -> bool:
    return 3 <= len(heading) <= 60 and not _BOILERPLATE.match(heading) and not heading.isdigit()


def clean(raw: object) -> str | None:
    """One question, if it is fit to show."""
    if not isinstance(raw, str):
        return None
    text = re.sub(r"\s+", " ", raw).strip().strip("\"'“”-•* ")
    if not text or len(text) > MAX_LEN or "[[" in text or "```" in text:
        return None
    if not text.endswith("?"):
        return None
    return text[0].upper() + text[1:]


def from_headings(headings: list[str]) -> list[str]:
    """Questions from the headings alone — what the chat offers without a model."""
    shapes = ["What is {}?", "How does {} work?", "Can you give an example of {}?", "Why does {} matter?"]
    out: list[str] = []
    for i, h in enumerate(headings):
        q = clean(shapes[i % len(shapes)].format(h))
        if q and q not in out:
            out.append(q)
        if len(out) == COUNT:
            break
    return out


@usage.tagged("chat.starters")
async def _ask_model(prompt: str) -> str:
    parts: list[str] = []
    async for delta in get_llm().stream_chat(
        [{"role": "user", "content": prompt}], model=settings.groq_model_fast, temperature=0.4
    ):
        parts.append(delta)
    return "".join(parts)


def _spread(rows: list[dict], limit: int) -> list[dict]:
    """One section at a time from each file in turn, so a long file can't take every slot."""
    by_doc: dict[str, list[dict]] = {}
    seen: set[str] = set()
    for r in rows:
        leaf = _leaf(r.get("section") or "")
        if not _usable(leaf) or leaf.lower() in seen:
            continue
        seen.add(leaf.lower())
        by_doc.setdefault(r["document_id"], []).append({**r, "leaf": leaf})
    picked: list[dict] = []
    queues = list(by_doc.values())
    while queues and len(picked) < limit:
        for q in list(queues):
            if q:
                picked.append(q.pop(0))
                if len(picked) == limit:
                    break
            else:
                queues.remove(q)
    return picked


async def for_subspace(user_id: str, subspace_id: str, topic: str = "", subject: str = "") -> list[str]:
    """Up to four questions about this topic's files. Never raises.

    `topic` and `subject` are the student's own names for where these files live:
    they say what the questions must be ABOUT, so a stray section of a file
    (a FastAPI setup guide inside a Python-classes topic) cannot become a
    suggestion for a topic it does not belong to."""
    try:
        rows = await supabase.db_select(
            "document_chunks",
            filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
            select="id,document_id,chunk_index,section",
            order="document_id.asc,chunk_index.asc",
            limit=3000,
        )
    except Exception:  # noqa: BLE001 — starters are a nicety; the chat must open regardless
        log.warning("could not read sections for starters subspace=%s", subspace_id)
        return []
    if not rows:
        return []

    picked = _spread(rows, MAX_SECTIONS)
    headings = [p["leaf"] for p in picked]
    if not picked:
        return []
    fallback = from_headings(headings)

    # The files as they are now: a changed set of files is a fresh key.
    docs = sorted({r["document_id"] for r in rows})
    topic, subject = " ".join(topic.split())[:80], " ".join(subject.split())[:80]
    key = hashlib.sha256(f"{subspace_id}|{topic}|{subject}|{','.join(docs)}|{len(rows)}".encode()).hexdigest()
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    if not settings.llm_configured:
        return fallback

    try:
        ids = [p["id"] for p in picked[:EXCERPTS]]
        texts = await supabase.db_select(
            "document_chunks",
            filters={"user_id": f"eq.{user_id}", "id": f"in.({','.join(ids)})"},
            select="id,section,content",
        )
        excerpts = "\n".join(
            f"- {_leaf(t.get('section') or '')}: {' '.join((t.get('content') or '').split())[:EXCERPT_CHARS]}"
            for t in texts
        )
        prompt = _PROMPT.format(
            count=COUNT,
            topic=topic or "this topic",
            subject_clause=f' in the subject "{subject}"' if subject and subject.lower() != topic.lower() else "",
            subject_rule=f', read in the sense it has in "{subject}"' if subject and subject.lower() != topic.lower() else "",
            headings="\n".join(f"- {h}" for h in headings),
            excerpts=excerpts or "(none)",
        )
        raw = await asyncio.wait_for(_ask_model(prompt), TIMEOUT_S)
        # Models wrap JSON in a code fence or a sentence; read the object itself.
        start, end = raw.find("{"), raw.rfind("}")
        parsed = loads_lenient(raw[start : end + 1] if 0 <= start < end else raw)
        items = parsed.get("questions") if isinstance(parsed, dict) else parsed
        questions: list[str] = []
        for item in items if isinstance(items, list) else []:
            q = clean(item)
            if q and q.lower() not in {x.lower() for x in questions}:
                questions.append(q)
        questions = questions[:COUNT]
    except Exception:  # noqa: BLE001 — a timeout or a rate limit: the headings still make questions
        log.info("starter questions fell back to headings subspace=%s", subspace_id)
        return fallback

    # Fewer than two good ones reads as a broken feature; the headings do better.
    result = questions if len(questions) >= 2 else fallback
    _CACHE.set(key, result)
    return result
