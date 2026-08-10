-- Response feedback — the one input to the personalization engine that
-- genuinely cannot be recomputed.
--
-- Everything else the Student Model knows is derived from stored activity on
-- every read (see docs/decisions.md: concept mastery is joined at read time,
-- inferred preferences are derived rather than persisted). Feedback is the
-- exception: "that answer was too long" is an event, and an event that isn't
-- recorded is gone. That is what earns this table its existence.

create table if not exists public.response_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Nullable and ON DELETE SET NULL: deleting a topic must not delete the
  -- evidence about how this student likes to be taught. The preference
  -- outlives the material it was learned from.
  subspace_id uuid references public.subspaces(id) on delete set null,
  surface     text not null check (surface in ('chat', 'note', 'quiz', 'cards')),
  -- The row the feedback is about. Deliberately NOT a foreign key: it points
  -- at four different tables depending on `surface`, and the alternative —
  -- four nullable FK columns — makes every query check which one is set.
  -- Orphaned targets are harmless here because the evidence, not the target,
  -- is what gets read.
  target_id   uuid not null,
  kind        text not null,
  -- The concept in play, normalized. Lets a later phase scope a preference to
  -- a topic rather than only globally, without needing a backfill pass over
  -- history that no longer exists.
  concept     text,
  created_at  timestamptz not null default now(),

  -- One opinion per response per dimension. A double-tap is not two pieces of
  -- evidence, and without this the confidence arithmetic is trivially gamed by
  -- leaning on a button.
  unique (user_id, target_id, kind)
);

create index if not exists response_feedback_user_created_idx
  on public.response_feedback (user_id, created_at desc);

alter table public.response_feedback enable row level security;

create policy "own response feedback" on public.response_feedback for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What shaped a response, so feedback about it is interpretable.
--
-- `chat_messages` stored the text and its citations and nothing about how it
-- came to be. "Too long" is readable from the content alone, but "this
-- explanation worked" cannot be attributed to anything without knowing what
-- was applied when it was written. 1:1 with the row, so a separate table
-- would be a join for no benefit.
--
-- Shape: {strategy, model, chars, had_sources, skill_ids, prefs_applied}
alter table public.chat_messages
  add column if not exists meta jsonb;
