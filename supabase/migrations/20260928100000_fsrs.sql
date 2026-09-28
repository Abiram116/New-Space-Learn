-- Flashcards: FSRS-5 scheduling, replacing SM-2-lite.
--
-- `ease`/`interval_days`/`reps` stay — `interval_days` and `reps` are kept
-- updated by the new grader (still the fields "N cards due" counts read),
-- and `ease` is left as whatever SM-2-lite last wrote, untouched, since
-- nothing computes with it anymore. Four new columns carry the FSRS state
-- proper: `stability` and `difficulty` are the DSR model's own two numbers,
-- `last_review_at` is what FSRS needs to turn "now" into an elapsed-days
-- input, and `lapses` is a plain review-history counter FSRS itself doesn't
-- use but the stats surface will want.
--
-- Existing reviewed cards (reps > 0) are backfilled so they don't restart
-- cold: `stability` from their current interval (the day count they were
-- already trusted to hold), `difficulty` from their `ease` factor mapped
-- onto FSRS's [1, 10] scale (2.5 ease, the SM-2 default, lands on 5, the
-- middle), and `last_review_at` derived by walking `due_at` back by that
-- same interval. Never-reviewed cards (reps = 0) are left null — they get a
-- real FSRS init on their first grade instead of a guessed one.
alter table public.flashcards
  add column if not exists stability real,
  add column if not exists difficulty real,
  add column if not exists last_review_at timestamptz,
  add column if not exists lapses int not null default 0;

update public.flashcards
set
  stability = greatest(interval_days, 1),
  difficulty = least(10, greatest(1, 5 - (ease - 2.5) * (4 / 1.2))),
  last_review_at = due_at - (interval_days || ' days')::interval
where reps > 0;

-- Per-review log. Every grade writes one row here — the state a card was in
-- going into the review (elapsed_days, retrievability) and what it came out
-- as (stability_after) — for retention stats and future re-tuning, neither
-- of which `flashcards` alone (current state only) can answer.
create table if not exists public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  subspace_id uuid references public.subspaces(id) on delete cascade,
  grade smallint not null check (grade between 1 and 4),
  reviewed_at timestamptz not null default now(),
  elapsed_days real,
  retrievability real,
  stability_after real
);
create index if not exists card_reviews_user_reviewed_idx
  on public.card_reviews (user_id, reviewed_at desc);

alter table public.card_reviews enable row level security;
create policy "own card reviews" on public.card_reviews for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
