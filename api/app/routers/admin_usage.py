"""What the model calls have cost since the server started — for the admin page.

Read-only, admin-only (the same unlock as the feedback desk), and never more
than counts: no prompt, reply or student is kept by `services/usage`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..deps import require_admin
from ..services import usage

router = APIRouter()


@router.get("/admin/usage")
async def model_usage(_: None = Depends(require_admin)) -> dict[str, Any]:
    return usage.snapshot()
