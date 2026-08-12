-- One round trip for the student model.
--
-- `snapshot()` is the read behind almost every intelligent thing the product
-- does: the brief, chat personalisation, note generation, quiz generation and
-- the feedback policy all start from it. It issued **twelve** selects.
--
-- They were already wrapped in `asyncio.gather`, and that is not the fix here.
-- This codebase measured it: against a remote Supabase, concurrent REST calls
-- are *slower* than serial ones, because each new connection pays a TLS
-- handshake that costs more than the overlap saves. Twelve round trips is
-- ~500ms of pure network no matter how they are arranged, which is why the
-- brief sat at 700-1000ms with a fast model doing the actual work in ~250ms.
--
-- So the twelve become one. Every window and column below mirrors the Python
-- exactly — same limits, same ordering, same projections — because the caller
-- folds these lists itself and a quietly different shape here would surface as
-- wrong study data rather than as an error.
--
-- SECURITY INVOKER: runs as the caller, so it cannot read another user's rows
-- even if `p_user_id` were spoofed. The explicit `user_id` predicates mean it
-- also behaves correctly under the service role, which bypasses RLS. The id
-- itself comes from a verified JWT, never from the request body.
create or replace function public.student_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'settings', coalesce(
      (select to_jsonb(us) from user_settings us
        where us.user_id = p_user_id limit 1),
      '{}'::jsonb
    ),

    'subjects', coalesce(
      (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name))
         from subjects s where s.user_id = p_user_id),
      '[]'::jsonb
    ),

    'subspaces', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', ss.id, 'subject_id', ss.subject_id, 'name', ss.name,
                'last_activity_at', ss.last_activity_at))
         from subspaces ss where ss.user_id = p_user_id),
      '[]'::jsonb
    ),

    -- limit 200, submitted_at desc
    'quiz_results', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'score', r.score, 'submitted_at', r.submitted_at,
                'quiz_id', r.quiz_id, 'answers', r.answers))
         from (select * from quiz_results
                where user_id = p_user_id
                order by submitted_at desc nulls last
                limit 200) r),
      '[]'::jsonb
    ),

    -- QUIZ_WINDOW = 60, created_at desc
    'quizzes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', q.id, 'subspace_id', q.subspace_id, 'questions', q.questions))
         from (select * from quizzes
                where user_id = p_user_id
                order by created_at desc nulls last
                limit 60) q),
      '[]'::jsonb
    ),

    -- limit 200, day desc
    'daily_activity', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day', a.day, 'chat_messages', a.chat_messages,
                'cards_reviewed', a.cards_reviewed, 'quizzes_taken', a.quizzes_taken,
                'study_seconds', a.study_seconds))
         from (select * from daily_activity
                where user_id = p_user_id
                order by day desc
                limit 200) a),
      '[]'::jsonb
    ),

    'decks', coalesce(
      (select jsonb_agg(jsonb_build_object('id', d.id, 'subspace_id', d.subspace_id))
         from decks d where d.user_id = p_user_id),
      '[]'::jsonb
    ),

    'flashcards', coalesce(
      (select jsonb_agg(jsonb_build_object('deck_id', f.deck_id, 'due_at', f.due_at))
         from flashcards f where f.user_id = p_user_id),
      '[]'::jsonb
    ),

    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object('subspace_id', n.subspace_id))
         from notes n where n.user_id = p_user_id),
      '[]'::jsonb
    ),

    'documents', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'subspace_id', dc.subspace_id, 'status', dc.status))
         from documents dc where dc.user_id = p_user_id),
      '[]'::jsonb
    ),

    -- FEEDBACK_WINDOW = 300, created_at desc
    'response_feedback', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'kind', fb.kind, 'concept', fb.concept, 'created_at', fb.created_at))
         from (select * from response_feedback
                where user_id = p_user_id
                order by created_at desc nulls last
                limit 300) fb),
      '[]'::jsonb
    ),

    -- MESSAGE_WINDOW = 80, created_at desc, role = 'user'
    'chat_messages', coalesce(
      (select jsonb_agg(jsonb_build_object('content', m.content))
         from (select * from chat_messages
                where user_id = p_user_id and role = 'user'
                order by created_at desc nulls last
                limit 80) m),
      '[]'::jsonb
    )
  );
$$;

comment on function public.student_snapshot(uuid) is
  'Every read the student model needs, in one round trip. Replaces twelve '
  'concurrent REST selects that cost ~500ms of TLS handshakes regardless of '
  'how they were scheduled.';
