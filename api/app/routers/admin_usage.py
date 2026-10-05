"""What the admin page reads: the analytics dashboard and the model-call counts.

Read-only, admin-only (the same unlock as the feedback desk), and never more
than counts: no prompt, reply or student is kept by `services/usage`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..deps import require_admin
from ..services import admin_dashboard, usage

router = APIRouter()


@router.get("/admin/usage")
async def model_usage(_: None = Depends(require_admin)) -> dict[str, Any]:
    return usage.snapshot()


@router.get("/admin/dashboard")
async def dashboard(_: None = Depends(require_admin)) -> dict[str, Any]:
    """Counts only, computed from a few bounded reads and kept for a minute."""
    return await admin_dashboard.dashboard()
