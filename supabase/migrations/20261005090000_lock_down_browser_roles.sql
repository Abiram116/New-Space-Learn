-- Close the database to the browser's roles.
--
-- The browser talks to Supabase for sign-in only (see web/src/api/supabase.ts):
-- every read and write goes through the API, which uses the service role. But
-- the `anon` and `authenticated` roles still held full table privileges from
-- Supabase's defaults, so anyone signed in could call PostgREST directly with
-- the public anon key and their own session and write rows the API would never
-- have accepted. RLS limits those rows to `user_id = auth.uid()`, which is not
-- enough, because the API trusts what those rows point at:
--
--   * a skill inserted with `is_library = true` showed up in EVERY student's
--     library, and its instructions went into their prompts once switched on;
--   * a `subspace_links` row pointing at someone else's topic id made that
--     topic's document chunks part of the attacker's retrieval (the API reads
--     chunks with the service role, by topic id);
--   * a `subspace_skills` row naming someone else's private skill, or a
--     `document_chunks` row filed under someone else's topic, crossed accounts
--     the same way.
--
-- Revoking the privileges closes all of it at once and changes nothing for the
-- app. The RLS policies stay as a second line, and are tightened below so they
-- would still hold if a grant ever came back.
--
-- HOW TO APPLY: `npm run db:push` from the repo root.

-- ── Table and sequence privileges ──────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Tables created later by this role start closed too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- ── Functions ──────────────────────────────────────────────────────────
-- Our own RPCs are called by the API only. They are SECURITY INVOKER (RLS
-- applies), so this is tidiness more than a fix — except `search_chunks`,
-- whose earlier `revoke ... from public` left Supabase's explicit grants to
-- anon and authenticated in place.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.search_chunks(vector, text, uuid[], integer)',
    'public.spaces_with_counts(uuid)',
    'public.student_snapshot(uuid)',
    'public.match_document_chunks(vector, uuid, integer)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;

  -- The dashboard's "enable RLS on new tables" event-trigger function. It only
  -- ever runs as a trigger; nobody should be able to reach it over /rpc.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- A fixed search path, so the function cannot be pointed at a look-alike
-- table or operator by whoever calls it (Supabase linter 0011).
do $$
begin
  if to_regprocedure('public.search_chunks(vector, text, uuid[], integer)') is not null then
    alter function public.search_chunks(vector, text, uuid[], integer)
      set search_path = public, pg_temp;
  end if;
end $$;

-- ── Policies: still correct if a grant ever returns ───────────────────
-- Only seeded rows are library skills; a student can neither create one nor
-- turn their own into one.
drop policy if exists "modify own skills" on public.skills;
create policy "modify own skills" on public.skills for insert
  with check (user_id = auth.uid() and not coalesce(is_library, false));

drop policy if exists "update own skills" on public.skills;
create policy "update own skills" on public.skills for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not coalesce(is_library, false));

-- A link joins two of YOUR topics.
drop policy if exists "own subspace links" on public.subspace_links;
create policy "own subspace links" on public.subspace_links for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.subspaces s where s.id = subspace_id and s.user_id = auth.uid())
    and exists (select 1 from public.subspaces s where s.id = linked_subspace_id and s.user_id = auth.uid())
  );

-- A skill switched on in your topic is a library skill or one of yours.
drop policy if exists "manage own subspace skills" on public.subspace_skills;
create policy "manage own subspace skills" on public.subspace_skills for all
  using (
    exists (select 1 from public.subspaces s where s.id = subspace_id and s.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.subspaces s where s.id = subspace_id and s.user_id = auth.uid())
    and exists (
      select 1 from public.skills k
      where k.id = skill_id and (k.is_library or k.user_id = auth.uid())
    )
  );

-- ── Storage ────────────────────────────────────────────────────────────
-- Files are uploaded, read and removed by the API (service role), which
-- checks type and size first. The browser-facing policies let a signed-in
-- user put any file of any size under their own folder directly, skipping
-- those checks; nothing in the app uses them.
drop policy if exists "own object read" on storage.objects;
drop policy if exists "own object write" on storage.objects;
drop policy if exists "own object update" on storage.objects;
drop policy if exists "own object delete" on storage.objects;

-- A ceiling on the bucket itself, a little above the API's own 20 MB limit
-- (services/uploads.py), so nothing larger can land there by any route.
update storage.buckets set file_size_limit = 26214400 where id = 'documents';
