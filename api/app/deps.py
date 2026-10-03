"""FastAPI dependencies — always small, always cache-friendly."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, Request

from .errors import Forbidden, Unauthorized
from .services import admin_gate, student_model, supabase


@dataclass(slots=True)
class CurrentUser:
    id: str
    email: str | None
    #: The student's own display name as stored in Supabase `user_metadata`
    #: (unvalidated — `routers/me/brief.py` decides whether it is safe to
    #: address them by). `None` when the token carries none.
    name: str | None = None


async def _authenticate(authorization: str | None) -> CurrentUser:
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


async def get_current_user(
    request: Request, authorization: str | None = Header(default=None)
) -> CurrentUser:
    user = await _authenticate(authorization)
    # Anything that is not a read may change what the student model sees, so
    # its short-lived cache for this user is dropped before the handler runs.
    # One rule here covers every write endpoint, including ones written later.
    if request.method not in _READ_METHODS:
        student_model.begin_write(user.id)
    return user


_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def get_optional_user(authorization: str | None = Header(default=None)) -> CurrentUser | None:
    """The signed-in user, or None for a visitor.

    For the few endpoints a signed-out visitor may call (the feedback form on
    the landing page). A token that is present but bad is still refused — only
    its absence means "anonymous".
    """
    if not authorization:
        return None
    return await _authenticate(authorization)


async def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Someone who unlocked the admin page with the shared password, or a 403.

    Separate from signing in on purpose: the admin side belongs to no account.
    The token comes from `POST /admin/unlock` (see `services/admin_gate`). A 403
    rather than a 401, so a stale admin token never signs a student out.
    """
    if not admin_gate.check_token(x_admin_token):
        raise Forbidden("The admin page is locked.")


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
