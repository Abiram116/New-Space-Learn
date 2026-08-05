"""Documents: upload → chunk → embed → cite. Inline (no worker) per free-tier reality."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, UploadFile

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..errors import NotFound, UpstreamUnavailable, ValidationFailed
from ..guards import assert_space, assert_subspace
from ..schemas import DocumentOut, OkOut, SuggestSubspaceOut
from ..services import supabase
from ..services.embeddings import chunk_text, embed_texts, extract_pdf_text
from ..services.llm import get_llm

log = logging.getLogger("space_learn.docs")
router = APIRouter()

MAX_BYTES = 20 * 1024 * 1024  # 20 MB — free-tier friendly
PROCESSING_BUDGET_S = 25       # cap the inline embed so requests don't hang forever


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

    data = await file.read()
    if not data:
        raise ValidationFailed("The file is empty.")
    text = _extract_text(data, file.content_type or "")[:4000]
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
    await assert_subspace(user.id, subspace_id)
    rows = await supabase.db_select(
        "documents",
        filters={"user_id": f"eq.{user.id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
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

    # Storage first, then chunk + embed.
    storage_path = f"{user.id}/{row['id']}/{file.filename}"
    try:
        await supabase.storage_upload(
            storage_path, data, content_type=file.content_type or "application/octet-stream"
        )
        await supabase.db_update(
            "documents",
            filters={"id": f"eq.{row['id']}"},
            patch={"status": "processing", "storage_path": storage_path},
        )
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

    processed = await _process_inline(row, data, file.content_type or "")
    return _to_doc(processed)


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

    chunks_bytes = bytearray()
    async for chunk in supabase.storage_download(doc["storage_path"]):
        chunks_bytes.extend(chunk)

    processed = await _process_inline(doc, bytes(chunks_bytes), doc.get("mime_type") or "")
    return _to_doc(processed)


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


# ── Processing ─────────────────────────────────────────────────────────


async def _process_inline(doc: dict, data: bytes, mime_type: str) -> dict:
    """Extract, chunk, embed, insert. Bounded so the request stays alive."""

    try:
        text = _extract_text(data, mime_type)
        if not text.strip():
            return (
                await supabase.db_update(
                    "documents",
                    filters={"id": f"eq.{doc['id']}"},
                    patch={"status": "failed", "error": "No readable text found."},
                )
            )[0]

        chunks = chunk_text(text, source_label=doc.get("name", "document"))
        if not chunks:
            return (
                await supabase.db_update(
                    "documents",
                    filters={"id": f"eq.{doc['id']}"},
                    patch={"status": "ready", "ready_at": datetime.now(UTC).isoformat()},
                )
            )[0]

        embeddings = await asyncio.wait_for(
            embed_texts([c.content for c in chunks]),
            timeout=PROCESSING_BUDGET_S,
        )

        rows = [
            {
                "document_id": doc["id"],
                "subspace_id": doc["subspace_id"],
                "user_id": doc["user_id"],
                "chunk_index": c.index,
                "content": c.content,
                "locator": c.locator,
                "embedding": emb,
            }
            for c, emb in zip(chunks, embeddings, strict=True)
        ]
        # Reprocess re-runs this path, so clear prior chunks first — otherwise
        # the same passage is retrieved twice and cited twice.
        await supabase.db_delete(
            "document_chunks", filters={"document_id": f"eq.{doc['id']}"}
        )
        await supabase.db_insert("document_chunks", rows)

        return (
            await supabase.db_update(
                "documents",
                filters={"id": f"eq.{doc['id']}"},
                patch={"status": "ready", "ready_at": datetime.now(UTC).isoformat()},
            )
        )[0]
    except TimeoutError:
        # Keep the doc row so the user can hit "reprocess" from the UI.
        return (
            await supabase.db_update(
                "documents",
                filters={"id": f"eq.{doc['id']}"},
                patch={"status": "processing", "error": "Still processing — tap reprocess to continue."},
            )
        )[0]
    except Exception:
        # The real exception goes to the log; the row gets copy a user can act
        # on. Never persist str(e) here — `documents.error` renders in the UI.
        log.exception("processing failed for %s", doc["id"])
        return await _fail(doc["id"], "We couldn't read this file. Try re-uploading it.")


async def _fail(doc_id: str, message: str) -> dict:
    updated = await supabase.db_update(
        "documents",
        filters={"id": f"eq.{doc_id}"},
        patch={"status": "failed", "error": message[:200]},
    )
    return updated[0]


def _extract_text(data: bytes, mime_type: str) -> str:
    if "pdf" in mime_type.lower():
        return extract_pdf_text(data)
    # Everything else: assume UTF-8 text (markdown, plain, source).
    try:
        return data.decode("utf-8", errors="ignore")
    except Exception:  # pragma: no cover
        return ""


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
    )

