"""Reads a PDF as lines that know their page and whether they are a heading.

A PDF has no headings — only text drawn at a position in a font. So this reads
the font and the position of every run of text and works the structure out:

- **Headings** are lines set larger than the body text, or wholly in bold and
  short. Their level comes from their size.
- **Order.** Some PDFs (anything printed from a web page, for one) draw a
  page's headings *after* its body text. Read in drawing order, a heading then
  labels the wrong text or none. Each heading is put back above the first line
  of its own column that sits below it on the page.
- **Running headers and footers** — the same short line on most pages — are
  dropped; they would otherwise be scattered through every chunk.

Everything here is CPU-bound and synchronous; callers run it in a thread.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from io import BytesIO

from .chunking import Line

#: A line this much larger than body text is a heading.
_LARGER = 1.15
_HEADING_MAX_CHARS = 120
_BOLD_HEADING_MAX_CHARS = 70
_BOLD_HEADING_MAX_WORDS = 10
#: Deepest heading level kept; anything finer is treated as this.
MAX_LEVEL = 4

# Bold by any of the names type foundries give it: "Bold", LaTeX's "CMBX" and
# "Medi", "Black", "Heavy", "Demi", and the "-Bd" suffix.
_BOLD = re.compile(r"bold|black|heavy|semibold|demi|medi|cmbx|[-_]bd\b", re.IGNORECASE)
_HAS_LETTER = re.compile(r"[^\W\d_]")


@dataclass(slots=True)
class _Raw:
    """One visual line as drawn: its text, where, and in what type."""

    text: str
    y: float
    x: float
    size: float
    bold: bool
    level: int = 0


def read_pdf(data: bytes) -> tuple[list[Line], int]:
    """Every line of the PDF in reading order, and how many pages it has.
    Raises on a file that is not a readable PDF."""
    from pypdf import PdfReader  # imported here to keep cold-start light

    pages: list[list[_Raw]] = []
    for page in PdfReader(BytesIO(data)).pages:
        try:
            pages.append(_page_lines(page))
        except Exception:
            pages.append([])  # one unreadable page must not lose the document

    _mark_headings(pages)
    repeated = _running_lines(pages)

    out: list[Line] = []
    for number, lines in enumerate(pages, start=1):
        for raw in _reading_order(lines):
            text = raw.text.strip()
            if text and _signature(text) in repeated:
                continue
            out.append(Line(text=text, page=number, level=raw.level))
    return out, len(pages)


def _page_lines(page) -> list[_Raw]:  # noqa: ANN001 - pypdf's PageObject
    """The page's text split into visual lines, each with the position and type
    of its first run and the size most of its characters are set in."""
    lines: list[_Raw] = []
    text: list[str] = []
    runs: list[tuple[float, float, float, bool, int]] = []  # y, x, size, bold, chars

    def close() -> None:
        joined = "".join(text)
        if runs:
            sizes: Counter[float] = Counter()
            for _, _, size, _, chars in runs:
                sizes[size] += chars
            y, x = runs[0][0], runs[0][1]
            lines.append(
                _Raw(joined, y, x, sizes.most_common(1)[0][0], all(r[3] for r in runs))
            )
        else:
            lines.append(_Raw(joined, 0.0, 0.0, 0.0, False))
        text.clear()
        runs.clear()

    def visit(piece: str, _cm, tm, font, size) -> None:  # noqa: ANN001
        # pypdf hands text over run by run, with the line breaks it inferred.
        for i, part in enumerate(piece.split("\n")):
            if i:
                close()
            if not part:
                continue
            text.append(part)
            if part.strip():
                # Text turned on its side is a margin stamp or a figure label,
                # never a heading: give it no size, so it can't be read as one.
                sideways = abs(tm[1]) > abs(tm[0])
                scale = abs(tm[3]) or abs(tm[0]) or 1.0
                name = str((font or {}).get("/BaseFont", ""))
                runs.append(
                    (
                        float(tm[5]),
                        float(tm[4]),
                        0.0 if sideways else round(float(size) * scale, 1),
                        bool(_BOLD.search(name)),
                        len(part.strip()),
                    )
                )

    page.extract_text(visitor_text=visit)
    if text:
        close()
    return lines


#: More headings of one size than this on a single page are not headings:
#: they are the labels of a figure, or a page set entirely in display type.
_CROWD = 8
#: Adjacent heading lines are one wrapped title up to this many lines and
#: characters; beyond it they are a paragraph set large.
_TITLE_MAX_LINES = 3
_TITLE_MAX_CHARS = 140

_LARGE, _BOLD_ONLY = -1, -2


def _mark_headings(pages: list[list[_Raw]]) -> None:
    """Set `level` on every line that is a heading, across the whole document
    (so a level means the same thing on every page)."""
    by_size: Counter[float] = Counter()
    for lines in pages:
        for line in lines:
            if line.size:
                by_size[line.size] += len(line.text)
    if not by_size:
        return
    body = by_size.most_common(1)[0][0]

    for lines in pages:
        candidates: list[_Raw] = []
        for line in lines:
            text = line.text.strip()
            if not (3 <= len(text) <= _HEADING_MAX_CHARS) or text.endswith((".", ",", ";")) or not _HAS_LETTER.search(text):
                continue
            if line.size >= body * _LARGER:
                line.level = _LARGE
            elif (
                line.bold
                and line.size >= body * 0.98
                and len(text) <= _BOLD_HEADING_MAX_CHARS
                and len(text.split()) <= _BOLD_HEADING_MAX_WORDS
            ):
                line.level = _BOLD_ONLY
            else:
                continue
            candidates.append(line)
        _merge_wrapped(lines, candidates)
        crowd = Counter((line.level, line.size) for line in lines if line.level)
        for line in lines:
            if line.level and crowd[(line.level, line.size)] >= _CROWD:
                line.level = 0

    # Levels from the sizes that survived, largest first; bold-only comes last.
    sizes = sorted({line.size for lines in pages for line in lines if line.level == _LARGE}, reverse=True)
    levels = {size: min(i, MAX_LEVEL) for i, size in enumerate(sizes, start=1)}
    for lines in pages:
        for line in lines:
            if line.level == _LARGE:
                line.level = levels[line.size]
            elif line.level == _BOLD_ONLY:
                line.level = min(len(levels) + 1, MAX_LEVEL)


def _merge_wrapped(lines: list[_Raw], candidates: list[_Raw]) -> None:
    """A title wrapped over two or three lines becomes one heading; a longer
    run of large lines is a paragraph and stops being headings at all."""
    position = {id(line): i for i, line in enumerate(lines)}
    run: list[_Raw] = []

    def close() -> None:
        if len(run) > 1:
            ordered = sorted(run, key=lambda r: position[id(r)])
            if len(run) > _TITLE_MAX_LINES or sum(len(r.text.strip()) for r in run) > _TITLE_MAX_CHARS:
                for r in run:
                    r.level = 0
            else:
                ordered[0].text = " ".join(r.text.strip() for r in ordered)
                for r in ordered[1:]:
                    r.text, r.level = "", 0
        run.clear()

    for line in sorted(candidates, key=lambda r: r.y):
        if run and not (
            line.level == run[-1].level and line.size == run[-1].size and abs(line.y - run[-1].y) <= 1.6 * line.size
        ):
            close()
        run.append(line)
    close()


def _reading_order(lines: list[_Raw]) -> list[_Raw]:
    """The page's lines with each heading above the text it heads."""
    headings = [line for line in lines if line.level and line.text.strip()]
    if not headings:
        return lines
    body = [line for line in lines if not (line.level and line.text.strip())]
    placed = [line for line in body if line.text.strip() and (line.x or line.y)]
    if not placed:
        return lines

    # Which way is down? PDFs differ; the body text itself says.
    down = sum(1 if b.y > a.y else -1 for a, b in zip(placed, placed[1:], strict=False) if a.y != b.y) >= 0
    xs = [line.x for line in placed]
    column = max(30.0, 0.12 * (max(xs) - min(xs) + 1))

    before: dict[int, list[_Raw]] = {}
    trailing: list[_Raw] = []
    for heading in sorted(headings, key=lambda h: h.y if down else -h.y):
        target = next(
            (
                i
                for i, line in enumerate(body)
                if line.text.strip()
                and (line.x or line.y)
                and abs(line.x - heading.x) <= column
                and ((line.y > heading.y) if down else (line.y < heading.y))
            ),
            None,
        )
        if target is None:
            trailing.append(heading)  # heads text that starts on the next page
        else:
            before.setdefault(target, []).append(heading)

    out: list[_Raw] = []
    for i, line in enumerate(body):
        out.extend(before.get(i, ()))
        out.append(line)
    return out + trailing


def _signature(text: str) -> str:
    """A line with its digits blanked, so "Page 3 of 9" and "Page 4 of 9" match."""
    return re.sub(r"\d+", "#", text.strip().lower())


def _running_lines(pages: list[list[_Raw]]) -> set[str]:
    """Short lines that recur on most pages: headers, footers, page numbers."""
    if len(pages) < 4:
        return set()
    seen: Counter[str] = Counter()
    for lines in pages:
        seen.update({_signature(line.text) for line in lines if 0 < len(line.text.strip()) <= 80 and not line.level})
    need = max(3, int(len(pages) * 0.6))
    return {sig for sig, n in seen.items() if n >= need}
