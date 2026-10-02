"""Cuts a document into the chunks that are embedded, searched and cited.

Everything upstream turns a file into `Line`s — text that knows its page and
whether it is a heading (`pdf_layout.read_pdf` for PDFs, `read_text` here for
everything else). Everything downstream sees only `Chunk`s. So a new file type
is a new reader, and a new way of searching never touches this file.

How a document is cut:

1. **By section.** A heading starts a new section, and a chunk never runs from
   one section into the next: a chunk that straddles two subjects matches
   neither well. Very short sections are joined to the one after, so a heading
   with a single line under it does not become a chunk of its own.
2. **Then by size.** A long section is cut into pieces of about `TARGET`
   characters, at the end of a sentence or paragraph where there is one, with
   the last line or two repeated at the start of the next piece.
3. **Each chunk carries where it is from**: its pages and its heading path
   ("Gradient descent › Momentum"). The path is also put in front of the text
   that is *embedded* (`embed_text`), so a paragraph that says only "it
   converges faster" is still found by a question naming the method. The text
   that is stored and shown (`content`) stays exactly what the document says.

Deterministic: the same lines always give the same chunks with the same
indexes. Ingestion relies on that to resume a half-embedded document.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Bump when a change here means stored chunks should be rebuilt. Written to
#: `documents.index_version`; `scripts/reembed_documents.py --outdated` finds
#: the documents still on an older one.
INDEX_VERSION = 2

TARGET = 900  # characters per chunk, ~200 tokens
MAX = 1300  # a chunk never grows past this by joining sections
MIN = 300  # a section shorter than this is joined to the next
OVERLAP = 120  # characters repeated between two pieces of one section
#: A line longer than this is split at sentence ends before chunking (text
#: files often hold a whole paragraph on one line).
LONG_LINE = 400

SEPARATOR = " › "


@dataclass(frozen=True, slots=True)
class Line:
    text: str
    #: 1-based page, or None for a file that has no pages.
    page: int | None = None
    #: 0 for body text; 1 is the top heading level.
    level: int = 0


@dataclass(slots=True)
class Chunk:
    index: int
    #: What is stored, shown and keyword-searched: the document's own words.
    content: str
    #: What is embedded: the heading path, then the content.
    embed_text: str
    #: Human-readable position, shown beside the document's name.
    locator: str
    page_start: int | None = None
    page_end: int | None = None
    #: The heading path, outermost first, joined by `SEPARATOR`.
    section: str | None = None


# ── Reading text files ─────────────────────────────────────────────────

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*$")
_NUMBERED = re.compile(r"^(\d+(?:\.\d+){0,3})\.?\s+([A-Z][^.!?]{2,80})$")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def read_text(text: str) -> list[Line]:
    """Plain text or markdown as lines. Headings are markdown `#` lines,
    numbered titles ("2.1 Learning rate") and short lines in capitals."""
    out: list[Line] = []
    in_code = False
    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            out.append(Line(line))
            continue
        if not in_code and (level := _text_heading(stripped)):
            out.append(Line(_MD_HEADING.sub(r"\2", stripped), level=level))
        else:
            out.append(Line(line))
    return out


def _text_heading(line: str) -> int:
    if not line or len(line) > 100:
        return 0
    if m := _MD_HEADING.match(line):
        return min(len(m.group(1)), 4)
    if m := _NUMBERED.match(line):
        return min(m.group(1).count(".") + 1, 4)
    letters = [c for c in line if c.isalpha()]
    if len(letters) >= 4 and len(line) <= 60 and all(c.isupper() for c in letters) and not line.endswith((".", ",", ":")):
        return 2
    return 0


# ── Chunking ───────────────────────────────────────────────────────────


@dataclass(slots=True)
class _Section:
    path: tuple[str, ...]
    lines: list[Line] = field(default_factory=list)

    @property
    def size(self) -> int:
        return sum(len(line.text) + 1 for line in self.lines)


def chunk(lines: list[Line]) -> list[Chunk]:
    """The document's chunks, in order. Empty for a document with no text."""
    pieces: list[tuple[tuple[str, ...], list[Line]]] = []
    for section in _joined(_sections(lines)):
        pieces.extend((section.path, part) for part in _split(section.lines))

    chunks: list[Chunk] = []
    for path, part in pieces:
        content = _text(part)
        if not content:
            continue
        pages = [line.page for line in part if line.page is not None and line.text.strip()]
        section = SEPARATOR.join(path) or None
        chunks.append(
            Chunk(
                index=len(chunks),
                content=content,
                embed_text=f"{section}\n{content}" if section else content,
                locator="",
                page_start=min(pages) if pages else None,
                page_end=max(pages) if pages else None,
                section=section,
            )
        )
    for c in chunks:
        c.locator = _locator(c, len(chunks))
    return chunks


