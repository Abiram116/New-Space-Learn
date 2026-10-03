"""Remove a user's uploaded files from Storage.

Deleting a topic, a subject or an account cascades through the database, but
the original uploads live in the Storage bucket and the cascade can't reach
them. Without this they would stay forever, which contradicts the Privacy
promise that deleting something deletes it.

Always called BEFORE the rows go: `documents.storage_path` is the only index
of which files belong to what, and it disappears with the cascade."""

from __future__ import annotations

import logging

from . import ingest, supabase

log = logging.getLogger("spacelearn.purge")


async def purge_documents(user_id: str, *, subspace_ids: list[str] | None = None) -> None:
    """Delete the stored files (and stop any live ingestion) for the user's
    documents — all of them, or only those in `subspace_ids`.

    Best-effort: a Storage hiccup must not stop the delete the user asked for,
    so failures are logged and swallowed."""
    filters = {"user_id": f"eq.{user_id}"}
    if subspace_ids is not None:
        if not subspace_ids:
            return
        filters["subspace_id"] = f"in.({','.join(subspace_ids)})"
    try:
        docs = await supabase.db_select(
            "documents", filters=filters, select="id,storage_path"
        )
    except Exception:  # noqa: BLE001
        log.warning("could not list documents to purge for %s", user_id)
        return
    for doc in docs:
        await ingest.cancel(doc["id"])
    paths = [d["storage_path"] for d in docs if d.get("storage_path")]
    if not paths:
        return
    try:
        await supabase.storage_delete_many(paths)
    except Exception:  # noqa: BLE001
        log.warning("storage purge failed for %d file(s) of %s", len(paths), user_id)
