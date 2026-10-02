"""The reliability fixes, each pinned to the failure it prevents.

- "today" is the student's day, not the server's (`clock`)
- concurrent read-then-write on one row takes turns (`locks`, `activity.bump`)
- long lists are fetched whole, past the server's 1,000-row page (`db_select`)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

import httpx
import pytest

from app.services import activity, clock, locks, supabase

# ── The student's day ──────────────────────────────────────────────────


def test_today_is_the_students_date_not_the_servers():
    # 20:00 UTC on the 1st is already 01:30 on the 2nd in India.
    late = datetime(2026, 10, 1, 20, 0, tzinfo=UTC)
    clock.set_zone("Asia/Kolkata")
    assert clock.today(late) == date(2026, 10, 2)
    clock.set_zone(None)
    assert clock.today(late) == date(2026, 10, 1)


def test_zone_accepts_names_and_offsets_and_nothing_else():
    assert clock.parse_zone("Asia/Kolkata") is not None
    assert clock.parse_zone("330") is not None  # minutes east of UTC
    assert clock.parse_zone("-480") is not None
    for bad in ["", None, "../../etc/passwd", "/etc/localtime", "Not/AZone", "9999", "a" * 80, "Asia/Kolkata; x"]:
        assert clock.parse_zone(bad) is None, bad


async def test_zone_is_per_request_not_shared():
    """Two requests in flight must not see each other's zone."""
    late = datetime(2026, 10, 1, 20, 0, tzinfo=UTC)
    seen: dict[str, date] = {}

    async def request(name: str, tz: str | None) -> None:
        clock.set_zone(tz)
        await asyncio.sleep(0)  # let the other one run
        seen[name] = clock.today(late)

    await asyncio.gather(request("india", "Asia/Kolkata"), request("utc", None))
    assert seen == {"india": date(2026, 10, 2), "utc": date(2026, 10, 1)}


# ── Taking turns ───────────────────────────────────────────────────────


async def test_keyed_lock_serialises_one_key_and_not_others():
    order: list[str] = []

    async def work(key: str, tag: str) -> None:
        async with locks.keyed(key):
            order.append(f"{tag}-in")
            await asyncio.sleep(0.01)
            order.append(f"{tag}-out")

    await asyncio.gather(work("a", "a1"), work("a", "a2"), work("b", "b1"))
    a = [e for e in order if e.startswith("a")]
    assert a == ["a1-in", "a1-out", "a2-in", "a2-out"]  # never interleaved
    assert order.index("b1-in") < order.index("a1-out")  # a different key didn't wait
    assert locks._locks == {}  # nothing left behind


async def test_activity_bumps_in_parallel_all_count(monkeypatch):
    """Five cards graded at once used to record as fewer: each read the same
    count and wrote back "that + 1"."""
    store: dict[str, dict] = {}

    async def db_select(table, *, filters=None, **_):
        await asyncio.sleep(0)  # the gap where the race lived
        row = store.get("row")
        return [dict(row)] if row else []

    async def db_insert(table, row):
        await asyncio.sleep(0)
        store["row"] = dict(row)
        return [row]

    async def db_update(table, *, filters, patch):
        await asyncio.sleep(0)
        store["row"].update(patch)
        return [store["row"]]

    monkeypatch.setattr(supabase, "db_select", db_select)
    monkeypatch.setattr(supabase, "db_insert", db_insert)
    monkeypatch.setattr(supabase, "db_update", db_update)

    await asyncio.gather(*(activity.bump("u", cards_reviewed=1, study_seconds=20) for _ in range(5)))
    assert store["row"]["cards_reviewed"] == 5
    assert store["row"]["study_seconds"] == 100


async def test_activity_is_recorded_on_the_students_day(monkeypatch):
    inserted: list[dict] = []

    async def db_select(*_a, **_k):
        return []

    async def db_insert(table, row):
        inserted.append(row)
        return [row]

    monkeypatch.setattr(supabase, "db_select", db_select)
    monkeypatch.setattr(supabase, "db_insert", db_insert)
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 10, 2))
    await activity.bump("u", cards_reviewed=1)
    assert inserted[0]["day"] == "2026-10-02"


# ── Long lists ─────────────────────────────────────────────────────────


@pytest.fixture
def pages(monkeypatch):
    """A table of `total` rows behind a server that returns at most 1,000."""
    state = {"total": 0, "calls": []}

    async def request(method, url, *, idempotent=False, params=None, **_):
        limit = min(int(params["limit"]), 1000)
        offset = int(params.get("offset", 0))
        state["calls"].append((offset, int(params["limit"])))
        rows = [{"n": i} for i in range(offset, min(state["total"], offset + limit))]
        return httpx.Response(200, json=rows, request=httpx.Request(method, f"http://db.test{url}"))

    monkeypatch.setattr(supabase, "_request", request)
    return state


async def test_select_fetches_past_the_1000_row_page(pages):
    pages["total"] = 2500
    rows = await supabase.db_select("flashcards")
    assert [r["n"] for r in rows] == list(range(2500))
    assert [c[0] for c in pages["calls"]] == [0, 1000, 2000]


async def test_select_honours_a_limit_above_one_page(pages):
    pages["total"] = 5000
    rows = await supabase.db_select("quiz_results", limit=2000)
    assert len(rows) == 2000
    assert len(pages["calls"]) == 2


async def test_small_reads_still_cost_one_request(pages):
    pages["total"] = 12
    assert len(await supabase.db_select("notes")) == 12
    assert len(await supabase.db_select("notes", limit=5)) == 5
    assert len(pages["calls"]) == 2


# ── The header reaches the clock ───────────────────────────────────────


def test_the_timezone_header_sets_the_clock_for_that_request():
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    from app.middleware import RequestGuard

    late = datetime(2026, 10, 1, 20, 0, tzinfo=UTC)

    async def day(_request):
        return JSONResponse({"day": clock.today(late).isoformat()})

    app = Starlette(routes=[Route("/day", day)])
    app.add_middleware(RequestGuard)
    client = TestClient(app)

    assert client.get("/day", headers={"X-Timezone": "Asia/Kolkata"}).json() == {"day": "2026-10-02"}
    assert client.get("/day").json() == {"day": "2026-10-01"}  # no header: UTC, as before
    assert client.get("/day", headers={"X-Timezone": "../etc/passwd"}).json() == {"day": "2026-10-01"}


async def test_the_guard_does_not_buffer_a_streamed_response():
    """Chat streams its answer token by token. The guard wraps every request,
    so it must pass each chunk on as it is produced, not collect them.

    Driven at the ASGI level: the test client gathers a whole response before
    returning it, so it cannot tell streaming from buffering."""
    from app.middleware import RequestGuard

    events: list[str] = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        for word in (b"one", b"two", b"three"):
            events.append(f"made {word.decode()}")
            await send({"type": "http.response.body", "body": word, "more_body": True})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message):
        if message["type"] == "http.response.body" and message["body"]:
            events.append(f"sent {message['body'].decode()}")

    scope = {"type": "http", "method": "POST", "path": "/api/v1/subspaces/x/chat", "headers": []}
    await RequestGuard(app)(scope, receive, send)
    # Each chunk reaches the client before the next one is even produced.
    assert events == ["made one", "sent one", "made two", "sent two", "made three", "sent three"]
