-- Search returns each chunk's document name itself.
--
-- The API called `search_chunks` and then made a second round trip to
-- `documents` for the names to show beside each citation. On a free-tier
-- database a round trip is ~150-250 ms, on every chat message. The join is
-- free by comparison.
--
-- The return type changes, so the function is dropped and recreated (a
-- `create or replace` cannot change what a function returns). Safe to run
-- more than once. RUN THIS BEFORE DEPLOYING THE CODE THAT GOES WITH IT.

drop function if exists public.search_chunks(vector, text, uuid[], int);

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
  document_name text,
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
    d.name as document_name,
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
  join public.documents d on d.id = c.document_id
  cross join q;
$$;

revoke all on function public.search_chunks(vector, text, uuid[], int) from public;
grant execute on function public.search_chunks(vector, text, uuid[], int) to service_role;
