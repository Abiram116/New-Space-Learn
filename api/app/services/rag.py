"""Retrieval + prompt construction.

Two responsibilities kept intentionally small so they're easy to test:
1. Given a user question + subspace, fetch the top-k similar chunks.
2. Build the system + user messages the LLM sees, plus the citations metadata
   the frontend needs to render inline markers and source cards.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import supabase
from .embeddings import embed_texts


@dataclass(slots=True)
class Retrieved:
    document_id: str
    document_name: str
    content: str
    locator: str
    similarity: float


async def retrieve(subspace_id: str, question: str, *, k: int = 4) -> list[Retrieved]:
    embeddings = await embed_texts([question])
    if not embeddings:
        return []
    rows = await supabase.db_rpc(
        "match_document_chunks",
        {
            "query_embedding": embeddings[0],
            "match_subspace": subspace_id,
            "match_count": k,
        },
    )
    if not isinstance(rows, list) or not rows:
        return []

    # Look up doc names in one query.
    doc_ids = list({r["document_id"] for r in rows if r.get("document_id")})
    name_map: dict[str, str] = {}
    if doc_ids:
        docs = await supabase.db_select(
            "documents",
            filters={"id": f"in.({','.join(doc_ids)})"},
            select="id,name",
        )
        name_map = {d["id"]: d["name"] for d in docs}

    return [
        Retrieved(
            document_id=r["document_id"],
            document_name=name_map.get(r["document_id"], "source"),
            content=r["content"],
            locator=r.get("locator") or "",
            similarity=float(r.get("similarity", 0.0)),
        )
        for r in rows
    ]


async def retrieve_with_links(
    subspace_id: str,
    question: str,
    linked_subspace_ids: list[str],
    *,
    k: int = 4,
    link_k: int = 2,
) -> list[Retrieved]:
    """The subspace actually being asked about, plus a smaller pull from
    explicitly linked subspaces (see Linked Subspaces in docs/v2-review.md).
    Always additive — a link only adds sources, never replaces the primary
    subspace's own material."""

    primary = await retrieve(subspace_id, question, k=k)
    if not linked_subspace_ids:
        return primary
    extra: list[Retrieved] = []
    for linked_id in linked_subspace_ids:
        extra.extend(await retrieve(linked_id, question, k=link_k))
    return primary + extra


def build_prompt(
    *,
    subspace_name: str,
    active_skill_instructions: list[str],
    history: list[dict[str, str]],
    question: str,
    retrieved: list[Retrieved],
    answer_only_from_docs: bool,
    always_show_citations: bool,
    student_context: str = "",
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Return (messages_for_llm, citations_metadata_for_frontend)."""

    citations_meta: list[dict[str, Any]] = []
    sources_block = ""
    if retrieved:
        lines = []
        for i, r in enumerate(retrieved, start=1):
            lines.append(f"[{i}] ({r.document_name} · {r.locator}) {r.content}")
            citations_meta.append(
                {
                    "marker": i,
                    "document_id": r.document_id,
                    "document_name": r.document_name,
                    "locator": r.locator,
                    "snippet": _snippet(r.content),
                }
            )
        sources_block = "Sources:\n" + "\n\n".join(lines)

    system_parts = [
        f"You are a study assistant for the topic '{subspace_name}'.",
        "Be direct, accurate, and concise. Prefer short paragraphs over long ones.",
    ]
    if always_show_citations and retrieved:
        system_parts.append(
            "When you use a fact from a source, cite it inline using [[n]] where n is "
            "the source number. Do not invent citations."
        )
    if answer_only_from_docs:
        if retrieved:
            system_parts.append(
                "Only answer using the provided sources. If they don't cover the question, "
                "say so plainly instead of guessing."
            )
        else:
            system_parts.append(
                "No sources were retrieved. Say that no relevant material was indexed yet."
            )
    for extra in active_skill_instructions:
        if extra.strip():
            system_parts.append(extra.strip())
    if student_context:
        system_parts.append(student_context)

    messages: list[dict[str, str]] = [{"role": "system", "content": "\n\n".join(system_parts)}]
    if sources_block:
        messages.append({"role": "system", "content": sources_block})
    # Keep the last N turns of history so context doesn't balloon.
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": question})
    return messages, citations_meta


def _snippet(text: str, *, limit: int = 90) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
