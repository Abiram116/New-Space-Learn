"""Identity, account deletion, settings and the student model.

The endpoints that describe *who* the user is and how they want to be
taught — as opposed to what they have done, which is `stats.py`, or what
they should do next, which is `brief.py`."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...deps import CurrentUser, get_current_user
from ...schemas import (
    Me,
    SettingsOut,
    SettingsUpdate,
    StudentModelIn,
    StudentModelOut,
)
from ...services import student_model as student_model_service
from ...services import supabase
from ._common import _ensure_settings_row

router = APIRouter()


@router.get("/me", response_model=Me)
async def me(user: CurrentUser = Depends(get_current_user)) -> Me:
    return Me(id=user.id, email=user.email)


@router.delete("/me")
async def delete_me(user: CurrentUser = Depends(get_current_user)) -> dict:
    """Irreversible — the frontend must confirm before ever calling this.
    Every table's `on delete cascade user_id → auth.users` FK does the
    per-table cleanup; nothing else to do here."""
    await supabase.delete_auth_user(user.id)
    return {"ok": True}


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


@router.get("/me/student-model", response_model=StudentModelOut)
async def get_student_model(
    user: CurrentUser = Depends(get_current_user),
) -> StudentModelOut:
    await _ensure_settings_row(user.id)
    return await student_model_service.get(user.id)


@router.patch("/me/student-model", response_model=StudentModelOut)
async def patch_student_model(
    body: StudentModelIn, user: CurrentUser = Depends(get_current_user)
) -> StudentModelOut:
    await _ensure_settings_row(user.id)
    return await student_model_service.set_explicit(
        user.id, body.model_dump(exclude_unset=True)
    )
