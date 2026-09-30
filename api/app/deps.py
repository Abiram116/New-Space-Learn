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
    #: The student's own display name as stored in Supabase `user_metadata`
    #: (unvalidated — `routers/me/brief.py` decides whether it is safe to
    #: address them by). `None` when the token carries none.
    name: str | None = None


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
    return CurrentUser(id=user_id, email=claims.get("email"), name=_claimed_name(claims))


def _claimed_name(claims: dict) -> str | None:
    """The name the student gave us, from the claims Supabase already signs.

    `display_name` is what our own sign-up and Settings write; `full_name` and
    `name` are what OAuth providers fill in. Never derived from the email — a
    local part like `abiram116` is not a name, and no name beats a wrong one.
    """
    meta = claims.get("user_metadata")
    if not isinstance(meta, dict):
        meta = {}
    for source in (meta, claims):
        for key in ("display_name", "full_name", "name"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:80]
    return None