def _sections(lines: list[Line]) -> list[_Section]:
    """The lines grouped under their headings. A section's first line is its
    own heading, so the heading is part of the text that is stored."""
    stack: list[tuple[int, str]] = []
    sections = [_Section(path=())]
    for line in _short_lines(lines):
        if line.level and line.text.strip():
            while stack and stack[-1][0] >= line.level:
                stack.pop()
            stack.append((line.level, " ".join(line.text.split())))
            sections.append(_Section(path=tuple(title for _, title in stack)))
        sections[-1].lines.append(line)
    return [s for s in sections if any(line.text.strip() for line in s.lines)]


def _joined(sections: list[_Section]) -> list[_Section]:
    """Sections with the very short ones folded into what follows. The joined
    section is named after whichever part holds most of its text."""
    out: list[_Section] = []
    pending: list[_Section] = []

    def flush() -> None:
        if pending:
            biggest = max(pending, key=lambda s: s.size)
            out.append(_Section(path=biggest.path, lines=[line for s in pending for line in s.lines]))
            pending.clear()

    for section in sections:
        size = sum(s.size for s in pending)
        # A short run is always carried into the next section, even a long one
        # (which is then cut by size): a caption or a lone heading left by
        # itself is a chunk that can match a question and answer nothing.
        if pending and size >= MIN:
            flush()
        pending.append(section)
    flush()
    return out


def _split(lines: list[Line]) -> list[list[Line]]:
    """One section as pieces of about TARGET characters, cut at a good place."""
    pieces: list[list[Line]] = []
    current: list[Line] = []
    size = 0
    for line in lines:
        if current and size + len(line.text) + 1 > TARGET:
            cut = _cut_point(current)
            pieces.append(current[:cut])
            # What was after the cut starts the next piece; when the cut was at
            # the very end, a line or two is repeated so a sentence split
            # across the boundary is whole in one of the two.
            current = current[cut:] or _tail(current)
            size = sum(len(x.text) + 1 for x in current)
        current.append(line)
        size += len(line.text) + 1
    if current:
        # A short last piece is the end of the previous one, not a chunk.
        size = sum(len(x.text) + 1 for x in current)
        if pieces and size < MIN and sum(len(x.text) + 1 for x in pieces[-1]) + size <= MAX:
            pieces[-1] = pieces[-1] + [x for x in current if x not in _tail(pieces[-1])]
        else:
            pieces.append(current)
    return pieces


def _cut_point(lines: list[Line]) -> int:
    """Where to end a full piece: after the last blank line or sentence end in
    its second half, else at its end."""
    total = sum(len(line.text) + 1 for line in lines)
    seen = 0
    best = len(lines)
    for i, line in enumerate(lines):
        seen += len(line.text) + 1
        if seen < total * 0.5 or i == len(lines) - 1:
            continue
        text = line.text.rstrip()
        if not text or text.endswith((".", "!", "?", ":")):
            best = i + 1
    return best


def _tail(lines: list[Line]) -> list[Line]:
    """The last lines of a piece, up to OVERLAP characters."""
    out: list[Line] = []
    size = 0
    for line in reversed(lines):
        size += len(line.text) + 1
        if size > OVERLAP:
            break
        out.insert(0, line)
    return out


def _short_lines(lines: list[Line]) -> list[Line]:
    """Lines with any very long one split at sentence ends, so a paragraph
    stored on a single line can still be cut between sentences."""
    out: list[Line] = []
    for line in lines:
        if len(line.text) <= LONG_LINE or line.level:
            out.append(line)
            continue
        buffer = ""
        for sentence in _SENTENCE_END.split(line.text):
            while len(sentence) > TARGET:  # no sentence ends at all
                out.append(Line(sentence[:TARGET], line.page))
                sentence = sentence[TARGET:]
            if buffer and len(buffer) + len(sentence) + 1 > LONG_LINE:
                out.append(Line(buffer, line.page))
                buffer = sentence
            else:
                buffer = f"{buffer} {sentence}".strip()
        if buffer:
            out.append(Line(buffer, line.page))
    return out


def _text(lines: list[Line]) -> str:
    text = "\n".join(line.text for line in lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _locator(c: Chunk, total: int) -> str:
    """ "p. 8–9 · Learning rate" — or, with no pages, the section or the part."""
    title = c.section.split(SEPARATOR)[-1] if c.section else ""
    if c.page_start is not None:
        pages = f"p. {c.page_start}" if c.page_end in (None, c.page_start) else f"p. {c.page_start}–{c.page_end}"
        return f"{pages} · {title}" if title else pages
    return title or f"part {c.index + 1} of {total}"
