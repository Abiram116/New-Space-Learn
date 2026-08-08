"""Re-embed every stored document.

**Run this once, after switching from stub embeddings to a real provider.**

Documents ingested while `USE_STUB_EMBEDDINGS=true` hold deterministic
hash-based vectors that carry no meaning. They will never retrieve correctly,
and nothing about them looks broken from the outside — the document says
`ready`, the chunks exist, and search returns *something*. This script rebuilds
their embeddings.

Why a script instead of an endpoint: re-embedding a whole corpus is a
maintenance operation, not a user action. Doing it inline would blow the
25-second per-request processing budget (`documents.PROCESSING_BUDGET_S`) that
exists precisely because this free tier has no background workers. A script
runs unbounded, sequentially, with visible progress and a resumable failure
mode.

Usage, from `api/`:

    uv run python scripts/reembed_documents.py --dry-run
    uv run python scripts/reembed_documents.py
    uv run python scripts/reembed_documents.py --user <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Make `app` importable when run as a plain script from `api/`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# `_process_inline` is deliberately reused from the endpoint rather than
# reimplemented here. A second copy of extract → chunk → embed → insert would
# drift from the real one the first time either changed, and this script exists
# to make retrieval correct — it must not itself become a source of skew.
from app.config import settings  # noqa: E402
from app.routers.documents import _process_inline  # noqa: E402
from app.services import embeddings, supabase  # noqa: E402


async def _fetch_documents(user_id: str | None) -> list[dict]:
    filters = {"status": "eq.ready"}
    if user_id:
        filters["user_id"] = f"eq.{user_id}"
    return await supabase.db_select(
        "documents",
        filters=filters,
        select="id,user_id,subspace_id,name,mime_type,storage_path",
        order="created_at.asc",
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", help="Only re-embed this user's documents.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be re-embedded and exit.",
    )
    args = parser.parse_args()

    if not settings.real_embeddings_enabled:
        print(
            "Refusing to run: real embeddings are not enabled.\n"
            "  USE_STUB_EMBEDDINGS must be false AND EMBEDDING_API_KEY must be set.\n"
            "Re-embedding with the stub would just rewrite the same meaningless "
            "vectors and report success, which is worse than not running.",
            file=sys.stderr,
        )
        return 1

    docs = await _fetch_documents(args.user)
    if not docs:
        print("No ready documents found — nothing to do.")
        return 0

    print(f"{len(docs)} document(s) to re-embed with {settings.embedding_model}.")
    if args.dry_run:
        for d in docs:
            print(f"  would re-embed  {d['name']}  ({d['id']})")
        return 0

    ok = skipped = failed = 0
    for i, doc in enumerate(docs, start=1):
        label = f"[{i}/{len(docs)}] {doc['name']}"
        if not doc.get("storage_path"):
            # Nothing to re-read: the original bytes were never stored, so the
            # existing chunks are all that's left. Leave them rather than
            # deleting a student's only copy of that material.
            print(f"{label} — SKIP (no stored file)")
            skipped += 1
            continue
        try:
            data = bytearray()
            async for chunk in supabase.storage_download(doc["storage_path"]):
                data.extend(chunk)
            # `_process_inline` clears the document's old chunks before writing
            # new ones, so this is idempotent and safe to re-run after a
            # partial failure.
            result = await _process_inline(doc, bytes(data), doc.get("mime_type") or "")
            if result.get("status") == "ready":
                print(f"{label} — ok")
                ok += 1
            else:
                print(f"{label} — FAILED ({result.get('error') or result.get('status')})")
                failed += 1
        except Exception as e:  # noqa: BLE001 — one bad document must not stop the run
            print(f"{label} — FAILED ({type(e).__name__}: {e})")
            failed += 1

    print(f"\nDone. {ok} re-embedded, {skipped} skipped, {failed} failed.")
    if failed:
        print("Re-run the script to retry the failures — it is idempotent.")
    await supabase.close_client()
    await embeddings.close_client()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
