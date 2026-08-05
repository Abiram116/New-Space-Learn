-- Two more subject accents.
--
-- Five colours ran out quickly: a student with six subjects had two that
-- looked identical in the rail, which defeats the point of colouring them.
-- `azure` and `jade` are far enough from the existing five to stay separable
-- at the small sizes the rail marker uses.
--
-- Tone is stored as text with a CHECK rather than an enum, so widening it is
-- a constraint swap and never rewrites existing rows.

alter table public.subjects drop constraint if exists subjects_tone_check;
alter table public.subjects
  add constraint subjects_tone_check
  check (tone in ('brand', 'sky', 'mint', 'sun', 'coral', 'azure', 'jade'));

alter table public.skills drop constraint if exists skills_tone_check;
alter table public.skills
  add constraint skills_tone_check
  check (tone in ('brand', 'sky', 'mint', 'sun', 'coral', 'azure', 'jade'));
