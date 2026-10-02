-- Indexes for reads that filter by user.
--
-- The first indexes were all by topic (`subspace_id`), which matched the app
-- when every list lived inside one topic. Notes, Cards and Quizzes are
-- account-wide pages now, and `student_snapshot` (run for chat, quizzes and
-- the Home brief) reads each of these tables by `user_id`. Without an index on
-- that column Postgres scans the whole table — every user's rows — to find
-- one user's, and gets slower for everyone as the app grows.
--
-- Additive and safe to re-run: `if not exists`, no data changes. On tables
-- this size they build in well under a second.

-- Global Notes page; snapshot's per-topic note counts.
create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

-- Global Cards page; snapshot's deck → topic map.
create index if not exists decks_user_idx
  on public.decks (user_id);

-- Due counts and due sessions (`user_id` + `due_at <= now`); snapshot's cards.
create index if not exists flashcards_user_due_idx
  on public.flashcards (user_id, due_at);

-- Global Quizzes page; snapshot's most recent quizzes.
create index if not exists quizzes_user_created_idx
  on public.quizzes (user_id, created_at desc);

-- Best scores and averages (newest first); snapshot's recent results.
create index if not exists quiz_results_user_submitted_idx
  on public.quiz_results (user_id, submitted_at desc);
-- "This quiz's attempts" (personal best on the results screen).
create index if not exists quiz_results_quiz_idx
  on public.quiz_results (quiz_id);

-- File cleanup when a topic, subject or account is deleted; material counts.
create index if not exists documents_user_idx
  on public.documents (user_id);

-- Snapshot's "recent messages the student wrote" (role = 'user', newest first).
create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);
