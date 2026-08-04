-- RPC used by the backend for pgvector similarity search.
-- Called via PostgREST as `POST /rest/v1/rpc/match_document_chunks`.

create or replace function public.match_document_chunks(
  query_embedding vector(1536),
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

-- Seed a few useful library skills so the /skills library isn't empty.
-- The user_id points at a synthetic library-owner uuid we never sign in as;
-- RLS lets everyone read rows with is_library=true anyway.
insert into public.skills (id, user_id, name, icon, tone, description, instructions, is_library)
values
  (
    '00000000-0000-0000-0000-00000000a001',
    null,
    'Socratic Tutor', '🧠', 'brand',
    'Never gives the answer first — asks guiding questions.',
    'You are a Socratic tutor. Ask one guiding question at a time. Never reveal the full answer until the learner has attempted it at least twice. When they''re close, confirm what''s right before nudging what''s missing.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a002',
    null,
    'Exam Cram', '🎯', 'mint',
    'Timed rapid-fire recall — one concept, one minute.',
    'Run a rapid-fire practice loop. Ask a compact question, wait for an answer, then give a one-line verdict and the next question. Prioritize breadth over depth.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a003',
    null,
    'Cite Everything', '✍️', 'sun',
    'Answers only from indexed docs, always with page refs.',
    'Answer only using the provided sources. Cite each claim with the [[n]] marker for the matching source. If the sources don''t cover a question, say so.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a004',
    null,
    'Paper Explainer', '📄', 'sky',
    'Summarize + critique research papers section by section.',
    'When given a paper, walk the reader through it in this order: (1) problem, (2) approach, (3) key result, (4) limitations, (5) one open question worth chasing.',
    true
  )
on conflict (id) do nothing;
