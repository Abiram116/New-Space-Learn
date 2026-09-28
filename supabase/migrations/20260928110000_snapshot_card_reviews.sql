-- Teach `student_snapshot` about `card_reviews` (20260928100000_fsrs.sql),
-- and make every aggregate's ordering explicit rather than incidental.
--
-- Bayesian mastery (`student_model.py`) needs one more input than the
-- twelve-select version did: per-review grades, so a topic drilled hard
-- with flashcards but never quizzed still gets real evidence behind its
-- score instead of sitting at the uninformative 50%. `subspace_id, grade,
-- reviewed_at` is all it reads — see `CARD_REVIEW_OUTCOME` there for what
-- each grade (1-4, Again/Hard/Good/Easy per `fsrs.GRADE_NUMBER`) is worth.
--
-- The other aggregates previously had no `order by` inside their
-- `jsonb_agg` — harmless for them (nothing downstream depends on their
-- order), but this function exists specifically because "same window, same
-- ordering, same projection as the Python fallback" is the contract that
-- keeps the two from quietly drifting apart. So every one of them gets an
-- explicit order now, even where it changes nothing today.
--
-- HOW TO APPLY: `npm run db:push` from the repo root.
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
      (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.id)
         from subjects s where s.user_id = p_user_id),
      '[]'::jsonb
    ),

    'subspaces', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', ss.id, 'subject_id', ss.subject_id, 'name', ss.name,
                'last_activity_at', ss.last_activity_at) order by ss.id)
         from subspaces ss where ss.user_id = p_user_id),
      '[]'::jsonb
    ),

    -- limit 200, submitted_at desc
    'quiz_results', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'score', r.score, 'submitted_at', r.submitted_at,
                'quiz_id', r.quiz_id, 'answers', r.answers)
                order by r.submitted_at desc nulls last)
         from (select * from quiz_results
                where user_id = p_user_id
                order by submitted_at desc nulls last
                limit 200) r),
      '[]'::jsonb
    ),

    -- QUIZ_WINDOW = 60, created_at desc
    'quizzes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', q.id, 'subspace_id', q.subspace_id, 'questions', q.questions)
                order by q.created_at desc nulls last)
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
                'study_seconds', a.study_seconds) order by a.day desc)
         from (select * from daily_activity
                where user_id = p_user_id
                order by day desc
                limit 200) a),
      '[]'::jsonb
    ),

    'decks', coalesce(
      (select jsonb_agg(jsonb_build_object('id', d.id, 'subspace_id', d.subspace_id) order by d.id)
         from decks d where d.user_id = p_user_id),
      '[]'::jsonb
    ),

    'flashcards', coalesce(
      (select jsonb_agg(jsonb_build_object('deck_id', f.deck_id, 'due_at', f.due_at) order by f.id)
         from flashcards f where f.user_id = p_user_id),
      '[]'::jsonb
    ),

    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object('subspace_id', n.subspace_id) order by n.id)
         from notes n where n.user_id = p_user_id),
      '[]'::jsonb
    ),

    'documents', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'subspace_id', dc.subspace_id, 'status', dc.status) order by dc.id)
         from documents dc where dc.user_id = p_user_id),
      '[]'::jsonb
    ),

    -- FEEDBACK_WINDOW = 300, created_at desc
    'response_feedback', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'kind', fb.kind, 'concept', fb.concept, 'created_at', fb.created_at)
                order by fb.created_at desc nulls last)
         from (select * from response_feedback
                where user_id = p_user_id
                order by created_at desc nulls last
                limit 300) fb),
      '[]'::jsonb
    ),

    -- MESSAGE_WINDOW = 80, created_at desc, role = 'user'
    'chat_messages', coalesce(
      (select jsonb_agg(jsonb_build_object('content', m.content) order by m.created_at desc nulls last)
         from (select * from chat_messages
                where user_id = p_user_id and role = 'user'
                order by created_at desc nulls last
                limit 80) m),
      '[]'::jsonb
    ),

    -- CARD_REVIEW_WINDOW = 500, reviewed_at desc. subspace_id, grade,
    -- reviewed_at only — see `student_model.CARD_REVIEW_OUTCOME`.
    'card_reviews', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'subspace_id', cr.subspace_id, 'grade', cr.grade, 'reviewed_at', cr.reviewed_at)
                order by cr.reviewed_at desc nulls last)
         from (select * from card_reviews
                where user_id = p_user_id
                order by reviewed_at desc nulls last
                limit 500) cr),
      '[]'::jsonb
    )
  );
$$;

comment on function public.student_snapshot(uuid) is
  'Every read the student model needs, in one round trip, including '
  'card_reviews for Bayesian mastery. Replaces thirteen concurrent REST '
  'selects that cost several hundred ms of TLS handshakes regardless of how '
  'they were scheduled.';
