-- Migrate document_chunks.embedding from vector(1536) to vector(384).
--
-- Enables BGE-small-en-v1.5 (quantized ONNX, local, $0 marginal cost) as the
-- production embedding model, replacing the OpenAI-dependent design. See
-- docs/adr/0012-local-embeddings-bge-small.md for the full investigation —
-- including why BGE-M3 (1024 dims, ~2.2GB model) was rejected for
-- production and kept only as an offline quality benchmark.
--
-- SAFE TO RUN: `document_chunks` has zero rows in the live database as of
-- 2026-08-10 (confirmed via a direct query before writing this migration —
-- the one uploaded document never finished processing). There is no real
-- embedding data to lose or reinterpret.
--
-- IF THAT'S NO LONGER TRUE WHEN YOU RUN THIS, STOP. A populated
-- vector(1536) column cannot be reinterpreted as vector(384) — the two
-- don't share a coordinate space, so this would need every existing row
-- re-embedded, not just retyped. Check `select count(*) from
-- document_chunks` first if any real uploads have happened since.
--
-- HOW TO APPLY: from the repo root, `npm run db:push` (Supabase CLI, pinned
-- as a dev dependency). Run `npm run db:list` first and read docs/setup.md —
-- migrations applied by hand in the SQL Editor are invisible to the CLI and
-- need `supabase migration repair` before a push will do the right thing.
--
-- After it succeeds:
--   1. Set USE_STUB_EMBEDDINGS=false in .env / the Render dashboard.
--   2. From api/: uv run python scripts/reembed_documents.py
--      (re-embeds anything that exists; safe to run even if nothing does).

-- The ivfflat index is built against the column's vector dimension — it
-- must be dropped before the column type changes, or the ALTER fails.
drop index if exists public.document_chunks_embedding_idx;

alter table public.document_chunks
  alter column embedding type vector(384);

-- Same index, same reasoning as the original migration's own comment:
-- ivfflat needs a few thousand rows before it beats a sequential scan, but
-- costs nothing to have in place ahead of that.
create index if not exists document_chunks_embedding_idx
  on public.document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- A function's parameter types are part of its identity in Postgres —
-- changing one requires drop + recreate, not `create or replace` (which
-- only allows changing the body of an existing signature).
drop function if exists public.match_document_chunks(vector, uuid, int);

create or replace function public.match_document_chunks(
  query_embedding vector(384),
  match_subspace uuid,
  match_count int default 5
) returns table (
  id uuid,
  document_id uuid,
  content text,
  locator text,
  similarity real
)
language sql
stable
security invoker
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.locator,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.subspace_id = match_subspace
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_document_chunks(vector, uuid, int)
  to anon, authenticated, service_role;
