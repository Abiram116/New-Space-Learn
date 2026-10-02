-- Product feedback: what students think of Space Learn itself.
--
-- Not `response_feedback` — that table is thumbs on individual AI answers and
-- feeds personalization. This is the feedback form (Settings › Feedback, and
-- the Feedback card on the landing page): a set of questions the two of us can
-- change without a deploy, and the answers people give.
--
-- Additive only: two new tables, no change to anything existing.

-- ── The questions ──────────────────────────────────────────────────────
create table if not exists public.feedback_questions (
  id         uuid primary key default gen_random_uuid(),
  position   integer not null default 0,
  prompt     text not null check (char_length(prompt) between 3 and 200),
  -- rating: 1-5 · scale: 0-10 · choice: pick one · multi: pick any
  -- short: one line · long: a paragraph
  kind       text not null check (kind in ('rating', 'scale', 'choice', 'multi', 'short', 'long')),
  -- The choices, for `choice` and `multi`; empty for the rest.
  options    jsonb not null default '[]'::jsonb,
  required   boolean not null default true,
  -- Retired rather than deleted, so old answers still have a question to belong to.
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists feedback_questions_position_idx
  on public.feedback_questions (position) where active;

-- ── The answers ────────────────────────────────────────────────────────
create table if not exists public.product_feedback (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- Null for a signed-out visitor. ON DELETE CASCADE: deleting an account
  -- deletes its feedback, which is what the privacy page promises.
  user_id       uuid references auth.users(id) on delete cascade,
  source        text not null check (source in ('landing', 'settings')),
  -- Only asked of signed-out visitors, only if they want a reply.
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  -- One entry per question: {question_id, prompt, kind, value}. The prompt is
  -- copied in so an answer still reads correctly after its question is edited
  -- or retired.
  answers       jsonb not null,
  page          text check (page is null or char_length(page) <= 300),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300)
);

create index if not exists product_feedback_created_idx
  on public.product_feedback (created_at desc);
create index if not exists product_feedback_user_idx
  on public.product_feedback (user_id) where user_id is not null;

-- Row-level security on, with no policies: the browser (anon or signed-in key)
-- can neither read nor write either table. Only the API, with the service key,
-- touches them — and only after its own admin and rate-limit checks.
alter table public.feedback_questions enable row level security;
alter table public.product_feedback enable row level security;

-- ── The starting questions ─────────────────────────────────────────────
-- Guided first, open last. Only seeded into an empty table, so re-running this
-- never duplicates them or undoes edits made from the admin screen.
insert into public.feedback_questions (position, prompt, kind, options)
select * from (values
  (10, 'How is Space Learn working for you overall?', 'rating', '[]'::jsonb),
  (20, 'What do you use it for most?', 'choice',
       '["Chatting with my material", "Notes", "Flashcards", "Quizzes", "Just exploring"]'::jsonb),
  (30, 'Which part did you really like?', 'multi',
       '["Answers with sources", "Notes from a chat", "Flashcards and review", "Quizzes", "The design", "How fast it is"]'::jsonb),
  (40, 'What could have been better?', 'multi',
       '["Answer quality", "Speed", "Uploading files", "Finding my way around", "The phone experience", "Nothing, it was good"]'::jsonb),
  (50, 'Did anything not work?', 'choice',
       '["No, everything worked", "Something small", "Something broke"]'::jsonb),
  (60, 'How likely are you to recommend Space Learn to a friend?', 'scale', '[]'::jsonb),
  (70, 'What is the one thing we should add or fix next?', 'short', '[]'::jsonb),
  (80, 'Anything else you want to tell us?', 'long', '[]'::jsonb)
) as seed(position, prompt, kind, options)
where not exists (select 1 from public.feedback_questions);
