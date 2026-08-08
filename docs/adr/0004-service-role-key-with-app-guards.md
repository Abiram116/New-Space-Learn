# ADR-0004 — Service-role key + application guards, with RLS as defense-in-depth

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** `docs/SECURITY.md §2`, `api/app/guards.py`

## Context

The backend needs to read and write across many tables in a single request
(a chat turn touches `subspaces`, `user_settings`, `skills`, `chat_messages`,
`document_chunks`, and `daily_activity`). Supabase offers two ways to
authenticate as the caller: forward the user's JWT so RLS applies, or use the
service-role key, which bypasses RLS entirely.

## Problem

Which layer is authoritative for "may this caller touch this row?"

## Decision

The backend uses the **service-role key**. Authorization is enforced in
application code by explicit ownership assertions (`guards.py`:
`assert_subspace`, `assert_space`, `assert_deck`) called before any handler
touches a caller-supplied row id. **RLS stays enabled on every table as
defense-in-depth, but it is not the primary control.**

Guards return **404, not 403**, on a foreign id, so an attacker can't use the
status code to confirm another user's row exists.

## Alternatives considered

1. **Forward the user's JWT; let RLS be the only control.** Rejected: every
   cross-table write in one request would need the user's token threaded
   through, and any operation legitimately spanning users or system rows
   (seeded library Skills) becomes awkward. Also loses the ability to
   distinguish "not found" from "not yours" cleanly.
2. **Service-role key with no application checks, trusting RLS.** Not viable
   — the service key bypasses RLS by definition. This combination is simply
   an unauthenticated API.
3. **Service-role key + explicit guards + RLS retained.** Chosen.

## Trade-offs

**The cost is severe and must be stated without softening: a single forgotten
`assert_*` call is a silent cross-user data leak with no second line of
defense in the request path.** `architecture.md` records that this has
already happened once and was fixed by hand.

**The benefit:** router code stays simple and readable; one request can span
tables without re-authenticating per table; ownership logic lives in exactly
one module instead of being duplicated across policies and code.

The trade is only defensible **with tests**, and those don't exist yet —
which is why this is the top-ranked item in both `SECURITY.md §11` and
`IMPLEMENTATION_PLAN.md` Phase 0.

## Consequences

- `guards.py` is the single most security-critical file in the repo.
- Some handlers deliberately run the guard concurrently with a first read via
  `asyncio.gather` — safe only because those reads are already
  `user_id`-filtered and the guard's result is still awaited.
  `notes.py::list_notes` documents this inline; that's the pattern to copy.
- `subspace_chat.py::_active_skills` queries without a `user_id` filter,
  relying entirely on the caller having already asserted ownership. A
  refactor could silently break this; it needs a test.
- RLS remains correct and useful: it's what protects the browser's anon-key
  access path, and it would contain a compromise where the service key is
  *not* in play.

## Future migration path

Moving to RLS-as-primary would mean forwarding user JWTs on every PostgREST
call and reworking every multi-table handler — a large change with no
security gain over guards-plus-tests. The right investment is tests, not a
migration. If the service key were ever leaked, rotation is a Supabase
dashboard action, and RLS would still constrain anon-key traffic in the
interim.
