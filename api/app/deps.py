"""FastAPI dependencies — always small, always cache-friendly."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header

from .errors import Unauthorized
from .services import supabase


@dataclass(slots=True)
class CurrentUser:
    id: str
    email: str | None


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("Sign in required.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise Unauthorized("Sign in required.")
    claims = await supabase.verify_access_token(token)
    user_id = claims.get("sub")
    if not user_id:
        raise Unauthorized("Sign in required.")
    return CurrentUser(id=user_id, email=claims.get("email"))
