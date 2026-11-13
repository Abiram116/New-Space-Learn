"""Identity, account deletion, settings and the student model.

The endpoints that describe *who* the user is and how they want to be
taught — as opposed to what they have done, which is `stats.py`, or what
they should do next, which is `brief.py`."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ...config import settings
from ...deps import CurrentUser, get_current_user
from ...errors import NotFound
from ...schemas import (
    ChatSend,
    SettingsOut,
    SettingsUpdate,
    StudentModelIn,
    StudentModelOut,
)
from ...services import chunking, ingest, ocr, purge, ratelimit, supabase, uploads
from ...services import student_model as student_model_service
from ._common import _ensure_settings_row

router = APIRouter()


@router.delete("/me")
async def delete_me(user: CurrentUser = Depends(get_current_user)) -> dict:
    """Irreversible — the frontend must confirm before ever calling this.
    Every table's `on delete cascade user_id → auth.users` FK does the
    per-table cleanup, but uploaded files live in Storage, so those are
    removed first (while `documents.storage_path` still exists)."""
    await purge.purge_documents(user.id)
    await supabase.delete_auth_user(user.id)
    return {"ok": True}


#: What a student can take with them. Their own rows only, as the student wrote
#: or generated them: no embeddings, no storage paths, nothing internal.
_EXPORT = {
    "subjects": "*",
    "subspaces": "*",
    "documents": "id,subspace_id,name,mime_type,size_bytes,status,created_at",
    "notes": "*",
    "decks": "*",
    "flashcards": "*",
    "card_reviews": "*",
    "quizzes": "*",
    "quiz_results": "*",
    "chat_messages": "*",
    "skills": "*",
    "response_feedback": "*",
    "daily_activity": "*",
    "user_settings": "*",
}
_EXPORT_ROWS = 3000


@router.get("/me/export")
async def export_me(user: CurrentUser = Depends(get_current_user)) -> JSONResponse:
    """Everything the student has put in or made here, as one JSON file.

    A privacy control, not a feature: data you cannot take out is data you do not
    really control. Read-only, scoped to the caller's own rows, and a table that
    cannot be read is named under `skipped` instead of failing the download."""

    async def one(table: str, columns: str) -> tuple[str, list[dict] | None]:
        try:
            rows = await supabase.db_select(
                table, select=columns, filters={"user_id": f"eq.{user.id}"}, limit=_EXPORT_ROWS
            )
            return table, rows
        except Exception:  # noqa: BLE001 — one unreadable table must not lose the rest
            return table, None

    results = await asyncio.gather(*(one(t, c) for t, c in _EXPORT.items()))
    body = {
        "exported_at": datetime.now(UTC).isoformat(),
        "note": f"Your own data, up to {_EXPORT_ROWS} rows per table. Uploaded files and search embeddings are not included.",
        "tables": {t: rows for t, rows in results if rows is not None},
        "skipped": [t for t, rows in results if rows is None],
    }
    return JSONResponse(
        body,
        headers={"Content-Disposition": 'attachment; filename="space-learn-export.json"', "Cache-Control": "no-store"},
    )


@router.get("/me/limits")
async def get_limits(user: CurrentUser = Depends(get_current_user)) -> dict:
    """The free-tier limits this deployment really enforces, with the caller's own
    usage. Every number is read from the code that enforces it, so this page cannot
    drift from what happens."""
    status = ratelimit.daily_status(user.id)
    return {
        "answers": {
            "per_day": int(status["limit"]),
            "left_today": status["left"],
            "burst": int(settings.llm_burst),
            "per_minute": int(settings.llm_refill_per_minute),
            "quiz_costs": 2,
        },
        "files": {
            "max_mb": uploads.MAX_BYTES // (1024 * 1024),
            "max_passages": ingest.MAX_CHUNKS,
            "passage_chars": chunking.TARGET,
            "scan_pages": ocr.MAX_PAGES,
        },
        "messages": {"max_chars": ChatSend.model_fields["text"].metadata[1].max_length, "images_per_message": ChatSend.model_fields["images"].metadata[0].max_length},
        "models": {"chat": settings.groq_model, "fast": settings.groq_model_fast},
    }


@router.get("/me/settings", response_model=SettingsOut)
async def get_settings(user: CurrentUser = Depends(get_current_user)) -> SettingsOut:
    row = await _ensure_settings_row(user.id)
    return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})


@router.patch("/me/settings", response_model=SettingsOut)
async def patch_settings(
    body: SettingsUpdate, user: CurrentUser = Depends(get_current_user)
) -> SettingsOut:
    await _ensure_settings_row(user.id)
    patch = body.model_dump(exclude_unset=True, mode="json")
    if not patch:
        row = await _ensure_settings_row(user.id)
        return SettingsOut(**{k: row.get(k) for k in SettingsOut.model_fields})
    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = await supabase.db_update(
        "user_settings", filters={"user_id": f"eq.{user.id}"}, patch=patch
    )
    if not updated:
        raise NotFound("Settings row missing.")
    return SettingsOut(**{k: updated[0].get(k) for k in SettingsOut.model_fields})


# ── Student Model ──────────────────────────────────────────────────────


def _skipped_style(explicit: object) -> bool:
    """Whether the stored intake skipped the style questions.

    Read here rather than in `Snapshot.to_model` because it is not part of
    the student model's reasoning at all — it only tells a desktop UI that
    two questions are still worth asking."""
    return isinstance(explicit, dict) and bool(explicit.get("intake_skipped_style"))


@router.get("/me/student-model", response_model=StudentModelOut)
async def get_student_model(
    user: CurrentUser = Depends(get_current_user),
) -> StudentModelOut:
    # The web app holds the whole screen on this answer at every sign-in (the
    # first-run gate), so nothing here waits for anything it does not need.
    row, model = await asyncio.gather(
        _ensure_settings_row(user.id), student_model_service.get(user.id)
    )
    return model.model_copy(
        update={"intake_skipped_style": _skipped_style(row.get("student_model"))}
    )


@router.patch("/me/student-model", response_model=StudentModelOut)
async def patch_student_model(
    body: StudentModelIn, user: CurrentUser = Depends(get_current_user)
) -> StudentModelOut:
    row = await _ensure_settings_row(user.id)
    patch = body.model_dump(exclude_unset=True)
    model = await student_model_service.set_explicit(user.id, patch)
    stored = dict(row.get("student_model") or {})
    stored.update(patch)
    return model.model_copy(update={"intake_skipped_style": _skipped_style(stored)})
