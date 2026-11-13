"""One search box over everything a student owns.

`GET /search?q=` looks through subjects, topics, notes, cards, quizzes and
files (names, and a few passages of their text) and returns the matches
grouped by kind, each carrying exactly what the browser needs to open it:
the subject and topic it lives in, and for a card its deck.

Plain database reads, no model calls — it is safe to run on every keystroke
the palette lets through (it debounces and cancels stale requests).

How a query becomes a filter
----------------------------
User text goes into PostgREST `ilike` filters, where several characters mean
something: `%` / `_` / `*` are wildcards, `\\` escapes, and inside an `or=(…)`
list `,` `(` `)` `"` are syntax. Rather than stacking two escaping layers
(LIKE's, then PostgREST's quoting) whose exact rules differ between PostgREST
versions, `ilike_value` replaces every such character with `_` — the
single-character wildcard. The filter then matches a SUPERSET of the real
hits, never fewer, and `_contains` re-checks every row in Python against the
student's literal text. So `50%` finds "50%" and not "500", and a stray `)`
can never break the query.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import unicodedata
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..deps import CurrentUser, get_current_user
from ..errors import UpstreamUnavailable
from ..services import supabase
from .quizzes import MAX_QUIZ_QUESTIONS

log = logging.getLogger("space_learn.search")
router = APIRouter()

#: Shorter than this matches nearly everything and tells the student nothing.
MIN_QUERY = 2
#: Longer is a paste, not a search; the tail would only slow the scan.
MAX_QUERY = 100
DEFAULT_PER_KIND = 5
MAX_PER_KIND = 10
#: Rows asked of the database per kind, as a multiple of what is shown. The
#: filter is a superset (see the module docstring) and HTML/markdown in note
#: bodies can produce matches that vanish once stripped, so ask for spare.
_OVERFETCH = 3
#: Quiz questions live in a jsonb array that PostgREST cannot `ilike`. The most
#: recent quizzes are read with ONLY their question text projected out (see
#: `_quiz_select`), and matched here.
_QUIZ_SCAN = 300
#: Passages inside files: few, and the scan has its own time budget, because a
#: content `ilike` over every chunk has no index to lean on.
_PASSAGE_LIMIT = 3
_PASSAGE_TIMEOUT_S = 4.0
_KIND_TIMEOUT_S = 8.0
_SNIPPET_CHARS = 140

Kind = Literal["subject", "topic", "note", "card", "quiz", "file", "passage"]


class SearchHit(BaseModel):
    kind: Kind
    id: str
    title: str
    #: Plain text around the match (markup stripped), or None when the title
    #: itself is what matched and there is nothing more to show.
    snippet: str | None = None
    subject_id: str | None = None
    subject_name: str | None = None
    #: The topic. None only for a subject hit.
    subspace_id: str | None = None
    subspace_name: str | None = None
    #: Cards: the deck to open. Files/passages: the document.
    deck_id: str | None = None
    deck_name: str | None = None
    document_id: str | None = None
    #: Passages: where in the file ("p. 4").
    locator: str | None = None
    #: Files: 'ready' / 'processing' / 'failed' …
    status: str | None = None


class SearchGroup(BaseModel):
    kind: Kind
    label: str
    hits: list[SearchHit]


class SearchOut(BaseModel):
    query: str
    groups: list[SearchGroup]
    #: True when one or more kinds could not be searched this time (a timeout,
    #: a database blip); the rest are still returned.
    partial: bool = False


_LABELS: dict[str, str] = {
    "topic": "Topics",
    "subject": "Subjects",
    "note": "Notes",
    "card": "Cards",
    "quiz": "Quizzes",
    "file": "Files",
    "passage": "In your files",
}
_ORDER = ["topic", "subject", "note", "card", "quiz", "file", "passage"]


# ── Query text ──────────────────────────────────────────────────────────

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
#: Wildcards, LIKE's escape, and PostgREST's list/quoting syntax.
_SPECIAL = re.compile(r'[%_*\\,()"]')
_SPACES = re.compile(r"\s+")


def clean_query(raw: str | None) -> str:
    """The student's text, normalised: NFC (so a composed and a decomposed é
    are one query), control characters and NUL removed (Postgres refuses NUL
    in text), whitespace collapsed, trimmed and capped."""
    text = unicodedata.normalize("NFC", raw or "")
    text = _CONTROL.sub(" ", text)
    text = _SPACES.sub(" ", text).strip()
    return text[:MAX_QUERY].strip()


def ilike_value(query: str) -> str:
    """`*<query>*` for a PostgREST `ilike`, with every special character
    neutralised to `_` (see the module docstring). Safe both as a plain filter
    value and, wrapped in double quotes, inside an `or=(…)` list."""
    return "*" + _SPECIAL.sub("_", query) + "*"


def or_ilike(columns: list[str], query: str) -> str:
    """`(a.ilike."*q*",b.ilike."*q*")` — any of `columns` matches. Quoted so a
    `.` or `:` in the query is a value, not syntax; `ilike_value` has already
    removed the characters that could end the quote or the list."""
    value = ilike_value(query)
    return "(" + ",".join(f'{c}.ilike."{value}"' for c in columns) + ")"


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def _contains(text: str | None, query: str) -> bool:
    return bool(text) and _fold(query) in _fold(text or "")


# ── Snippets ────────────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]{0,500}>")
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_MARKS = re.compile(r"(^|\s)#{1,6}\s|[*_`~>|]+|^\s*[-+]\s|\$\$?", re.MULTILINE)


def plain_text(body: str | None) -> str:
    """Markdown/HTML to one line of readable text, for a snippet. Not a
    renderer: it only has to stop `<details>` and `**` showing up in a result."""
    if not body:
        return ""
    text = _TAG.sub(" ", body)
    text = html.unescape(text)
    text = _MD_IMAGE.sub(r"\1", text)
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_MARKS.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def snippet(text: str | None, query: str, width: int = _SNIPPET_CHARS) -> str | None:
    """A window of `text` around the first match of `query`, with ellipses
    where it was cut. With no match in `text` (the title matched instead, or
    case folding found it where `lower()` cannot point at it) the opening of
    the text is shown. None only for empty text."""
    if not text:
        return None
    at = max(0, text.lower().find(query.lower()))
    if len(text) <= width:
        return text
    lead = max(0, min(at - width // 3, len(text) - width))
    end = lead + width
    # Don't cut a word in half at either end.
    if lead > 0:
        space = text.find(" ", lead, at) if at > lead else -1
        lead = space + 1 if space != -1 else lead
    if end < len(text):
        space = text.rfind(" ", at + len(query), end)
        end = space if space != -1 else end
    out = text[lead:end].strip()
    return ("…" if lead > 0 else "") + out + ("…" if end < len(text) else "")


def _rank(title: str, query: str) -> int:
    """0 = title starts with it, 1 = a word in the title does, 2 = title
    contains it, 3 = only the body does."""
    t, q = _fold(title), _fold(query)
    if t.startswith(q):
        return 0
    if f" {q}" in f" {t}":
        return 1
    if q in t:
        return 2
    return 3


# ── Per-kind reads ──────────────────────────────────────────────────────


def _quiz_select() -> str:
    # One aliased JSON path per question slot: `q0:questions->0->>q`. PostgREST
    # returns just those strings, not the whole question objects (with their
    # source chunks), so scanning hundreds of quizzes stays a small payload.
    paths = ",".join(f"q{i}:questions->{i}->>q" for i in range(MAX_QUIZ_QUESTIONS))
    return f"id,topic,subspace_id,created_at,{paths}"


async def _timed(coro, timeout: float):
    return await asyncio.wait_for(coro, timeout=timeout)


@router.get("/search", response_model=SearchOut)
async def search(
    q: str = Query(default="", max_length=1000),
    limit: int = Query(default=DEFAULT_PER_KIND),
    user: CurrentUser = Depends(get_current_user),
) -> SearchOut:
    query = clean_query(q)
    per_kind = max(1, min(MAX_PER_KIND, limit))
    if len(query) < MIN_QUERY:
        return SearchOut(query=query, groups=[])

    fetch = per_kind * _OVERFETCH
    value = ilike_value(query)

    reads = {
        # The topic and subject lists are small and every hit needs a name and
        # place from them, so they are read whole and matched here.
        "subspaces": supabase.db_select(
            "subspaces",
            filters={"user_id": f"eq.{user.id}"},
            select="id,name,subject_id",
            order="last_activity_at.desc",
        ),
        "subjects": supabase.db_select(
            "subjects",
            filters={"user_id": f"eq.{user.id}"},
            select="id,name",
        ),
        "notes": supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user.id}", "or": or_ilike(["title", "body_md"], query)},
            select="id,title,body_md,subspace_id",
            order="updated_at.desc",
            limit=fetch,
        ),
        "cards": supabase.db_select(
            "flashcards",
            filters={"user_id": f"eq.{user.id}", "or": or_ilike(["front", "back"], query)},
            select="id,front,back,deck_id,decks(id,name,subspace_id)",
            limit=fetch,
        ),
        "quizzes": supabase.db_select(
            "quizzes",
            filters={"user_id": f"eq.{user.id}"},
            select=_quiz_select(),
            order="created_at.desc",
            limit=_QUIZ_SCAN,
        ),
        "files": supabase.db_select(
            "documents",
            filters={"user_id": f"eq.{user.id}", "name": f"ilike.{value}"},
            select="id,name,subspace_id,status",
            order="created_at.desc",
            limit=fetch,
        ),
        "passages": supabase.db_select(
            "document_chunks",
            filters={"user_id": f"eq.{user.id}", "content": f"ilike.{value}"},
            select="id,document_id,subspace_id,content,locator,documents(name)",
            limit=_PASSAGE_LIMIT * _OVERFETCH,
        ),
    }
    timeouts = {"passages": _PASSAGE_TIMEOUT_S}
    names = list(reads)
    results = await asyncio.gather(
        *(_timed(reads[n], timeouts.get(n, _KIND_TIMEOUT_S)) for n in names),
        return_exceptions=True,
    )
    got: dict[str, list[dict]] = {}
    failed: list[str] = []
    for name, result in zip(names, results, strict=True):
        if isinstance(result, BaseException):
            # One kind failing (a timeout on the passage scan, a blip) must not
            # cost the student the rest of their results.
            log.warning("search: %s read failed: %r", name, result)
            failed.append(name)
            got[name] = []
        else:
            got[name] = [r for r in result if isinstance(r, dict)]

    if len(failed) == len(names):
        raise UpstreamUnavailable("Search isn't reachable right now. Try again in a moment.")

    subjects = {s["id"]: s.get("name") or "" for s in got["subjects"] if s.get("id")}
    topics = {t["id"]: t for t in got["subspaces"] if t.get("id")}

    def place(subspace_id: str | None) -> dict | None:
        """Subject + topic of a row, or None when its topic is gone (deleted
        between reads) — such a row has nowhere to open, so it is dropped."""
        topic = topics.get(subspace_id or "")
        if topic is None:
            return None
        subject_id = topic.get("subject_id")
        return {
            "subspace_id": topic["id"],
            "subspace_name": topic.get("name") or "",
            "subject_id": subject_id,
            "subject_name": subjects.get(subject_id or "", ""),
        }

    groups: dict[str, list[tuple[int, SearchHit]]] = {k: [] for k in _ORDER}

    # Subject/topic names come from rows read whole — a failed read of either
    # means no place for anything, which `place` already handles.
    for t in topics.values():
        if _contains(t.get("name"), query) and (where := place(t["id"])):
            groups["topic"].append(
                (
                    _rank(t.get("name") or "", query),
                    SearchHit(kind="topic", id=t["id"], title=t.get("name") or "", **where),
                )
            )
    for sid, name in subjects.items():
        if _contains(name, query):
            groups["subject"].append(
                (
                    _rank(name, query),
                    SearchHit(
                        kind="subject", id=sid, title=name, subject_id=sid, subject_name=name
                    ),
                )
            )

    for n in got["notes"]:
        title = n.get("title") or "Untitled note"
        body = plain_text(n.get("body_md"))
        in_title = _contains(title, query)
        if not (in_title or _contains(body, query)):
            continue
        where = place(n.get("subspace_id"))
        if where is None:
            continue
        groups["note"].append(
            (
                _rank(title, query) if in_title else 3,
                SearchHit(
                    kind="note", id=n["id"], title=title, snippet=snippet(body, query), **where
                ),
            )
        )

    for c in got["cards"]:
        deck = c.get("decks") or {}
        front, back = plain_text(c.get("front")), plain_text(c.get("back"))
        in_front = _contains(front, query)
        if not (in_front or _contains(back, query)):
            continue
        where = place(deck.get("subspace_id"))
        if where is None or not c.get("deck_id"):
            continue
        groups["card"].append(
            (
                _rank(front, query) if in_front else 3,
                SearchHit(
                    kind="card",
                    id=c["id"],
                    title=snippet(front, query, 90) or front[:90] or "Card",
                    snippet=snippet(back, query) or (back[:_SNIPPET_CHARS] or None),
                    deck_id=c["deck_id"],
                    deck_name=deck.get("name"),
                    **where,
                ),
            )
        )

    for z in got["quizzes"]:
        where = place(z.get("subspace_id"))
        if where is None:
            continue
        topic_line = (z.get("topic") or "").strip()
        questions = [z.get(f"q{i}") for i in range(MAX_QUIZ_QUESTIONS)]
        question = next((s for s in questions if isinstance(s, str) and _contains(s, query)), None)
        in_topic = _contains(topic_line, query)
        if not (in_topic or question):
            continue
        title = topic_line or f"Quiz on {where['subspace_name']}"
        groups["quiz"].append(
            (
                _rank(topic_line, query) if in_topic else 3,
                SearchHit(
                    kind="quiz",
                    id=z["id"],
                    title=title,
                    snippet=snippet(plain_text(question), query) if question else None,
                    **where,
                ),
            )
        )

    for d in got["files"]:
        name = d.get("name") or ""
        if not _contains(name, query) or (where := place(d.get("subspace_id"))) is None:
            continue
        groups["file"].append(
            (
                _rank(name, query),
                SearchHit(
                    kind="file",
                    id=d["id"],
                    title=name,
                    document_id=d["id"],
                    status=d.get("status"),
                    **where,
                ),
            )
        )

    for p in got["passages"]:
        text = plain_text(p.get("content"))
        if not _contains(text, query) or (where := place(p.get("subspace_id"))) is None:
            continue
        doc_name = (p.get("documents") or {}).get("name") or "File"
        groups["passage"].append(
            (
                3,
                SearchHit(
                    kind="passage",
                    id=p["id"],
                    title=doc_name,
                    snippet=snippet(text, query),
                    document_id=p.get("document_id"),
                    locator=p.get("locator"),
                    **where,
                ),
            )
        )

    out: list[SearchGroup] = []
    for kind in _ORDER:
        hits = groups[kind]
        if not hits:
            continue
        cap = _PASSAGE_LIMIT if kind == "passage" else per_kind
        # Stable sort: within a rank, the database's recency order stands.
        hits.sort(key=lambda h: h[0])
        out.append(SearchGroup(kind=kind, label=_LABELS[kind], hits=[h for _, h in hits[:cap]]))  # type: ignore[arg-type]

    return SearchOut(query=query, groups=out, partial=bool(failed))
