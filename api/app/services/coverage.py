"""Which parts of a topic's documents a new quiz (or deck) should be written from.

Generators used to search for their topic name — or, for a quiz with no topic,
the literal words "core concepts" — and get the same six chunks every time.
Three quizzes on a 40-page PDF tested the same few pages three times.

This decides in code, with no model call:

- **A topic was typed:** the chunks that best match it (the hybrid search).
- **No topic:** chunks spread across the whole topic — one per section,
  least-used sections first, taking turns between documents — plus up to two
  chunks on concepts the student keeps getting wrong.

"Least used" comes from what earlier quizzes were written from: each question
records its source chunk (`QuizQuestion.source_chunk`), so the ledger of what
has been covered is read back from the quizzes themselves. No table to keep in
step with them.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, replace

from . import retrieval, supabase

#: Sources per generation: a couple more than the questions asked for, so a
#: question that fails its check can be replaced from fresh material.
MAX_SOURCES = 8
MIN_SOURCES = 3
#: The most text handed to the model across all sources.
BUDGET_CHARS = 6500
#: Earlier quizzes read for the ledger.
LEDGER_QUIZZES = 30
#: A topic bigger than this is sampled from its first chunks only.
MAX_CHUNK_ROWS = 3000
#: Weak concepts given a source of their own in a no-topic quiz.
WEAK_CONCEPTS = 2


@dataclass(frozen=True, slots=True)
class Source:
    #: 1-based, as the model sees it.
    number: int
    chunk_id: str
    document_name: str
    locator: str
    content: str

    @property
    def label(self) -> str:
        """How the student sees where a question came from."""
        return f"{self.document_name} · {self.locator}" if self.locator else self.document_name


@dataclass(frozen=True, slots=True)
class _Row:
    id: str
    document_id: str
    chunk_index: int
    section: str | None


def want_sources(questions: int) -> int:
    return max(MIN_SOURCES, min(MAX_SOURCES, questions + 2))


def spread(rows: Sequence[_Row], used: Counter[str], k: int) -> list[str]:
    """`k` chunk ids across the topic: one per section, the least-used
    sections first, documents taking turns. Pure, so it can be tested alone.

    A document with no headings has no sections; runs of four chunks stand in
    for them, so it still gets spread rather than read from the top."""
    groups: dict[tuple[str, str], list[_Row]] = {}
    for r in rows:
        key = (r.document_id, r.section or f"#{r.chunk_index // 4}")
        groups.setdefault(key, []).append(r)

    # Each document's sections, least used first, then in reading order.
    by_doc: dict[str, list[list[_Row]]] = {}
    for (doc, _), members in groups.items():
        by_doc.setdefault(doc, []).append(sorted(members, key=lambda r: r.chunk_index))
    for sections in by_doc.values():
        sections.sort(key=lambda m: (sum(used[r.id] for r in m), m[0].chunk_index))

    # Least-covered documents start the rotation.
    docs = sorted(by_doc, key=lambda d: (sum(used[r.id] for m in by_doc[d] for r in m), d))
    picked: list[str] = []
    turn = 0
    while len(picked) < k and any(by_doc[d] for d in docs):
        doc = docs[turn % len(docs)]
        turn += 1
        if not by_doc[doc]:
            continue
        section = by_doc[doc].pop(0)
        # Within a section, the least-used chunk; among equals, the middle one
        # (a section's first chunk is often only its heading's run-up).
        best = min(section, key=lambda r: (used[r.id], abs(r.chunk_index - section[len(section) // 2].chunk_index)))
        picked.append(best.id)
    return picked


async def ledger(user_id: str, subspace_id: str) -> tuple[Counter[str], list[dict]]:
    """How often each chunk has been quizzed on, and the earlier questions
    themselves (newest first), from this topic's recent quizzes."""
    rows = await supabase.db_select(
        "quizzes",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        select="questions",
        order="created_at.desc",
        limit=LEDGER_QUIZZES,
    )
    used: Counter[str] = Counter()
    earlier: list[dict] = []
    for row in rows:
        for q in row.get("questions") or []:
            if isinstance(q, dict):
                earlier.append(q)
                if q.get("source_chunk"):
                    used[str(q["source_chunk"])] += 1
    return used, earlier


async def plan(
    *,
    subspace_id: str,
    linked_subspace_ids: Sequence[str],
    topic: str | None,
    questions: int,
    used: Counter[str],
    weak_concepts: Sequence[str] = (),
) -> list[Source]:
    """The numbered sources to write from. Empty when the topic has no
    indexed material (the caller then works from the conversation alone)."""
    k = want_sources(questions)
    subspaces = [subspace_id, *linked_subspace_ids]
    if topic and topic.strip():
        found = await retrieval.retrieve(
            topic,
            subspace_id=subspace_id,
            linked_subspace_ids=linked_subspace_ids,
            config=replace(retrieval.GENERATION, max_chunks=k, budget_chars=BUDGET_CHARS),
        )
        return _number([(c.id, c.document_name, c.locator, c.content) for c in found.chunks])

    chosen: list[str] = []
    for concept in list(weak_concepts)[:WEAK_CONCEPTS]:
        found = await retrieval.retrieve(
            concept,
            subspace_id=subspace_id,
            linked_subspace_ids=linked_subspace_ids,
            config=replace(retrieval.GENERATION, max_chunks=1),
        )
        chosen += [c.id for c in found.chunks if c.id not in chosen]

    rows = await supabase.db_select(
        "document_chunks",
        filters={"subspace_id": f"in.({','.join(subspaces)})"},
        select="id,document_id,chunk_index,section",
        order="document_id.asc,chunk_index.asc",
        limit=MAX_CHUNK_ROWS,
    )
    pool = [
        _Row(str(r["id"]), str(r["document_id"]), int(r["chunk_index"]), r.get("section"))
        for r in rows
        if str(r["id"]) not in chosen
    ]
    chosen += spread(pool, used, k - len(chosen))
    if not chosen:
        return []
    return await _load(chosen)


async def _load(ids: list[str]) -> list[Source]:
    rows = await supabase.db_select(
        "document_chunks",
        filters={"id": f"in.({','.join(ids)})"},
        select="id,document_id,content,locator",
    )
    by_id = {str(r["id"]): r for r in rows}
    doc_ids = sorted({str(r["document_id"]) for r in rows})
    names: dict[str, str] = {}
    if doc_ids:
        docs = await supabase.db_select("documents", filters={"id": f"in.({','.join(doc_ids)})"}, select="id,name")
        names = {str(d["id"]): d["name"] for d in docs}
    return _number(
        [
            (i, names.get(str(by_id[i]["document_id"]), "source"), by_id[i].get("locator") or "", by_id[i]["content"])
            for i in ids
            if i in by_id
        ]
    )


def _number(items: list[tuple[str, str, str, str]]) -> list[Source]:
    """Numbered sources within the size budget; the first is always kept."""
    out: list[Source] = []
    used = 0
    for chunk_id, name, locator, content in items:
        if out and used + len(content) > BUDGET_CHARS:
            break
        out.append(Source(len(out) + 1, chunk_id, name, locator, content))
        used += len(content)
    return out
