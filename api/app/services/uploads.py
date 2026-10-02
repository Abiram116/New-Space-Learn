"""What an upload is allowed to be, before anything is stored or processed.

The request reaches us with a filename and a content type that are both chosen
by the client, so neither is trusted: the type decides whether a file is
accepted at all, and the name is rewritten before it becomes a storage key.
"""

from __future__ import annotations

import re
import unicodedata

from fastapi import UploadFile

from ..errors import ValidationFailed

MAX_BYTES = 20 * 1024 * 1024  # 20 MB — free-tier friendly
_CHUNK = 1024 * 1024

#: What ingestion can actually read (see `services/extract.py`). Anything else
#: used to be accepted and decoded as text, which stored arbitrary binaries in
#: the bucket and indexed pages of garbage for the student to be quoted from.
_TEXT_EXT = {"txt", "md", "markdown", "csv"}
_IMAGE_EXT = {"png", "jpg", "jpeg", "webp"}
_ALLOWED_EXT = {"pdf"} | _TEXT_EXT | _IMAGE_EXT
_ALLOWED_MIME_PREFIXES = ("application/pdf", "text/plain", "text/markdown", "text/csv", "image/png", "image/jpeg", "image/webp")

UNSUPPORTED = "That file type isn't supported. Upload a PDF, a text, Markdown or CSV file, or an image."


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def is_image(filename: str, content_type: str | None) -> bool:
    return _extension(filename) in _IMAGE_EXT or (content_type or "").lower().startswith("image/")


def assert_supported(filename: str, content_type: str | None) -> None:
    """Accept by extension, or by content type when the name has none we know.

    Extension first because browsers disagree about types: a `.md` file is
    `text/markdown` on one machine and `application/octet-stream` on another.
    """
    if _extension(filename) in _ALLOWED_EXT:
        return
    if (content_type or "").lower().startswith(_ALLOWED_MIME_PREFIXES):
        return
    raise ValidationFailed(UNSUPPORTED)


_MIME_BY_EXT = {
    "pdf": "application/pdf",
    "csv": "text/csv",
    "md": "text/markdown",
    "markdown": "text/markdown",
    "txt": "text/plain",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def content_type(filename: str, claimed: str | None) -> str:
    """The type ingestion should treat the file as: from its extension when we
    know it, because that is what decides how it is read. A PDF that arrived
    labelled `application/octet-stream` was being decoded as plain text."""
    return _MIME_BY_EXT.get(_extension(filename)) or (claimed or "application/octet-stream").lower()


def _clean(filename: str) -> str:
    """The last path component, without control characters."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip()


def display_name(filename: str) -> str:
    """The name shown in the app: the student's own, minus anything that isn't
    a name — directory parts, control characters, absurd length. A long name is
    shortened in the middle of its stem, so it keeps its extension."""
    name = _clean(filename)
    if len(name) > 200:
        ext = _extension(name)
        tail = f".{ext}" if ext and len(ext) <= 10 else ""
        name = name[: 200 - len(tail)] + tail
    return name or "Untitled"


def storage_name(filename: str) -> str:
    """A safe object name for the storage key.

    The key is `<user>/<document>/<name>`; a raw client filename in it could
    carry `../`, and names with spaces, `#`, `?` or non-ASCII letters were
    rejected by the storage API, which surfaced as "couldn't store that file"
    for perfectly ordinary files. ASCII letters, digits, `.`, `_` and `-` only.
    """
    name = _clean(filename)
    ext = _extension(name)
    stem = name[: -(len(ext) + 1)] if ext else name
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-_")[:80] or "file"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:10]
    return f"{stem}.{ext}" if ext else stem


async def read_capped(file: UploadFile, limit: int = MAX_BYTES) -> bytes:
    """The file's bytes, refusing to hold more than `limit` of them.

    Read in chunks and stop the moment it runs over, rather than reading it all
    and measuring afterwards.
    """
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK):
        size += len(chunk)
        if size > limit:
            raise ValidationFailed("File is larger than the 20 MB limit.")
        chunks.append(chunk)
    return b"".join(chunks)
