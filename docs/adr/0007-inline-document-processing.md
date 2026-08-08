# ADR-0007 — Inline document processing with a resumable budget, no job queue

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** `api/app/routers/documents.py`, `docs/AI_ENGINE.md §1–4`

## Context

Uploading a document requires extracting text, chunking it, embedding every
chunk, and inserting the rows. That's variable-duration work — a 2-page
handout and a 200-page textbook differ by orders of magnitude.

## Problem

The conventional answer is a background job queue (Celery, RQ, or a hosted
equivalent) with the upload endpoint returning immediately. Render's free tier
provides no background workers and spins the single service down after 15
minutes of inactivity, so there is nothing to run a queue *on*, and nothing to
guarantee a queued job is ever picked up.

## Decision

**Process inline, inside the upload request, bounded by a 25-second budget
(`PROCESSING_BUDGET_S`).** If the budget is exceeded, leave the document in
`status: "processing"` with a user-facing message pointing at
`POST /documents/{id}/reprocess`, which resumes the same work on a second
request.

The `documents` row is inserted *before* processing begins (`status:
"uploading"`), so the client sees the document immediately regardless of how
long processing takes.

## Alternatives considered

1. **A real job queue.** Rejected: no worker to run it on, and adding a paid
   service contradicts the free-tier constraint that defines this stack.
2. **Unbounded inline processing.** Rejected: the request would hang until
   Render's own connection timeout killed it, leaving a document in an
   indeterminate state and the user with no explanation.
3. **`BackgroundTasks` (FastAPI's in-process option).** Rejected — subtly
   worse than it looks: the work would continue after the response is sent,
   but on the *same single worker*, so it competes with live requests, and it
   is lost entirely if the instance spins down mid-task. Inline-with-a-budget
   at least fails visibly and resumably.
4. **Inline with a resumable budget.** Chosen.

## Trade-offs

**Cost:** a large document takes multiple user-initiated passes to finish
indexing. The user has to press a button again — real friction, and honest
about it rather than hidden behind a spinner that never resolves.

**Benefit:** zero infrastructure to operate, zero queue to monitor, and an
entire class of bug (orphaned/stuck/lost jobs) simply doesn't exist. The
25-second cap also doubles as a DoS control on a single-worker deployment
(`SECURITY.md §6`) — a pathological file can't monopolize the only worker
indefinitely.

**Notable design detail:** `_process_inline` deletes prior chunks before
inserting new ones, so reprocessing is idempotent rather than producing
duplicate chunks that would then be retrieved and cited twice.

## Consequences

- `documents.status` has a third meaningful state beyond success/failure:
  `processing` with an actionable message. `REQUEST_PIPELINE.md` calls this
  out because treating it as a failure would tell a student to re-upload a
  file that's actually fine.
- Errors stored in `documents.error` are always fixed, user-safe strings —
  never `str(e)` — because that column renders in the UI.
- The 25s budget currently constrains stub embedding (microseconds), so it's
  effectively untested against real work. **Once real embeddings land
  (`IMPLEMENTATION_PLAN.md` Phase 0.1), this budget becomes load-bearing for
  the first time** and the median processing time should be measured against
  it.

## Future migration path

On a paid Render tier with a persistent worker, this becomes a real queue with
minimal disruption: `_process_inline` is already a standalone function taking
`(doc, data, mime_type)` — it would be enqueued rather than awaited, and
`reprocess` would become a retry trigger rather than a resume mechanism. The
document status states already model asynchronous processing correctly, so no
schema or UI change would be needed.
