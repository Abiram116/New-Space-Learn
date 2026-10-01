"""Thin async wrapper around Supabase's PostgREST + Auth + Storage HTTP APIs.

We avoid the official Python client because it drags in `postgrest` + `gotrue`
+ `storage3` + `realtime` and their sync/async split makes memory heavy for a
512MB Render dyno. httpx-with-a-service-key does 95% of what we need with far
less overhead — and streaming responses stay first-class.

Only the FastAPI backend uses the service role key. Never expose it to the
browser.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
from jose import JWTError, jwt

from ..config import settings
from ..errors import (
    Forbidden,
    NotConfigured,
    NotFound,
    Unauthorized,
    UpstreamUnavailable,
    ValidationFailed,
)

log = logging.getLogger("space_learn.supabase")


# Module-level singleton — reused across every request for connection pooling.
_client: httpx.AsyncClient | None = None


def _service_headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        if not settings.supabase_configured:
            raise NotConfigured("Supabase isn't configured on the server.")
        _client = httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"),
            headers=_service_headers(),
            timeout=httpx.Timeout(20.0, connect=5.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ── Auth helpers ────────────────────────────────────────────────────────

# Verified-token cache. Only used when local HS256 verification is impossible
# (asymmetric signing keys), which is exactly when every request would
# otherwise cost a round trip to /auth/v1/user before doing anything useful.
_TOKEN_CACHE_TTL_S = 60.0
_TOKEN_CACHE_MAX = 512
_token_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_warned_local_verify = False

# The project's published signing keys, keyed by `kid`.
#
# Supabase issues ES256 tokens on projects created under asymmetric signing,
# which is most of them now — and an HS256 secret can never validate one. That
# is not a misconfiguration to warn about, it is simply a different key type,
# and the public half is published. Fetching it once turns every authenticated
# request from "ask Supabase who this is" into local arithmetic.
_jwks: dict[str, dict[str, Any]] = {}
_jwks_fetched_at = 0.0
#: Long, because keys rotate rarely and an unknown `kid` forces a refetch anyway.
_JWKS_TTL_S = 3600.0


async def _get_signing_key(kid: str) -> dict[str, Any] | None:
    """The public key for `kid`, fetching the key set if it is not known yet.

    A `kid` we have never seen forces a refetch even inside the TTL — that is
    what makes key rotation a non-event rather than an outage, and it cannot be
    abused into hammering the endpoint because the result is cached either way.
    """
    global _jwks_fetched_at
    now = time.monotonic()
    if kid in _jwks and now - _jwks_fetched_at < _JWKS_TTL_S:
        return _jwks[kid]
    try:
        client = await get_client()
        r = await client.get(
            "/auth/v1/.well-known/jwks.json",
            headers={"apikey": settings.supabase_service_role_key},
        )
        if r.status_code >= 400:
            return None
        keys = {k["kid"]: k for k in r.json().get("keys", []) if k.get("kid")}
    except (httpx.HTTPError, ValueError, KeyError):
        # Never fatal: the network path below is still a correct answer.
        return None
    if keys:
        _jwks.clear()
        _jwks.update(keys)
        _jwks_fetched_at = now
    return _jwks.get(kid)


async def verify_access_token(token: str) -> dict[str, Any]:
    """Return the decoded JWT claims for a Supabase access token.

    Tries local HS256 verification first if `SUPABASE_JWT_SECRET` is set (no
    network hop). Projects created under Supabase's newer asymmetric signing
    keys won't validate against that shared secret at all — rather than treat
    every local failure as "your session expired" (which is wrong and
    confusing when the token is actually fine), we fall back to
    `/auth/v1/user` and let Supabase be the final word.
    """

    # Asymmetric first — it is what this project actually issues.
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise Unauthorized("Sign-in required.") from None
    alg = header.get("alg", "")
    kid = header.get("kid")
    if kid and alg.startswith(("ES", "RS")):
        key = await _get_signing_key(kid)
        if key is not None:
            try:
                return jwt.decode(
                    token,
                    key,
                    algorithms=[alg],
                    audience="authenticated",
                    options={"verify_aud": False},
                )
            except JWTError:
                # A token that fails against a key we hold is genuinely bad —
                # but the network path gives Supabase the final word rather
                # than us guessing, and it is only reached on real failures.
                pass

    if settings.supabase_jwt_secret and alg == "HS256":
        try:
            claims = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"verify_aud": False},
            )
            return claims
        except JWTError:
            # Logged once per process, not once per request. This fires on
            # every call for projects on asymmetric signing keys, and at ~250ms
            # a hop it was the single largest cost in the app — 81 of these in
            # one page load, each one blocking real work behind it.
            global _warned_local_verify
            if not _warned_local_verify:
                _warned_local_verify = True
                log.info(
                    "local JWT verify failed — using network verify with a "
                    "short-lived cache. Set SUPABASE_JWT_SECRET to this "
                    "project's legacy HS256 secret to skip the hop entirely."
                )

    cached = _token_cache.get(token)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    claims = await _verify_via_network(token)

    # Cache briefly, keyed by the token itself. A Supabase access token is
    # already short-lived and is re-verified the moment this window lapses, so
    # the exposure is bounded — while a single page load stops paying for the
    # same verification a dozen times over.
    if len(_token_cache) > _TOKEN_CACHE_MAX:
        _token_cache.clear()
    _token_cache[token] = (time.monotonic() + _TOKEN_CACHE_TTL_S, claims)
    return claims


async def _verify_via_network(token: str) -> dict[str, Any]:
    try:
        client = await get_client()
        r = await client.get(
            "/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": settings.supabase_service_role_key},
        )
    except httpx.HTTPError as e:
        raise UpstreamUnavailable("Auth service is offline.") from e
    if r.status_code == 401:
        raise Unauthorized("Your session has expired.")
    if r.status_code >= 500:
        raise UpstreamUnavailable("Auth service returned an error.")
    if r.status_code >= 400:
        raise Unauthorized("Sign-in required.")
    user = r.json()
    return {"sub": user["id"], "email": user.get("email"), **user}


# ── PostgREST helpers ───────────────────────────────────────────────────


#: Gateway-level blips — Supabase's proxy answered, the database behind it
#: didn't. A plain 500 is NOT here: PostgREST uses it for real SQL errors,
#: and retrying a genuinely broken query just repeats the failure three times.
_RETRYABLE_STATUS = frozenset({502, 503, 504})
_MAX_ATTEMPTS = 3


async def _request(method: str, url: str, *, idempotent: bool, **kwargs: Any) -> httpx.Response:
    """Send one PostgREST/Storage request, retrying only when repeating it
    cannot change the outcome.

    GET, HEAD, PATCH-with-filters and DELETE are idempotent: sending them twice
    leaves the database exactly as sending once did. An INSERT is not — if the
    first attempt landed and only the response was lost, a retry writes a
    second row. So a write retries only when the caller vouches for it, and
    never by default. Same rule the frontend's `client.ts` follows.

    What this rides out: a dropped keep-alive connection (the most common
    failure after this process wakes from a Render spin-down, when pooled
    sockets have gone stale) and a transient 502/503/504 from Supabase's
    gateway. What it deliberately does NOT: a real 4xx/500, which retrying
    would only repeat.
    """
    client = await get_client()
    attempts = _MAX_ATTEMPTS if idempotent else 1
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            r = await client.request(method, url, **kwargs)
        except httpx.TransportError as e:
            if last:
                raise UpstreamUnavailable("Database is unavailable right now.") from e
            log.info("supabase %s %s transport error; retry %d", method, url, attempt + 1)
        else:
            if r.status_code not in _RETRYABLE_STATUS or last:
                return r
            log.info("supabase %s %s → %d; retry %d", method, url, r.status_code, attempt + 1)
        await asyncio.sleep(random.uniform(0, 0.25 * (2**attempt)))
    raise AssertionError("unreachable")  # pragma: no cover


async def db_select(
    table: str,
    *,
    filters: dict[str, str] | None = None,
    select: str = "*",
    order: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {"select": select}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    r = await _request("GET", f"/rest/v1/{table}", idempotent=True, params=params)
    _raise_if_bad(r)
    return r.json()


async def db_count(table: str, *, filters: dict[str, str] | None = None) -> int:
    """Exact row count without transferring any rows.

    Every caller that only wanted a count used to go through `db_select`
    and call `len()` on the result — correct, but it means the response
    payload (and the query planner's work) scales with however many rows
    match, for a number that was thrown away the instant it arrived. A
    `HEAD` request with `Prefer: count=exact` asks PostgREST to compute the
    same count server-side and hand it back in the `Content-Range` response
    header instead, with an empty body — the query itself still touches
    every matching row, but nothing is serialized or sent over the wire for
    them. This is the kind of gap that isn't obvious in testing, where a
    handful of rows costs almost nothing either way, and shows up later as
    unexplained latency drift once real usage has actually grown a table.
    """
    params: dict[str, str] = {"select": "id"}
    if filters:
        params.update(filters)
    r = await _request(
        "HEAD",
        f"/rest/v1/{table}",
        idempotent=True,
        params=params,
        headers={"Prefer": "count=exact"},
    )
    _raise_if_bad(r)
    # PostgREST's own format for this header is "<range>/<total>" — a HEAD
    # request has no range to report, so it comes back as "*/<total>".
    total = r.headers.get("content-range", "").split("/")[-1]
    return int(total) if total.isdigit() else 0


async def db_insert(table: str, rows: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Not idempotent — see `_request`. A duplicated note or quiz result is
    # worse than an honest "try again".
    r = await _request(
        "POST",
        f"/rest/v1/{table}",
        idempotent=False,
        json=rows,
        headers={"Prefer": "return=representation"},
    )
    _raise_if_bad(r)
    return r.json()


async def db_update(
    table: str, *, filters: dict[str, str], patch: dict[str, Any]
) -> list[dict[str, Any]]:
    # Setting fields to fixed values is idempotent: applying it twice lands
    # the same row state as applying it once.
    r = await _request(
        "PATCH",
        f"/rest/v1/{table}",
        idempotent=True,
        params=filters,
        json=patch,
        headers={"Prefer": "return=representation"},
    )
    _raise_if_bad(r)
    return r.json()


async def db_delete(table: str, *, filters: dict[str, str]) -> None:
    r = await _request("DELETE", f"/rest/v1/{table}", idempotent=True, params=filters)
    _raise_if_bad(r)


async def db_rpc(fn: str, args: dict[str, Any], *, read_only: bool = False) -> Any:
    """Call a Postgres function. Only retried when the caller declares it
    `read_only` — a function can do anything, so this can't infer safety from
    the HTTP verb (RPC is always POST) the way the table helpers can."""
    r = await _request("POST", f"/rest/v1/rpc/{fn}", idempotent=read_only, json=args)
    _raise_if_bad(r)
    return r.json()


# ── Auth admin ─────────────────────────────────────────────────────────


async def delete_auth_user(user_id: str) -> None:
    """Admin API delete — the on-delete-cascade FKs on every table (user_id
    → auth.users) do the rest, no per-table cleanup needed here."""
    client = await get_client()
    r = await client.delete(f"/auth/v1/admin/users/{user_id}")
    _raise_if_bad(r)


# ── Storage ─────────────────────────────────────────────────────────────


async def storage_upload(path: str, data: bytes, *, content_type: str) -> str:
    """Upload to the configured bucket. `path` is the in-bucket key, and is what
    we return + persist — callers never store the bucket name alongside it."""
    client = await get_client()
    bucket = settings.supabase_storage_bucket
    r = await client.post(
        f"/storage/v1/object/{bucket}/{path}",
        content=data,
        headers={"Content-Type": content_type, "x-upsert": "true"},
    )
    _raise_if_bad(r)
    return path


async def storage_delete(path: str) -> None:
    client = await get_client()
    bucket = settings.supabase_storage_bucket
    r = await client.delete(f"/storage/v1/object/{bucket}/{path}")
    if r.status_code == 404:
        return
    _raise_if_bad(r)


async def storage_download(path: str) -> AsyncIterator[bytes]:
    client = await get_client()
    bucket = settings.supabase_storage_bucket
    async with client.stream("GET", f"/storage/v1/object/{bucket}/{path}") as r:
        _raise_if_bad(r)
        async for chunk in r.aiter_bytes():
            yield chunk


# ── Internal ────────────────────────────────────────────────────────────


def _raise_if_bad(r: httpx.Response) -> None:
    if r.status_code < 400:
        return
    try:
        body = r.json()
    except Exception:
        body = {"message": r.text[:200]}
    if not isinstance(body, dict):
        body = {"message": str(body)[:200]}
    # The full body goes to the log. What the person sees is chosen below and
    # never contains the database's own wording (table names, constraint names,
    # "duplicate key value violates ...").
    log.warning("supabase %s %s → %s", r.request.method, r.request.url.path, body)
    if r.status_code == 401:
        # OUR credentials were refused — a server setup problem, not the
        # student's session. Raising Unauthorized here would sign them out of the
        # app for something they cannot fix.
        raise UpstreamUnavailable("The service isn't set up correctly right now. Please try again later.")
    if r.status_code >= 500:
        raise UpstreamUnavailable("Database is unavailable right now.")

    code = str(body.get("code") or "")
    if code == "23505":  # unique violation
        raise ValidationFailed("That already exists.")
    if code == "23503":  # foreign key: the thing it points at is gone
        raise ValidationFailed("That item no longer exists.")
    if code in {"23502", "23514", "22001", "22003"}:  # null / check / too long / out of range
        raise ValidationFailed("Some of that input isn't allowed.")
    if code in {"22P02", "PGRST116"}:  # malformed id / no matching row
        raise NotFound("We couldn't find that.")
    if code == "42501" or r.status_code == 403:
        raise Forbidden("You don't have access to that.")
    if r.status_code == 404:
        raise NotFound("We couldn't find that.")
    raise UpstreamUnavailable("We couldn't save that just now. Please try again.")
