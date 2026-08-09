"""One-off measurement script — NOT part of the app, delete after use if
you like. Calls the real, unmodified `stats()` handler directly against the
real remote Supabase database, bypassing only the HTTP/ASGI layer and JWT
verification (which this measurement isn't about). Requires a real user_id
already present in the database — pass one on argv, or the script finds one.

    uv run python scripts/measure_me_stats.py [user_id] [n_runs]
"""

from __future__ import annotations

import asyncio
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.deps import CurrentUser  # noqa: E402
from app.routers.me import stats  # noqa: E402
from app.services import supabase  # noqa: E402


async def find_user_id() -> str | None:
    rows = await supabase.db_select("user_settings", select="user_id", limit=1)
    return rows[0]["user_id"] if rows else None


async def main() -> None:
    user_id = sys.argv[1] if len(sys.argv) > 1 else await find_user_id()
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 15

    if not user_id:
        print("No user found in the database — nothing to measure against.")
        return

    print(f"Measuring GET /me/stats for user {user_id}, {n} runs...")
    user = CurrentUser(id=user_id, email=None)

    timings: list[float] = []
    for i in range(n):
        t0 = time.perf_counter()
        await stats(user=user)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        timings.append(elapsed_ms)
        print(f"  run {i + 1:2d}: {elapsed_ms:7.1f} ms")

    await supabase.close_client()

    print()
    print(f"n            = {len(timings)}")
    print(f"min          = {min(timings):.1f} ms")
    print(f"max          = {max(timings):.1f} ms")
    print(f"median       = {statistics.median(timings):.1f} ms")
    print(f"mean         = {statistics.mean(timings):.1f} ms")
    print(f"stdev        = {statistics.stdev(timings):.1f} ms" if n > 1 else "")
    # First run often pays a one-time cost (httpx connection pool warm-up,
    # DNS, TLS handshake) that every subsequent request reuses — reporting
    # it separately avoids letting one outlier skew "typical" latency.
    if n > 1:
        print(f"first run    = {timings[0]:.1f} ms")
        print(f"median (2..n)= {statistics.median(timings[1:]):.1f} ms")


if __name__ == "__main__":
    asyncio.run(main())
