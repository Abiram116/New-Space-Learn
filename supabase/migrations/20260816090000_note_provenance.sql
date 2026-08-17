-- Notes provenance: track whether a user and/or an agent have actually
-- touched a note's content, not just who created it.
--
-- `origin` only ever records who created the row, and never changes after —
-- an AI-generated note a student then rewrites by hand still shows
-- origin='agent' forever, and a hand-written note extended entirely through
-- the `/ai` inline command still shows origin='user' forever. The All/AI/Mine
-- filter and the "Created by..." label both read `origin` directly, so the
-- displayed provenance silently drifts from the truth as soon as either
-- party edits what the other one started.
--
-- Two independent booleans, not a single "last edited by": AI-created +
-- user-edited must appear in BOTH the AI and Mine filters, which a single
-- "last touched by" value cannot express. Existing rows are backfilled from
-- their current `origin` so nothing regresses to "touched by nobody".
alter table public.notes
  add column if not exists touched_by_user boolean not null default false,
  add column if not exists touched_by_agent boolean not null default false;

update public.notes set touched_by_user = true where origin = 'user';
update public.notes set touched_by_agent = true where origin = 'agent';
