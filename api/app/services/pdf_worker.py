"""Reads an untrusted PDF in a process of its own, with limits.

PDF parsers have a long history of files crafted to loop forever or to
decompress into gigabytes (pypdf alone had dozens such advisories before
6.19). Ingestion runs one document at a time on a 512 MB server, so in-process
one bad upload could stall every student's uploads indefinitely, or take the
whole API down with it. Here a bad file can only fail its own upload:

- a time limit (`TIMEOUT_S`): the process is killed past it;
- a memory limit (`MEMORY_BYTES`): the process fails past it, not the server.

The parent sends the PDF on stdin and reads JSON from stdout:

    python -m app.services.pdf_worker text            → {"pages": n, "lines": [[text, page, level], ...]}
    python -m app.services.pdf_worker images LIMIT MAX_PIXELS
                                                      → {"pages": n, "images": [[page, base64 jpeg | null], ...]}

A normal 33-page lecture PDF peaks at ~76 MB and ~2.5 s here (measured).
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys

TIMEOUT_S = 120
MEMORY_BYTES = 384 * 1024 * 1024


class UnreadablePdf(Exception):
    """The PDF could not be read within the limits, or at all."""


def _run(args: list[str], data: bytes) -> dict:
    try:
        done = subprocess.run(
            [sys.executable, "-m", "app.services.pdf_worker", *args],
            input=data,
            capture_output=True,
            timeout=TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise UnreadablePdf("took too long to read") from e
    if done.returncode != 0:
        raise UnreadablePdf(done.stderr.decode(errors="ignore")[-300:] or f"exit {done.returncode}")
    try:
        return json.loads(done.stdout)
    except json.JSONDecodeError as e:
        raise UnreadablePdf("unreadable worker output") from e


def read_text_lines(data: bytes) -> tuple[list[tuple[str, int, int]], int]:
    out = _run(["text"], data)
    return [tuple(x) for x in out["lines"]], int(out["pages"])


def read_page_images(data: bytes, limit: int, max_pixels: int) -> tuple[list[tuple[int, bytes | None]], int]:
    out = _run(["images", str(limit), str(max_pixels)], data)
    images = [(int(n), base64.b64decode(b) if b else None) for n, b in out["images"]]
    return images, int(out["pages"])


def _child() -> None:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    data = sys.stdin.buffer.read()
    mode = sys.argv[1]
    if mode == "text":
        from .pdf_layout import read_pdf

        lines, pages = read_pdf(data)
        result = {"pages": pages, "lines": [[x.text, x.page, x.level] for x in lines]}
    elif mode == "images":
        from .ocr import extract_page_images

        images, pages = extract_page_images(data, int(sys.argv[2]), int(sys.argv[3]))
        result = {"pages": pages, "images": [[n, base64.b64encode(b).decode() if b else None] for n, b in images]}
    else:
        raise SystemExit(f"unknown mode {mode}")
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    _child()
