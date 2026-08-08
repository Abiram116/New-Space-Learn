"""Every endpoint taking a caller-supplied row id must prove ownership.

The unit tests in `test_guards.py` prove the guards work. This file proves
they're actually *used* — a different and, historically, more dangerous
failure. `docs/architecture.md` records a cross-user leak that shipped once
already; it wasn't caused by a broken guard but by a handler that never called
one.

A route is considered safe if its source either:
  - calls one of the ownership guards, or
  - scopes its own queries with `user_id = <caller>`, which PostgREST applies
    server-side and which cannot return another user's row.

A new handler that does neither fails this test, at the moment it's written,
rather than in production.
"""

from __future__ import annotations

import inspect
import re

from fastapi.routing import APIRoute

from app.main import create_app

# Path params that name a row somebody could own. `skill_id` is absent on
# purpose: library skills are intentionally shared, and `_assert_can_use_skill`
# handles the private case with its own explicit check.
OWNED_ID_PARAMS = {
    "subspace_id",
    "space_id",
    "deck_id",
    "note_id",
    "card_id",
    "quiz_id",
    "document_id",
    "linked_subspace_id",
}

GUARD_CALLS = (
    "assert_subspace",
    "assert_space",
    "assert_deck",
    "_get_owned_subspace",
    "_assert_space_owned",
    "_assert_can_use_skill",
)

# `filters={"user_id": f"eq.{user.id}"}` in any of its formatting variants.
USER_SCOPED_QUERY = re.compile(r'"user_id":\s*f"eq\.\{user(?:\.id)?\}"')


def _routes_with_owned_ids() -> list[tuple[str, APIRoute]]:
    app = create_app()
    out = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        params = set(re.findall(r"\{(\w+)\}", route.path))
        if params & OWNED_ID_PARAMS:
            out.append((route.path, route))
    return out


def test_there_are_routes_to_check():
    """Guard the guard: if route discovery silently returns nothing, every
    assertion below passes vacuously and this file becomes decoration."""
    assert len(_routes_with_owned_ids()) > 10


def test_every_owned_id_route_proves_ownership():
    unprotected: list[str] = []
    for path, route in _routes_with_owned_ids():
        source = inspect.getsource(route.endpoint)
        has_guard = any(call in source for call in GUARD_CALLS)
        has_user_scope = bool(USER_SCOPED_QUERY.search(source))
        if not (has_guard or has_user_scope):
            methods = ",".join(sorted(route.methods - {"HEAD", "OPTIONS"}))
            unprotected.append(f"{methods} {path} ({route.endpoint.__name__})")

    assert not unprotected, (
        "These handlers accept a caller-supplied row id but neither call an "
        "ownership guard nor scope their queries by user_id. The service-role "
        "key bypasses RLS, so this is a cross-user data leak:\n  "
        + "\n  ".join(unprotected)
    )


def test_every_authenticated_route_requires_a_user():
    """A route that forgets `Depends(get_current_user)` is open to the world.

    `/health` is the only deliberate exception — it's what the offline banner
    and the cold-start warm-up call before anyone has signed in.
    """
    app = create_app()
    public = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path.endswith("/health"):
            continue
        source = inspect.getsource(route.endpoint)
        if "get_current_user" not in source:
            public.append(f"{route.path} ({route.endpoint.__name__})")
    assert not public, "These routes don't require authentication:\n  " + "\n  ".join(public)
