-- Hybrid search: meaning and keywords, one round trip.
--
-- Retrieval used one vector search. That finds text that *means* the same as
-- the question and misses text that *says* the same thing: a name, an
-- acronym, a number, "RFC 6298", "3NF". This adds PostgreSQL full-text
-- search beside it.
--
-- 1. `document_chunks.fts` — a generated column, so it fills itself for every
--    existing row when this runs and for every new chunk after: no
--    re-processing of documents. The section heading is weighted above the
--    body, so a question naming a section finds that section.
--
-- 2. `search_chunks(...)` — returns CANDIDATES: the closest chunks by meaning
--    and the best by keyword, across a topic and the topics linked to it,
--    each with both of its ranks. It deliberately does not merge the two
--    lists or decide what is relevant: that is the application's job
--    (api/app/services/retrieval.py), where the weights and cut-offs are
--    configuration that the benchmark tunes, not SQL that needs a migration
--    to change.
--
--    The keyword side matches a chunk containing ANY of the question's words
--    and ranks by how many, and how prominent, they are. (The usual
--    `websearch_to_tsquery` demands ALL of them, which a natural-language
--    question almost never gets from one passage.)
--
--    `keyword_coverage` is how much of the question's wording the chunk
--    contains, 0–1, with each word weighted by how rare it is in the topic:
--    a word found in every chunk counts for almost nothing, and a word found
--    nowhere in the topic ("mitosis", asked of notes on photosynthesis)
--    counts the most and can never be matched. It is one of the signals used
--    to decide whether the documents cover the question at all.
--
-- Additive: a new column, a new index, a new function. `match_document_chunks`
-- is left in place for anything still calling it. Safe to run more than once.
-- The table is rewritten once to fill the column — a moment at this size.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT GOES WITH IT.

alter table public.document_chunks
  add column if not exists fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(section, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored;

create index if not exists document_chunks_fts_idx
  on public.document_chunks using gin (fts);

create or replace function public.search_chunks(
  query_embedding vector(384),
  query_text text,
  subspaces uuid[],
  candidate_count int default 20
) returns table (
  id uuid,
  document_id uuid,
  subspace_id uuid,
  chunk_index int,
  content text,
  locator text,
  section text,
  page_start int,
  page_end int,
  similarity real,
  vector_rank int,
  keyword_rank int,
  keyword_coverage real
)
language sql
stable
security invoker
as $$
  with q as (
    select
      -- any of the words, not all of them
      nullif(replace(plainto_tsquery('english', query_text)::text, '&', '|'), '')::tsquery as any_word,
      tsvector_to_array(to_tsvector('english', query_text)) as words
  ),
  -- How rare each of the question's words is across the searched topics.
  word_weight as materialized (
    select w.word,
           ln(1 + (n.chunks - w.found + 0.5) / (w.found + 0.5))::real as weight
    from (
      select word,
             (select count(*) from public.document_chunks c
               where c.subspace_id = any(subspaces) and c.fts @@ quote_literal(word)::tsquery)::real as found
      from q, unnest(q.words) as word
    ) w,
    (select count(*)::real as chunks from public.document_chunks c where c.subspace_id = any(subspaces)) n
  ),
  by_meaning as (
    select c.id,
           (1 - (c.embedding <=> query_embedding))::real as similarity,
           row_number() over (order by c.embedding <=> query_embedding)::int as rank
    from public.document_chunks c
    where c.subspace_id = any(subspaces)
    order by c.embedding <=> query_embedding
    limit candidate_count
  ),
  by_keyword as (
    select c.id,
           row_number() over (order by ts_rank(c.fts, q.any_word, 1) desc, c.id)::int as rank
    from public.document_chunks c, q
    where c.subspace_id = any(subspaces)
      and q.any_word is not null
      and c.fts @@ q.any_word
    order by ts_rank(c.fts, q.any_word, 1) desc, c.id
    limit candidate_count
  )
  select
    c.id, c.document_id, c.subspace_id, c.chunk_index, c.content, c.locator,
    c.section, c.page_start, c.page_end,
    coalesce(m.similarity, (1 - (c.embedding <=> query_embedding))::real) as similarity,
    m.rank as vector_rank,
    k.rank as keyword_rank,
    coalesce((
      select sum(ww.weight) filter (where ww.word = any(tsvector_to_array(c.fts))) / nullif(sum(ww.weight), 0)
      from word_weight ww
    ), 0)::real as keyword_coverage
  from by_meaning m
  full outer join by_keyword k using (id)
  join public.document_chunks c on c.id = coalesce(m.id, k.id)
  cross join q;
$$;

-- The API calls this with the service key, after its own ownership checks.
-- Nothing in the browser needs it, so nothing in the browser may call it.
revoke all on function public.search_chunks(vector, text, uuid[], int) from public;
grant execute on function public.search_chunks(vector, text, uuid[], int) to service_role;
