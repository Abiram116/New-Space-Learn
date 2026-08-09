# ADR-0006 — Hand-rolled httpx Supabase wrapper over the official SDK

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** `api/app/services/supabase.py`, `docs/ARCHITECTURE.md` (Trade-offs)

## Context

The backend talks to Supabase's PostgREST, Auth, and Storage HTTP APIs.
There's an official Python client (`supabase-py`) that wraps all three.

## Problem

The deployment target is Render's free tier: 512MB RAM, one worker.
`supabase-py` pulls in `postgrest`, `gotrue`, `storage3`, and `realtime`, and
its sync/async split adds further weight — for a product that uses a narrow
slice of the surface area.

## Decision

Hand-roll a thin async wrapper over `httpx` (`services/supabase.py`), holding
a module-level singleton `AsyncClient` for connection pooling, with helpers
for `db_select`/`db_insert`/`db_update`/`db_delete`/`db_rpc`, storage
upload/download/delete, and JWT verification.

## Alternatives considered

1. **Official `supabase-py`.** Rejected on memory footprint against a hard
   512MB ceiling — the constraint that shapes this entire stack.
2. **A full ORM (SQLAlchemy) against Postgres directly.** Rejected: gives up
   PostgREST's ready-made filtering and, more importantly, means managing a
   direct connection pool to a remote database from a process that spins down
   constantly. Also a much larger dependency.
3. **Thin httpx wrapper.** Chosen — "does 95% of what we need with far less
   overhead," per the module's own docstring, and streaming responses stay
   first-class (which matters for chat SSE and storage downloads).

## Trade-offs

**Cost:** ~265 lines of client code to maintain that would otherwise be
someone else's problem. No SDK conveniences. PostgREST filter syntax
(`eq.`, `in.(...)`) leaks into call sites as string literals, which is
slightly awkward and untypechecked — a real ergonomic cost visible throughout
the routers.

**Benefit:** measurably smaller memory footprint on the instance that has to
survive; full control over timeouts, connection limits (`max_connections=20`,
`max_keepalive_connections=10`), and streaming behavior; no dependency
surprises on a free tier.

**A bonus that turned out to matter:** owning the client is what made the JWT
verification strategy possible — local HS256 with a network fallback and a
60-second verified-token cache, added after network verification was measured
as the app's single largest latency cost (81 hops in one page load at ~250ms
each). An SDK's fixed verification path would have made that fix harder.

## Consequences

- PostgREST filter strings appear inline across routers. Acceptable, but it's
  the main reason a future "repository layer" might earn its place — not for
  purity, but to get these strings typechecked in one spot.
- The measured insight that concurrent Supabase calls can be *slower* than
  sequential ones against a remote database (1566ms vs 1114ms, TLS handshake
  overhead) came from owning this layer and being able to instrument it.
- Storage streaming (`storage_download` as an async iterator) is used by
  document reprocessing without buffering whole files in memory.

## Future migration path

If the RAM ceiling lifts (paid Render tier) and the SDK's footprint stops
mattering, migrating is mechanical — every call already funnels through this
one module's function signatures, so the swap is internal to
`services/supabase.py`. Worth doing only if maintenance cost ever exceeds the
benefit; not currently close.
