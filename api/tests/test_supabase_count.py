"""`db_count` — an exact row count without transferring any rows.

Added alongside `me/stats.py`'s switch away from "select every matching
row's `id`, then call `len()`" for counting: correct at small scale, but
its cost scales with however much data a real account has accumulated,
which is exactly the kind of thing that doesn't show up in a quick test
and shows up months later as unexplained latency drift.

These exercise the actual HTTP contract — a `HEAD` request with
`Prefer: count=exact`, and PostgREST's `Content-Range: */<total>` response
format — via `httpx.MockTransport`, not the `FakeDb` fixture the rest of
the suite uses (that fixture stubs `db_count` itself; it can't tell us
whether the real implementation talks to PostgREST correctly).
"""

from __future__ import annotations

import httpx
import pytest

from app.errors import UpstreamUnavailable
from app.services import supabase as supabase_module


@pytest.fixture(autouse=True)
def _reset_client():
    """`get_client()` memoizes a singleton — clear it so each test's own
    mock transport doesn't leak into the next test."""
    supabase_module._client = None
    yield
    supabase_module._client = None


async def _install(handler) -> None:
    supabase_module._client = httpx.AsyncClient(
        base_url="https://example.supabase.co",
        transport=httpx.MockTransport(handler),
    )


async def test_parses_the_total_out_of_content_range():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["prefer"] = request.headers.get("prefer")
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, headers={"content-range": "*/42"})

    await _install(handler)
    total = await supabase_module.db_count("flashcards", filters={"user_id": "eq.u1"})

    assert total == 42
    # `HEAD`, not `GET` — the whole point is never receiving row bodies.
    assert seen["method"] == "HEAD"
    assert seen["prefer"] == "count=exact"
    assert seen["params"]["user_id"] == "eq.u1"


async def test_defaults_to_zero_on_a_missing_or_malformed_header():
    await _install(lambda request: httpx.Response(200, headers={}))
    assert await supabase_module.db_count("flashcards") == 0

    await _install(lambda request: httpx.Response(200, headers={"content-range": "*/not-a-number"}))
    assert await supabase_module.db_count("flashcards") == 0


async def test_raises_on_a_server_error_same_as_db_select():
    await _install(lambda request: httpx.Response(500, json={"message": "boom"}))
    with pytest.raises(UpstreamUnavailable):
        await supabase_module.db_count("flashcards")
