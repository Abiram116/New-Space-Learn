-- Feedback questions: a choice can ask "tell us more".
--
-- For a pick-one or pick-any question, `detail_options` names the choices that
-- open a small text box when picked — "Something broke" → what broke? What is
-- typed there is stored with the answer, as `detail`, inside
-- `product_feedback.answers` (no change to that table).
--
-- Additive: one new column with a default. Safe to run more than once.

alter table public.feedback_questions
  add column if not exists detail_options jsonb not null default '[]'::jsonb;

-- The starting question that needs it. Only touched while it still has its
-- original choices and nothing has been set from the admin page.
update public.feedback_questions
   set detail_options = '["Something small", "Something broke"]'::jsonb
 where prompt = 'Did anything not work?'
   and detail_options = '[]'::jsonb
   and options @> '["Something small", "Something broke"]'::jsonb;
