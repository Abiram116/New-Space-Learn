"""Thin async wrapper around Supabase's PostgREST + Auth + Storage HTTP APIs.

We avoid the official Python client because it drags in `postgrest` + `gotrue`
+ `storage3` + `realtime` and their sync/async split makes memory heavy for a
512MB Render dyno. httpx-with-a-service-key does 95% of what we need with far
less overhead — and streaming responses stay first-class.

Only the FastAPI backend uses the service role key. Never expose it to the
browser.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from jose import JWTError, jwt

from ..config import settings
from ..errors import NotConfigured, Unauthorized, UpstreamUnavailable

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


async def verify_access_token(token: str) -> dict[str, Any]:
    """Return the decoded JWT claims for a Supabase access token.

    Tries local HS256 verification first if `SUPABASE_JWT_SECRET` is set (no
    network hop). Projects created under Supabase's newer asymmetric signing
    keys won't validate against that shared secret at all — rather than treat
    every local failure as "your session expired" (which is wrong and
    confusing when the token is actually fine), we fall back to
    `/auth/v1/user` and let Supabase be the final word.
    """

    if settings.supabase_jwt_secret:
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
            log.info("local JWT verify failed, falling back to network verify")

    return await _verify_via_network(token)


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


async def db_select(
    table: str,
    *,
    filters: dict[str, str] | None = None,
    select: str = "*",
    order: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    client = await get_client()
    params: dict[str, str] = {"select": select}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    r = await client.get(f"/rest/v1/{table}", params=params)
    _raise_if_bad(r)
    return r.json()


async def db_insert(table: str, rows: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    client = await get_client()
    r = await client.post(
        f"/rest/v1/{table}",
        json=rows,
        headers={"Prefer": "return=representation"},
    )
    _raise_if_bad(r)
    return r.json()


async def db_update(
    table: str, *, filters: dict[str, str], patch: dict[str, Any]
) -> list[dict[str, Any]]:
    client = await get_client()
    r = await client.patch(
        f"/rest/v1/{table}",
        params=filters,
        json=patch,
        headers={"Prefer": "return=representation"},
    )
    _raise_if_bad(r)
    return r.json()


async def db_delete(table: str, *, filters: dict[str, str]) -> None:
    client = await get_client()
    r = await client.delete(f"/rest/v1/{table}", params=filters)
    _raise_if_bad(r)


async def db_rpc(fn: str, args: dict[str, Any]) -> Any:
    client = await get_client()
    r = await client.post(f"/rest/v1/rpc/{fn}", json=args)
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
    log.warning("supabase %s %s → %s", r.request.method, r.request.url.path, body)
    if r.status_code == 401:
        raise Unauthorized("Backend credentials are invalid.")
    if r.status_code >= 500:
        raise UpstreamUnavailable("Database is unavailable right now.")
    raise UpstreamUnavailable(str(body.get("message", "Request failed.")))
