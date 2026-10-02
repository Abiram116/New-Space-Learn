"""Background ingestion: the properties that make it survive Render.

A job can be interrupted at any point — a deploy, a spin-down, an OOM — so the
contract under test is: stored work is never redone, a reprocess starts
clean, failures land on the row as copy a student can act on, and a deleted
document's job stops.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.services import chunking, ingest
from app.services import extract as ingest_extract

DOC = {"id": "doc-1", "subspace_id": "sub-1", "user_id": "user-1", "storage_path": "u/doc-1/a.txt", "mime_type": "text/plain"}
TEXT = "\n\n".join(f"Paragraph {i}. " + "Attention weighs every token against every other. " * 12 for i in range(20))
N_CHUNKS = len(chunking.chunk(chunking.read_text(TEXT)))


class _Store:
    """Just enough of `services.supabase` to hold state across calls."""

    def __init__(self) -> None:
        self.chunks: list[dict[str, Any]] = []
        self.doc_patches: list[dict[str, Any]] = []
        self.embedded: list[str] = []

    async def db_select(self, table, *, filters=None, select="*", order=None, limit=None):
        assert table == "document_chunks"
        return [{"chunk_index": c["chunk_index"]} for c in self.chunks]

    async def db_insert(self, table, rows):
        assert table == "document_chunks"
        self.chunks.extend(rows)
        return rows

    async def db_delete(self, table, *, filters):
        assert table == "document_chunks"
        self.chunks.clear()

    async def db_update(self, table, *, filters, patch):
        assert table == "documents"
        self.doc_patches.append(patch)
        return [{**DOC, **patch}]

    async def storage_download(self, path):
        yield TEXT.encode()

    async def embed(self, texts):
        self.embedded.extend(texts)
        await asyncio.sleep(0)  # a real yield point, like the worker thread
        return [[0.0] * 384 for _ in texts]


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> _Store:
    s = _Store()
    for name in ("db_select", "db_insert", "db_delete", "db_update", "storage_download"):
        monkeypatch.setattr(ingest.supabase, name, getattr(s, name))
    monkeypatch.setattr(ingest, "embed_texts", s.embed)
    ingest._tasks.clear()  # noqa: SLF001
    ingest._progress.clear()  # noqa: SLF001
    return s


async def _finish(doc_id: str = "doc-1") -> None:
    task = ingest._tasks.get(doc_id)  # noqa: SLF001
    if task is not None:
        await task


async def test_a_fresh_upload_stores_every_chunk_then_marks_ready(store):
    ingest.schedule(DOC, TEXT.encode())
    await _finish()
    assert sorted(c["chunk_index"] for c in store.chunks) == list(range(N_CHUNKS))
    done = store.doc_patches[-1]
    assert done["status"] == "ready" and done["error"] is None
    assert done["index_version"] == chunking.INDEX_VERSION
    assert not ingest.is_running("doc-1") and ingest.progress("doc-1") is None


async def test_what_is_embedded_carries_the_heading_and_what_is_stored_does_not(store):
    text = "# Optimisation\n\n## Momentum\n\n" + "It converges faster on ill-conditioned problems. " * 8
    ingest.schedule(DOC, text.encode())
    await _finish()
    row = store.chunks[0]
    assert row["section"] == "Optimisation › Momentum" and row["locator"] == "Momentum"
    assert (row["page_start"], row["page_end"]) == (None, None)
    assert store.embedded[0].startswith("Optimisation › Momentum\n")
    assert not row["content"].startswith("Optimisation ›")


async def test_a_scanned_pdf_fails_with_words_a_student_can_act_on(store, monkeypatch):
    async def scanned(data, mime):
        return ingest_extract.Document([], scanned=True)

    monkeypatch.setattr(ingest, "read_document", scanned)
    ingest.schedule(DOC, b"%PDF")
    await _finish()
    last = store.doc_patches[-1]
    assert last["status"] == "failed" and "scan" in last["error"] and store.chunks == []


async def test_a_huge_document_is_cut_off_and_says_so(store, monkeypatch):
    monkeypatch.setattr(ingest, "MAX_CHUNKS", 3)
    ingest.schedule(DOC, TEXT.encode())
    await _finish()
    assert len(store.chunks) == 3
    assert store.doc_patches[-1] == {**store.doc_patches[-1], "status": "ready", "error": ingest.TRUNCATED_NOTE}


async def test_a_resume_skips_chunks_already_stored(store):
    assert N_CHUNKS > ingest.SAVE_EVERY  # otherwise this proves nothing
    already = chunking.chunk(chunking.read_text(TEXT))[: ingest.SAVE_EVERY]
    store.chunks = [{"chunk_index": c.index} for c in already]

    ingest.schedule(DOC)  # no bytes: downloads from storage, like a restart
    await _finish()

    assert len(store.embedded) == N_CHUNKS - ingest.SAVE_EVERY
    assert sorted(c["chunk_index"] for c in store.chunks) == list(range(N_CHUNKS))


async def test_a_reprocess_starts_clean(store):
    store.chunks = [{"chunk_index": i} for i in range(N_CHUNKS)]
    ingest.schedule(DOC, fresh=True)
    await _finish()
    assert len(store.embedded) == N_CHUNKS
    assert sorted(c["chunk_index"] for c in store.chunks) == list(range(N_CHUNKS))


async def test_scheduling_twice_runs_one_job(store):
    ingest.schedule(DOC, TEXT.encode())
    ingest.schedule(DOC, TEXT.encode())
    await _finish()
    assert len(store.embedded) == N_CHUNKS


async def test_an_empty_file_fails_with_copy_not_a_stack_trace(store):
    ingest.schedule(DOC, b"   ")
    await _finish()
    assert store.doc_patches[-1] == {"status": "failed", "error": "No readable text found."}


async def test_an_unexpected_error_is_logged_not_shown(store, monkeypatch):
    async def boom(_texts):
        raise RuntimeError("onnxruntime: internal detail")

    monkeypatch.setattr(ingest, "embed_texts", boom)
    ingest.schedule(DOC, TEXT.encode())
    await _finish()
    last = store.doc_patches[-1]
    assert last["status"] == "failed" and "onnxruntime" not in last["error"]


async def test_cancel_stops_the_job_and_leaves_it_resumable(store):
    ingest.schedule(DOC, TEXT.encode())
    await asyncio.sleep(0)
    await ingest.cancel("doc-1")
    assert not ingest.is_running("doc-1")
    # Never marked failed or ready — a restart would resume it.
    assert all(p.get("status") not in {"failed", "ready"} for p in store.doc_patches)
