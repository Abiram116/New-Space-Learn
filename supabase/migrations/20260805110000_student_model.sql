-- Student Model: explicit preferences stored alongside the rest of a
-- user's settings. Computed signals (weak/strong areas, streak) are never
-- stored here — they're derived fresh from quiz_results/daily_activity on
-- every read, so they can't go stale.
alter table public.user_settings
  add column if not exists student_model jsonb not null default '{}'::jsonb;
