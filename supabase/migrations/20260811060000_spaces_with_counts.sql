-- One round trip for the sidebar.
--
-- `/spaces` is on the critical path of every single page — the rail, Home's
-- topic grid and the fallback-subspace lookup all read it — and it was the
-- slowest endpoint in the app at 1.4–2.4s warm. Not because any query was
-- slow, but because there were seven of them in series: subjects, subspaces,
-- then documents / notes / quizzes / decks / flashcards to build the per-topic
-- counts. Against a remote Supabase a warm round trip is ~250ms, so the
-- latency was almost entirely network, paid seven times.
--
-- Overlapping them was measured and is *worse* (see `_bulk_counts` in
-- app/routers/spaces.py): concurrency forces new TLS handshakes that cost more
-- than the serialisation saves. The only real fix is to ask once.
--
-- SECURITY INVOKER is deliberate. This runs as the caller, so it cannot be
-- used to read another user's rows even if `p_user_id` were spoofed — and the
-- explicit `user_id` predicates below mean it also behaves correctly under the
-- service role, which bypasses RLS.
create or replace function public.spaces_with_counts(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sub as (
    select
      ss.id,
      ss.subject_id,
      ss.name,
      ss.last_activity_at,
      (select count(*) from documents d
         where d.subspace_id = ss.id and d.user_id = p_user_id) as docs,
      (select count(*) from notes n
         where n.subspace_id = ss.id and n.user_id = p_user_id) as notes,
      (select count(*) from quizzes q
         where q.subspace_id = ss.id and q.user_id = p_user_id) as quizzes,
      (select count(*) from flashcards f
         join decks dk on dk.id = f.deck_id
        where dk.subspace_id = ss.id and f.user_id = p_user_id) as cards
    from subspaces ss
    where ss.user_id = p_user_id
    order by ss.created_at asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'tone', coalesce(s.tone, 'brand'),
        'pinned', coalesce(s.pinned, false),
        'subspaces', coalesce(
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'id', sub.id,
                       'subject_id', sub.subject_id,
                       'name', sub.name,
                       'last_activity_at', sub.last_activity_at,
                       'counts', jsonb_build_object(
                         'docs', sub.docs,
                         'notes', sub.notes,
                         'quizzes', sub.quizzes,
                         'cards', sub.cards
                       )
                     )
                   )
              from sub
             where sub.subject_id = s.id
          ),
          '[]'::jsonb
        )
      )
      -- Pinned first, then oldest-first. Ordered here rather than in the
      -- client so every consumer agrees: a pin that only the rail honoured
      -- would be a lie.
      order by s.pinned desc nulls last, s.created_at asc
    ),
    '[]'::jsonb
  )
  from subjects s
  where s.user_id = p_user_id;
$$;

comment on function public.spaces_with_counts(uuid) is
  'Subjects with their subspaces and per-subspace counts, in one round trip. '
  'Replaces seven serial REST calls on the app''s hottest endpoint.';
