-- Linked Subspaces: an explicit, opt-in "related to" edge between two
-- subspaces (same subject or different subjects). Deliberately NOT a
-- knowledge graph — no extraction, no inference, just a join table the
-- student creates on purpose. See docs/v2-review.md for why.
create table if not exists public.subspace_links (
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  linked_subspace_id uuid not null references public.subspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subspace_id, linked_subspace_id),
  check (subspace_id <> linked_subspace_id)
);

create index if not exists subspace_links_subspace_idx
  on public.subspace_links (subspace_id);

alter table public.subspace_links enable row level security;

create policy "own subspace links" on public.subspace_links for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
