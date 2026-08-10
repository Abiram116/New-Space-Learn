"""`/me` — everything scoped to the signed-in user.

Split out of a single 679-line module on 2026-08-10, before the Gap Map and
confusion-pair endpoints add to it. The split follows what the endpoints are
*for*, not their size:

- `account.py`  — who you are and how you want to be taught
- `stats.py`    — what you have done
- `brief.py`    — what you should do next

`_common.py` holds only the two helpers with more than one caller.

One `router` is exported so `main.py` keeps its single
`include_router(me.router)` line and no route path changes.
"""

from fastapi import APIRouter

from . import account, brief, stats

router = APIRouter()
router.include_router(account.router)
router.include_router(stats.router)
router.include_router(brief.router)

__all__ = ["router"]
