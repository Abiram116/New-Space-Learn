"""The follow-up rewrites the benchmark has already paid for.

The resolver asks a model to rewrite a follow-up. In a benchmark that must be
free to re-run and give the same answer twice, so each rewrite is kept on disk
by its prompt (committed, in `rewrites.json`) and the model is only asked for a
prompt it has never seen.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

from app.services import query_resolver

_PATH = Path(__file__).resolve().parent / "rewrites.json"
_store: dict[str, str] = json.loads(_PATH.read_text()) if _PATH.exists() else {}

# A first-time rewrite waits on a free-tier model; the product's own short
# timeout would turn every one of them into the fallback.
query_resolver.TIMEOUT_S = 90.0


async def complete(prompt: str) -> str:
    key = hashlib.sha1(prompt.encode()).hexdigest()
    if key not in _store:
        for attempt in range(4):
            try:
                _store[key] = (await query_resolver._ask_model(prompt)).strip()  # noqa: SLF001
                break
            except Exception:
                if attempt == 3:
                    raise
                await asyncio.sleep(8 * (attempt + 1))
        _PATH.write_text(json.dumps(_store, indent=1, ensure_ascii=False, sort_keys=True))
        await asyncio.sleep(1.5)
    return _store[key]
