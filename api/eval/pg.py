"""A real Postgres for the benchmark, on this machine.

Keyword search is only as good as PostgreSQL's own tokenizer and ranking, and
an imitation of those in Python would measure the imitation. So the benchmark
starts a throwaway PostgreSQL (with pgvector) from the `pgserver` package,
runs the project's real hybrid-search migration on it, and searches through
the same `search_chunks` function production calls. Nothing remote is touched.

Needs the `eval` extra: `uv sync --extra eval` (or `uv pip install pgserver
"psycopg[binary]"`).
"""

from __future__ import annotations

import atexit
import tempfile
import uuid
from collections.abc import Sequence
from pathlib import Path

from app.services.retrieval import Candidate, candidate_from_row

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
#: The migrations that define search. Applied in order, exactly as written.
SEARCH_MIGRATIONS = ("20261002160000_hybrid_search.sql",)

_NAMESPACE = uuid.UUID("5a5a5a5a-0000-4000-8000-5a5a5a5a5a5a")

# The part of the real schema that search touches (init + chunk_structure
# migrations), without the auth and RLS around it.
_SCHEMA = """
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;
create extension if not exists vector;
drop table if exists public.document_chunks cascade;
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  subspace_id uuid not null,
  user_id uuid,
  chunk_index int not null,
  content text not null,
  locator text,
  embedding vector(384),
  page_start int,
  page_end int,
  section text
);
create index document_chunks_subspace_idx on public.document_chunks (subspace_id);
"""


def topic_id(topic: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"topic:{topic}"))


def document_id(name: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"doc:{name}"))


_server = None


def _connect():
    global _server
    import pgserver
    import psycopg

    if _server is None:
        _server = pgserver.get_server(tempfile.mkdtemp(prefix="spacelearn-eval-pg-"), cleanup_mode="delete")
        atexit.register(_server.cleanup)
    return psycopg.connect(_server.get_uri(), autocommit=True)


class PgStore:
    """`retrieval.Store`, backed by the local Postgres."""

    def __init__(self) -> None:
        self.con = _connect()
        self.con.execute(_SCHEMA)
        for name in SEARCH_MIGRATIONS:
            self.con.execute((MIGRATIONS / name).read_text(encoding="utf-8"))
        self.names: dict[str, str] = {}

    def load(self, rows: list[dict]) -> None:
        """`rows`: topic, document, index, content, locator, section, pages, vector."""
        with self.con.cursor() as cur:
            cur.executemany(
                "insert into public.document_chunks "
                "(document_id, subspace_id, chunk_index, content, locator, section, page_start, page_end, embedding) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        document_id(r["document"]), topic_id(r["topic"]), r["index"], r["content"], r["locator"],
                        r["section"], r["page_start"], r["page_end"], str(list(map(float, r["vector"]))),
                    )
                    for r in rows
                ],
            )
        self.names = {document_id(r["document"]): r["document"] for r in rows}
        self.con.execute("analyze public.document_chunks")

    async def search(
        self, *, embedding: list[float], text: str, subspaces: Sequence[str], limit: int
    ) -> list[Candidate]:
        cur = self.con.execute(
            "select * from public.search_chunks(%s::vector, %s, %s::uuid[], %s)",
            (str(list(map(float, embedding))), text, list(subspaces), limit),
        )
        columns = [d.name for d in cur.description]
        out = []
        for values in cur.fetchall():
            c = candidate_from_row(dict(zip(columns, values, strict=True)))
            c.document_name = self.names.get(c.document_id, "source")
            out.append(c)
        return out
