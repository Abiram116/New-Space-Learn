"""Documents: upload → store → ingest in the background → cite.

Ingestion itself lives in `services/ingest.py` — see its header for why it
can no longer run inside the request."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, UploadFile

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import NotFound, UpstreamUnavailable, ValidationFailed
from ..guards import assert_space, assert_subspace
from ..schemas import DocumentOut, OkOut, SuggestSubspaceOut
from ..services import ingest, supabase
from ..services.extract import extract_text
from ..services.llm import get_llm
from ..services.ratelimit import consume_llm_quota

log = logging.getLogger("space_learn.docs")
router = APIRouter()

MAX_BYTES = 20 * 1024 * 1024  # 20 MB — free-tier friendly
# A name needs a sample, not the book: parsing all of an 80-page PDF to keep
# its first 4000 characters was ~5s of wasted CPU on Render.
SUGGEST_MAX_PAGES = 4


@router.post("/spaces/{space_id}/suggest-subspace", response_model=SuggestSubspaceOut)
async def suggest_subspace(
    space_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> SuggestSubspaceOut:
    """One cheap model call over an uploaded file, for when a student drops
    material into a subject before creating a topic to hold it — a
    pre-filled, editable suggestion beats asking them to name it blind."""

    await assert_space(user.id, space_id)
    # This reaches the model, so it burns the same quota as any other AI call.
    # Without this it was the one unmetered LLM endpoint in the API.
    await consume_llm_quota(user.id)

    data = await file.read()
    if not data:
        raise ValidationFailed("The file is empty.")
    mime = file.content_type or ""
    if "image" in mime.lower():
        return SuggestSubspaceOut(name=None)  # a vision call just to name a topic isn't worth it
    text = (await extract_text(data, mime, max_pages=SUGGEST_MAX_PAGES))[:4000]
    if not text.strip() or not settings.llm_configured:
        return SuggestSubspaceOut(name=None)

    prompt = (
        "Suggest a short topic name (2-5 words, Title Case, no trailing "
        "punctuation) for a study space that will hold this material. "
        "Return ONLY the name, nothing else.\n\nMaterial:\n" + text
    )
    try:
        parts: list[str] = []
        async for delta in get_llm().stream_chat(
            [
                {"role": "system", "content": "You name study topics concisely."},
                {"role": "user", "content": prompt},
            ],
            model=settings.groq_model_fast,
            temperature=0.4,
        ):
            parts.append(delta)
        name = "".join(parts).strip().strip('"').strip("*")[:80] or None
    except Exception:
        log.warning("subspace name suggestion failed", exc_info=True)
        name = None
    return SuggestSubspaceOut(name=name)


@router.get("/subspaces/{subspace_id}/documents", response_model=list[DocumentOut])
async def list_documents(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[DocumentOut]:
    # Guard and read run together — see the note in notes.list_notes.
    _, rows = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "documents",
            filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
            order="created_at.desc",
        ),
    )
    return [_to_doc(r) for r in rows]


@router.post(
    "/subspaces/{subspace_id}/documents",
    response_model=DocumentOut,
    status_code=201,
)
async def upload_document(
    subspace_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    await assert_subspace(user.id, subspace_id)
    # Images are transcribed by the vision model during processing, so an
    # image upload is an LLM call and is metered like one.
    if "image" in (file.content_type or "").lower():
        await consume_llm_quota(user.id, cost=2)

    if not file.filename:
        raise ValidationFailed("Choose a file to upload.")
    data = await file.read()
    if not data:
        raise ValidationFailed("The file is empty.")
    if len(data) > MAX_BYTES:
        raise ValidationFailed("File is larger than the 20 MB limit.")

    # Insert the row eagerly so the client sees the doc immediately.
    row = (
        await supabase.db_insert(
            "documents",
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "name": file.filename,
                "mime_type": file.content_type,
                "size_bytes": len(data),
                "status": "uploading",
            },
        )
    )[0]

    # Storage first: it is what makes the job resumable after a restart.
    storage_path = f"{user.id}/{row['id']}/{file.filename}"
    try:
        await supabase.storage_upload(
            storage_path, data, content_type=file.content_type or "application/octet-stream"
        )
        row = (
            await supabase.db_update(
                "documents",
                filters={"id": f"eq.{row['id']}"},
                patch={"status": "processing", "storage_path": storage_path},
            )
        )[0]
    except Exception as e:
        log.exception("upload failed for %s", row["id"])
        await supabase.db_update(
            "documents",
            filters={"id": f"eq.{row['id']}"},
            patch={"status": "failed", "error": "Upload failed."},
        )
        # Re-raise as a typed error so the client gets our envelope rather than
        # a bare 500 carrying whatever the storage layer threw.
        raise UpstreamUnavailable("We couldn't store that file. Try again.") from e

    # Answer now; the Docs view already polls while anything is processing.
    ingest.schedule(row, data)
    return _to_doc(row)


@router.post("/documents/{document_id}/reprocess", response_model=DocumentOut)
async def reprocess(
    document_id: str, user: CurrentUser = Depends(get_current_user)
) -> DocumentOut:
    rows = await supabase.db_select(
        "documents",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{document_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Document not found.")
    doc = rows[0]
    if not doc.get("storage_path"):
        raise ValidationFailed("Document has no stored file to reprocess.")

    if ingest.is_running(doc["id"]):
        return _to_doc(doc)  # a second tap mustn't start a second job

    # A doc still at `processing` resumes where it stopped; a ready or failed
    # one is re-ingested from scratch.
    fresh = doc["status"] != "processing"
    doc = (
        await supabase.db_update(
            "documents",
            filters={"id": f"eq.{doc['id']}"},
            patch={"status": "processing", "error": None},
        )
    )[0]
    ingest.schedule(doc, fresh=fresh)
    return _to_doc(doc)


@router.delete("/documents/{document_id}", response_model=OkOut)
async def delete_document(
    document_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    rows = await supabase.db_select(
        "documents",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{document_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Document not found.")
    doc = rows[0]
    # Stop a live job first, or it keeps embedding into a row that's gone.
    await ingest.cancel(doc["id"])
    if doc.get("storage_path"):
        # storage_path is the in-bucket key ("<user>/<doc>/<name>"); the storage
        # helper adds the bucket itself.
        try:
            await supabase.storage_delete(doc["storage_path"])
        except Exception:  # noqa: BLE001 — deletion is best-effort
            log.warning("storage delete failed for %s", doc["id"])
    await supabase.db_delete(
        "documents", filters={"user_id": f"eq.{user.id}", "id": f"eq.{document_id}"}
    )
    return OkOut()


def _to_doc(row: dict) -> DocumentOut:
    return DocumentOut(
        id=row["id"],
        name=row["name"],
        mime_type=row.get("mime_type"),
        size_bytes=row.get("size_bytes"),
        status=row["status"],
        error=row.get("error"),
        created_at=row["created_at"],
        ready_at=row.get("ready_at"),
        progress=ingest.progress(row["id"]),
    )

