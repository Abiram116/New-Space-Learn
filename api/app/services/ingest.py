"""Document ingestion: extract → chunk → embed → store, off the request path.

This used to run inline inside the upload request, capped at 25s. Profiled
under Render free's real limits (0.1 vCPU, 512MB — `scripts/bench_render_
constraints.py`), that design could not work:

- **Embedding is 93-99% of the time**, and it is linear in tokens (~0.9ms per
  token on one full core, so ~9ms on 0.1 vCPU). An 11-page paper is ~9.6k
  tokens: ~90s on Render. No budget a request can hold covers that, and a
  timed-out attempt threw its work away — "tap reprocess" restarted from zero
  and timed out again, forever.
- **The old batch of 64 peaked at ~1GB RSS** (padding every sequence to the
  longest, so attention memory grows with batch × len²). On a 512MB box that
  is an OOM kill of the whole API, mid-upload, for any real PDF.

So ingestion is now a background job with three properties:

1. **Bounded memory.** Inference runs one sequence at a time (see
   `embeddings.py`) — measured fastest AND smallest: 287MB peak vs 827MB.
2. **Resumable.** Chunking is deterministic, and chunks are persisted in small
   groups as they are embedded, so work already stored survives a restart,
   a deploy, or a spin-down. `resume_pending()` at startup picks up every
   document left at `processing` and skips the chunk indexes already in the
   table — no work is ever done twice.
3. **One at a time.** A single gate serialises ingestion, so two uploads
   can't double peak memory or starve chat of the one tenth of a CPU.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from ..errors import UpstreamUnavailable
from . import chunking, ocr, supabase
from .embeddings import embed_texts
from .extract import Document, UnreadablePdf, read_document

log = logging.getLogger("space_learn.ingest")

# Chunks persisted per insert. Small enough that a restart loses at most a
# few seconds of embedding; large enough that inserts aren't the cost.
SAVE_EVERY = 8

#: The most chunks one document may have (about a million characters, some 400
#: pages). Embedding is ~90 seconds per 11 pages on the free instance and one
#: document holds the only ingestion slot, so without a ceiling a single huge
#: upload blocks everyone's for hours and fills the database by itself.
MAX_CHUNKS = 1200
TRUNCATED_NOTE = "This document is very long, so only the first part was indexed."

_gate = asyncio.Semaphore(1)
_tasks: dict[str, asyncio.Task[None]] = {}
_progress: dict[str, tuple[int, int]] = {}


def progress(doc_id: str) -> float | None:
    """Fraction embedded, while a job for `doc_id` is live in this process."""
    done_total = _progress.get(doc_id)
    if not done_total:
        return None
    done, total = done_total
    return done / total if total else None


def is_running(doc_id: str) -> bool:
    return doc_id in _tasks


def schedule(doc: dict, data: bytes | None = None, *, fresh: bool = False) -> None:
    """Start ingesting `doc` in the background; a no-op if already running.

    `data` skips the storage download when the caller already holds the bytes
    (a fresh upload). `fresh=True` discards any stored chunks first — a
    reprocess, as opposed to a resume.
    """

    doc_id = doc["id"]
    if doc_id in _tasks:
        return
    task = asyncio.create_task(_run(doc, data, fresh=fresh), name=f"ingest:{doc_id}")
    _tasks[doc_id] = task
    task.add_done_callback(lambda _t: (_tasks.pop(doc_id, None), _progress.pop(doc_id, None)))


async def resume_pending() -> None:
    """Pick up every document a previous process left half-ingested."""

    try:
        rows = await supabase.db_select("documents", filters={"status": "eq.processing"})
    except Exception:
        log.warning("couldn't list pending documents to resume", exc_info=True)
        return
    for doc in rows:
        if doc.get("storage_path"):
            schedule(doc)
    if rows:
        log.info("resuming %d pending document(s)", len(rows))


async def cancel(doc_id: str) -> None:
    if (task := _tasks.get(doc_id)) is not None:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def drain() -> None:
    """Cancel live jobs at shutdown. Stored chunks stay; the next boot resumes."""

    tasks = list(_tasks.values())
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def _run(doc: dict, data: bytes | None, *, fresh: bool) -> None:
    doc_id = doc["id"]
    try:
        async with _gate:
            await _ingest(doc, data, fresh=fresh)
    except asyncio.CancelledError:
        raise  # shutdown: leave it at `processing` for resume_pending()
    except UnreadablePdf as e:
        log.warning("pdf %s could not be read safely: %s", doc_id, e)
        await _set(
            doc_id,
            {"status": "failed", "error": "We couldn't read this PDF. It may be damaged; try saving it again and re-uploading."},
        )
    except _NoText as e:
        await _set(doc_id, {"status": "failed", "error": str(e) or "No readable text found."})
    except UpstreamUnavailable as e:
        log.warning("ingestion upstream failure for %s: %s", doc_id, e)
        await _set(doc_id, {"status": "failed", "error": str(e)[:200]})
    except Exception:
        # The real cause goes to the log; the row gets copy a student can act
        # on. Never persist str(e) — `documents.error` renders in the UI.
        log.exception("ingestion failed for %s", doc_id)
        await _set(doc_id, {"status": "failed", "error": "We couldn't read this file. Try re-uploading it."})


class _NoText(Exception):
    pass


async def _ingest(doc: dict, data: bytes | None, *, fresh: bool) -> None:
    doc_id = doc["id"]
    if data is None:
        buf = bytearray()
        async for part in supabase.storage_download(doc["storage_path"]):
            buf.extend(part)
        data = bytes(buf)

    document = await read_document(data, doc.get("mime_type") or "")
    note: str | None = None
    if document.scanned:
        # Pictures of pages: the vision model reads them, up to a page cap.
        lines, read, total = await ocr.transcribe(data, user_id=doc["user_id"])
        if not any(line.text.strip() for line in lines):
            raise _NoText(
                "This PDF is a scan (pictures of pages) and its pages couldn't be read. "
                "Upload a text PDF, or clearer photos of the pages as images."
            )
        document = Document(lines)
        if read < total:
            note = f"This is a scan, so only its first {read} of {total} pages were read."
    if document.empty:
        raise _NoText
    # Off the event loop with the parsing: cheap, but not free on a tenth of a CPU.
    chunks = await asyncio.to_thread(chunking.chunk, document.lines)
    truncated = len(chunks) > MAX_CHUNKS
    del chunks[MAX_CHUNKS:]

    if fresh:
        await supabase.db_delete("document_chunks", filters={"document_id": f"eq.{doc_id}"})
        stored: set[int] = set()
    else:
        existing = await supabase.db_select(
            "document_chunks",
            filters={"document_id": f"eq.{doc_id}"},
            select="chunk_index",
            # A stable order: past 1,000 chunks `db_select` pages by offset, and
            # unordered pages can skip rows — a skipped chunk would be embedded
            # (and stored) a second time on resume.
            order="chunk_index.asc",
        )
        stored = {r["chunk_index"] for r in existing}

    todo = [c for c in chunks if c.index not in stored]
    done = len(chunks) - len(todo)
    _progress[doc_id] = (done, len(chunks))
    if stored and todo:
        log.info("resuming %s at %d/%d chunks", doc_id, done, len(chunks))

    for start in range(0, len(todo), SAVE_EVERY):
        group = todo[start : start + SAVE_EVERY]
        # The heading path goes in with the text that is embedded; what is
        # stored and shown is the document's own words (see chunking.py).
        vectors = await embed_texts([c.embed_text for c in group])
        await supabase.db_insert(
            "document_chunks",
            [
                {
                    "document_id": doc_id,
                    "subspace_id": doc["subspace_id"],
                    "user_id": doc["user_id"],
                    "chunk_index": c.index,
                    "content": c.content,
                    "locator": c.locator,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "section": c.section,
                    "embedding": v,
                }
                for c, v in zip(group, vectors, strict=True)
            ],
        )
        done += len(group)
        _progress[doc_id] = (done, len(chunks))

    await _set(
        doc_id,
        {
            "status": "ready",
            # Shown under the document's name; not a failure.
            "error": TRUNCATED_NOTE if truncated else note,
            "ready_at": datetime.now(UTC).isoformat(),
            "index_version": chunking.INDEX_VERSION,
        },
    )


async def _set(doc_id: str, patch: dict) -> None:
    try:
        await supabase.db_update("documents", filters={"id": f"eq.{doc_id}"}, patch=patch)
    except Exception:
        log.exception("couldn't record ingestion outcome for %s", doc_id)
