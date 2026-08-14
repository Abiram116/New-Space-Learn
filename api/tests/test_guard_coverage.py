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

Owned ids arrive two ways, and both are covered:
  - in the **path** (`/subspaces/{subspace_id}`) — `OWNED_ID_PARAMS`.
  - in the **body** (`FeedbackIn.subspace_id`) — `OWNED_ID_BODY_FIELDS`. The
    2026-08 end-to-end audit found the scanner only ever looked at path
    params; every current body-supplied id was hand-verified guarded, but the
    scanner itself would have said nothing if one weren't. This closes that
    gap the same deterministic way as the path-param check: read the route's
    actual Pydantic body model via `inspect.signature`, not a text guess.
"""

from __future__ import annotations

import inspect
import re

from fastapi.routing import APIRoute
from pydantic import BaseModel

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

# Same concept, for ids that arrive in a request body instead of the path.
# Deliberately a subset of the resources above, not every `*_id` field in
# `schemas/__init__.py`: `target_id` on `FeedbackIn` is excluded because its
# own migration documents it as NOT a foreign key — it points at four
# different tables depending on `surface`, so there is no single table to
# check it against, and `response_feedback`'s unique constraint plus its
# "orphaned targets are harmless" design already accounts for that.
OWNED_ID_BODY_FIELDS = OWNED_ID_PARAMS

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


def _body_models(endpoint) -> list[type[BaseModel]]:
    """The Pydantic request-body models FastAPI will inject into `endpoint`.

    A `BaseModel`-annotated parameter is a request body in FastAPI's own
    routing rules (path/query params are plain scalars); this reads that
    straight from the real signature rather than guessing from the source
    text, so it can't be fooled by a body parameter named something unusual.
    """
    # `eval_str=True`: every router module uses `from __future__ import
    # annotations`, which turns every annotation into an unevaluated string.
    # Without this, `param.annotation` is the literal text `"FeedbackIn"`,
    # never a class, and `issubclass` below would silently never match —
    # the exact failure mode this hardening pass exists to close.
    out = []
    for param in inspect.signature(endpoint, eval_str=True).parameters.values():
        ann = param.annotation
        if isinstance(ann, type) and issubclass(ann, BaseModel):
            out.append(ann)
    return out


def _owned_id_body_fields(endpoint) -> set[str]:
    """Which `OWNED_ID_BODY_FIELDS` this endpoint's body model(s) carry."""
    fields: set[str] = set()
    for model in _body_models(endpoint):
        fields |= set(model.model_fields) & OWNED_ID_BODY_FIELDS
    return fields


def _is_protected(source: str) -> bool:
    """Same test both discovery paths share: some ownership guard was called,
    or the query itself is scoped to the caller. Deliberately coarse — like
    the rest of this file, it proves *a* check exists in the function, not
    that it's applied to the specific id (that granularity is what
    `test_guards.py` and manual review are for)."""
    has_guard = any(call in source for call in GUARD_CALLS)
    has_user_scope = bool(USER_SCOPED_QUERY.search(source))
    return has_guard or has_user_scope


def _routes_with_owned_ids() -> list[tuple[str, APIRoute, set[str]]]:
    """Every route with a caller-supplied owned id, path or body, plus which
    field names triggered inclusion — so a failure message can say exactly
    what was found, not just that something was."""
    app = create_app()
    out = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path_fields = set(re.findall(r"\{(\w+)\}", route.path)) & OWNED_ID_PARAMS
        body_fields = _owned_id_body_fields(route.endpoint)
        fields = path_fields | body_fields
        if fields:
            out.append((route.path, route, fields))
    return out


def test_there_are_routes_to_check():
    """Guard the guard: if route discovery silently returns nothing, every
    assertion below passes vacuously and this file becomes decoration."""
    assert len(_routes_with_owned_ids()) > 10


def test_every_owned_id_route_proves_ownership():
    unprotected: list[str] = []
    for path, route, fields in _routes_with_owned_ids():
        source = inspect.getsource(route.endpoint)
        if not _is_protected(source):
            methods = ",".join(sorted(route.methods - {"HEAD", "OPTIONS"}))
            field_list = ",".join(sorted(fields))
            unprotected.append(
                f"{methods} {path} ({route.endpoint.__name__}) — owned id(s): {field_list}"
            )

    assert not unprotected, (
        "These handlers accept a caller-supplied row id (in the path or the "
        "request body) but neither call an ownership guard nor scope their "
        "queries by user_id. The service-role key bypasses RLS, so this is a "
        "cross-user data leak:\n  " + "\n  ".join(unprotected)
    )


class _FakeBody(BaseModel):
    """Module-level on purpose: `_body_models` resolves string annotations via
    `eval_str=True` against the handler's own module globals (every router
    uses `from __future__ import annotations`), so a class local to the test
    function wouldn't be resolvable — the same constraint real routers live
    under."""

    subspace_id: str
    note: str = ""


def _unguarded_handler(body: _FakeBody, user=None):
    # No ownership check at all, on the id or otherwise — the exact bug
    # class this file exists to catch. (This comment deliberately never
    # spells out a real guard's name: `_is_protected` is a plain substring
    # scan, and writing one here — even to say "there isn't one" — would
    # make this handler wrongly look protected.)
    return {"ok": True, "note": body.note}


def _guarded_handler(body: _FakeBody, user=None):
    pass  # await assert_subspace(user.id, body.subspace_id)


def test_scanner_catches_a_synthetic_route_missing_a_guard():
    """Mutation check for `_owned_id_body_fields` / `_is_protected` themselves:
    proves the body-field scanner actually flags an unguarded handler, using
    the exact bug class this file exists to catch (a body-supplied
    `subspace_id` nobody ever checked), rather than only ever passing on
    today's already-guarded code."""

    unguarded_handler = _unguarded_handler
    guarded_handler = _guarded_handler

    fields = _owned_id_body_fields(unguarded_handler)
    assert "subspace_id" in fields, "the scanner failed to see the body field at all"

    assert not _is_protected(inspect.getsource(unguarded_handler)), (
        "the scanner should have flagged this synthetic handler as unguarded"
    )
    assert _is_protected(inspect.getsource(guarded_handler)), (
        "the scanner should recognize a real guard call once one is present"
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
