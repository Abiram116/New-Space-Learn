"""Documents: upload → store → ingest in the background → cite.

Ingestion itself lives in `services/ingest.py` — see its header for why it
can no longer run inside the request."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, UploadFile

from ..deps import CurrentUser, get_current_user
from ..errors import NotFound, UpstreamUnavailable, ValidationFailed
from ..guards import assert_subspace
from ..schemas import DocumentOut, OkOut
from ..services import ingest, supabase, uploads
from ..services.ratelimit import consume_llm_quota

log = logging.getLogger("space_learn.docs")
router = APIRouter()



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
    if not file.filename:
        raise ValidationFailed("Choose a file to upload.")
    uploads.assert_supported(file.filename, file.content_type)
    # Every upload is metered: it costs storage and embedding time on a small
    # shared server. An image costs more — it is transcribed by the vision
    # model during processing, so it is an LLM call as well.
    image = uploads.is_image(file.filename, file.content_type)
    await consume_llm_quota(user.id, cost=2 if image else 1)

    data = await uploads.read_capped(file)
    if not data:
        raise ValidationFailed("The file is empty.")
    name = uploads.display_name(file.filename)
    mime = uploads.content_type(file.filename, file.content_type)

    # Insert the row eagerly so the client sees the doc immediately.
    row = (
        await supabase.db_insert(
            "documents",
            {
                "user_id": user.id,
                "subspace_id": subspace_id,
                "name": name,
                "mime_type": mime,
                "size_bytes": len(data),
                "status": "uploading",
            },
        )
    )[0]

    # Storage first: it is what makes the job resumable after a restart.
    storage_path = f"{user.id}/{row['id']}/{uploads.storage_name(file.filename)}"
    try:
        await supabase.storage_upload(
            storage_path, data, content_type=mime
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

    # Metered like the upload it repeats — re-reading an image is another
    # vision-model call, and this endpoint was a free way to make them.
    image = uploads.is_image(doc.get("name") or "", doc.get("mime_type"))
    await consume_llm_quota(user.id, cost=2 if image else 1)

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

