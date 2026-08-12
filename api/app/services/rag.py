"""Retrieval + prompt construction.

Two responsibilities kept intentionally small so they're easy to test:
1. Given a user question + subspace, fetch the top-k similar chunks.
2. Build the system + user messages the LLM sees, plus the citations metadata
   the frontend needs to render inline markers and source cards.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from . import guardrails, supabase
from .embeddings import embed_texts
from .voice import COMPANION_VOICE, DIAGRAM_RULE, RESPONSE_SHAPE


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
    images: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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

    # Chat is the surface a student spends the most time in, so it draws on
    # the same shared voice as the agents rather than defining its own — the
    # "sounds like one mentor everywhere" property has to be structural.
    #
    # Four rules below, each stated exactly once, in the order a model needs
    # them: who it's talking to, how to write, how to cite, how to behave
    # when the sources run out. Standard grounded-RAG practice is to put the
    # citation *format* and the *refuse-rather-than-guess* instruction next
    # to each other, since together they're the one thing this product's
    # honesty claim actually depends on — split apart or vague, a model
    # reliably drifts toward answering from general knowledge without saying
    # so.
    # Voice, then shape, then when to draw. All three are *style*, and they
    # sit before the Skill on purpose: "prose only, no lists" is a legitimate
    # teaching preference and should be able to win against any of them. Only
    # the integrity and safety blocks at the end are non-negotiable.
    system_parts = [
        COMPANION_VOICE,
        f"You are working with the student on the topic '{subspace_name}'.",
        RESPONSE_SHAPE,
        DIAGRAM_RULE,
    ]
    # Only when there is actually an image. Explaining how to read attachments
    # on every text-only turn is tokens spent on a situation that is not
    # happening, on every message, forever.
    if images:
        system_parts.append(guardrails.IMAGE_RULES)
    if always_show_citations and retrieved:
        system_parts.append(
            "Every factual claim that comes from a source must end with that "
            "source's marker, written [[n]] with no space, where n is the number "
            "in the Sources list below — not a footnote, inline at the point of "
            "the claim. A sentence combining two sources gets two markers. Never "
            "invent a marker number that isn't in the list."
        )
    if answer_only_from_docs:
        if retrieved:
            system_parts.append(
                "Answer only using the Sources below — not outside knowledge, even if "
                "you're confident it's correct. If the sources only partly cover the "
                "question, answer the part they cover and say plainly what's missing, "
                "rather than filling the gap yourself."
            )
        else:
            system_parts.append(
                "No sources were retrieved for this question. Say plainly that nothing "
                "indexed in this topic covers it yet — do not answer from outside "
                "knowledge instead."
            )
    # ── Skill, then student, then the rules that outrank both ─────────
    #
    # Order is the whole mechanism here. `for_skill`'s docstring records that
    # "a model reads the last constraint as the most specific" — and this
    # assembly used to end on user-authored Skill text, which put 4000
    # characters of free input in the most authoritative position in the
    # prompt, after the product's own honesty rules.
    #
    # That is not primarily a malicious-user problem (a Skill only affects its
    # own account, and `is_library` is not settable through the API). It is a
    # careless-Skill problem: "always cite a source" written as a teaching
    # style, sitting after "only cite the sources you were given", is how a
    # tutor starts inventing citations while looking like it is working.
    #
    # So Skills go in the middle, framed as style rather than authority, and
    # the invariants go last where the same reasoning now works for us.
    for extra in active_skill_instructions:
        framed = guardrails.frame_skill(extra)
        if framed:
            system_parts.append(framed)
    if student_context:
        system_parts.append(student_context)

    system_parts.append(
        guardrails.integrity_rules(
            grounded=bool(retrieved), cite=always_show_citations
        )
    )
    system_parts.append(guardrails.SAFETY_RULES)

    messages: list[dict[str, str]] = [{"role": "system", "content": "\n\n".join(system_parts)}]
    if sources_block:
        messages.append({"role": "system", "content": sources_block})
    # Keep the last N turns of history so context doesn't balloon.
    messages.extend(history[-8:])

    # The question and its attachments are ONE user turn.
    #
    # Sent as the OpenAI-style content array the vision models expect, and only
    # when images exist — a plain string is what every text model wants, and
    # wrapping every message in an array "for consistency" would change the
    # shape of a request that has nothing to do with images.
    if images:
        content: list[dict[str, Any]] = [{"type": "text", "text": question}]
        content.extend(
            {"type": "image_url", "image_url": {"url": url}} for url in images
        )
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": question})
    return messages, citations_meta


def snippet(text: str, *, limit: int = 90) -> str:
    """Public: notes cite the same way chat does, so they truncate the same
    way too. Duplicating this would let the two drift into showing different
    previews of the same chunk."""
    return _snippet(text, limit=limit)


def _snippet(text: str, *, limit: int = 90) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


_CITATION_MARKER = re.compile(r"\[\[(\d+)\]\]")


def strip_invalid_citations(text: str, valid_count: int) -> tuple[str, list[int]]:
    """Remove `[[n]]` markers that don't point at a real source.

    `build_prompt` instructs the model to cite only the numbered sources it was
    given, but an instruction is not a guarantee — a model can emit `[[7]]`
    when four sources were provided. Product Principle 3 ("every claim is
    traceable") is load-bearing for this product, so a marker that resolves to
    nothing is worse than no marker at all: it renders as a citation the
    student can't click, which reads as a broken promise rather than a missing
    one.

    Returns the cleaned text and the sorted list of markers that were dropped,
    so the caller can log how often this actually happens.

    Runs after the stream completes, over text already fully in memory — it
    adds nothing to time-to-first-token.
    """

    dropped: set[int] = set()

    def _replace(match: re.Match[str]) -> str:
        n = int(match.group(1))
        if 1 <= n <= valid_count:
            return match.group(0)
        dropped.add(n)
        return ""

    cleaned = _CITATION_MARKER.sub(_replace, text)
    if dropped:
        # Removing a marker mid-sentence can leave " ." or a double space.
        cleaned = re.sub(r" +([.,;:!?])", r"\1", cleaned)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        cleaned = re.sub(r" +\n", "\n", cleaned)
    return cleaned.strip(), sorted(dropped)


def cited_markers(text: str) -> list[int]:
    """Every `[[n]]` actually present in the final answer, for the audit log
    — lets a log line show which retrieved sources the model actually used
    versus which it was merely given."""

    return [int(n) for n in _CITATION_MARKER.findall(text)]
