-- Row Level Security — one policy pattern per table.
-- The backend uses the service role and bypasses RLS. The anon key from the
-- browser sees only rows that pass these checks, which for us means
-- `user_id = auth.uid()` on every table.

alter table public.subjects           enable row level security;
alter table public.subspaces          enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.documents          enable row level security;
alter table public.document_chunks    enable row level security;
alter table public.notes              enable row level security;
alter table public.decks              enable row level security;
alter table public.flashcards         enable row level security;
alter table public.quizzes            enable row level security;
alter table public.quiz_results       enable row level security;
alter table public.skills             enable row level security;
alter table public.subspace_skills    enable row level security;
alter table public.daily_activity     enable row level security;
alter table public.user_settings      enable row level security;

-- Owner policies — full CRUD on rows tagged with your uid.
create policy "own subjects"        on public.subjects        for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own subspaces"       on public.subspaces       for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own chat messages"   on public.chat_messages   for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own documents"       on public.documents       for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own document chunks" on public.document_chunks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own notes"           on public.notes           for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own decks"           on public.decks           for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own flashcards"      on public.flashcards      for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own quizzes"         on public.quizzes         for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own quiz results"    on public.quiz_results    for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Skills: users see their own AND the shared library rows.
create policy "own skills, read library" on public.skills for select
  using (user_id = auth.uid() or is_library);
create policy "modify own skills"        on public.skills for insert
  with check (user_id = auth.uid());
create policy "update own skills"        on public.skills for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own skills"        on public.skills for delete
  using (user_id = auth.uid());

-- Subspace_skills: users can only touch rows for subspaces they own.
create policy "manage own subspace skills" on public.subspace_skills for all
  using (
    exists (
      select 1 from public.subspaces s
      where s.id = subspace_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.subspaces s
      where s.id = subspace_id and s.user_id = auth.uid()
    )
  );

create policy "own daily activity"  on public.daily_activity  for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own user settings"   on public.user_settings   for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage: user can read/write objects under their own userId prefix.
create policy "own object read" on storage.objects for select
  using (bucket_id = 'documents' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "own object write" on storage.objects for insert
  with check (bucket_id = 'documents' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "own object update" on storage.objects for update
  using (bucket_id = 'documents' and (auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'documents' and (auth.uid())::text = (storage.foldername(name))[1]);

create policy "own object delete" on storage.objects for delete
  using (bucket_id = 'documents' and (auth.uid())::text = (storage.foldername(name))[1]);
