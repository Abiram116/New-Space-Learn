-- Pinning a subject to the top of the rail.
--
-- A column rather than localStorage: a subject is server data, and a pin that
-- lives in one browser's storage silently disagrees with itself the moment
-- the student opens the app anywhere else. It is one boolean per subject —
-- the cheapest possible thing to store, and the only version that is true
-- everywhere.
--
-- SAFE TO RUN ON A POPULATED TABLE. Adding a nullable-with-default boolean
-- rewrites no existing rows in Postgres 11+ (the default is stored in the
-- catalogue, not backfilled), and every existing subject correctly starts
-- unpinned. Nothing reads this column until the API ships, so applying it
-- early is harmless.
--
-- HOW TO APPLY: from the repo root, `npm run db:push`. See docs/operations/setup.md —
-- migrations applied by hand in the dashboard SQL editor are invisible to
-- the CLI and need `supabase migration repair` afterwards.

alter table public.subjects
  add column if not exists pinned boolean not null default false;

-- The rail sorts pinned-first, then by creation. Without this index that
-- ordering is a sort over every subject the user owns on each page load;
-- with it, it is an index scan. Tiny table today, but the ordering is on
-- the app's most-loaded query and the index costs nothing to carry.
create index if not exists subjects_user_pinned_idx
  on public.subjects (user_id, pinned desc, created_at asc);
