-- Reverts 20260807120000_slugs.sql.
--
-- The slug feature was rolled back: it added a NOT NULL `slug` column that
-- the API did not populate on insert, which broke subject/topic creation
-- outright. Routing is by id only now — see `web/src/lib/nav.ts`.

drop index if exists public.subjects_user_slug_key;
drop index if exists public.subspaces_subject_slug_key;

alter table public.subjects  drop column if exists slug;
alter table public.subspaces drop column if exists slug;

drop function if exists public.slugify(text);
drop function if exists public.unaccent_safe(text);
