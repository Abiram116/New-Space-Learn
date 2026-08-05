-- Skills as a behavior package: a Skill was just a name + one instructions
-- blob. This adds the two real new dimensions from docs/plan-backend.md
-- §5 — memory_scope and output_format. `instructions` keeps meaning
-- "reasoning style" (no rename, no data loss); `capabilities` already
-- serves as the "allowed tools" dimension.
alter table public.skills
  add column if not exists memory_scope text not null default 'session'
    check (memory_scope in ('session', 'topic', 'all')),
  add column if not exists output_format text;
