"""Recent chat history, shared by chat itself and every generation agent.

Agents launched from chat (cards/quiz/notes) should already know what was
just discussed rather than asking the frontend to summarize it — this is
the one place that fetch lives so it isn't reimplemented per-router.
"""

from __future__ import annotations

from . import supabase


async def recent_history(
    user_id: str, subspace_id: str, *, limit: int = 8
) -> list[dict[str, str]]:
    rows = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
        limit=limit,
    )
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def format_history(history: list[dict[str, str]]) -> str:
    if not history:
        return ""
    lines = [f"{h['role']}: {h['content']}" for h in history]
    return "\n".join(lines)
