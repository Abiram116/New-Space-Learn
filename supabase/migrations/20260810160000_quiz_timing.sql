-- Quiz timing.
--
-- How long a quiz took is a real signal about mastery that the app was
-- throwing away: two students scoring 80% where one took four minutes and the
-- other twenty do not know the same amount, and the difference is exactly the
-- kind of thing a tutor notices. Nullable because every existing result
-- predates the timer and must not be back-filled with a guess.
alter table public.quiz_results
  add column if not exists duration_seconds int;
