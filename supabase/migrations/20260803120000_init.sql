-- Space Learn — initial schema
-- Applied by Supabase automatically when this file lands on the tracked branch.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── Subjects & subspaces ───────────────────────────────────────────
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tone text not null default 'brand'
    check (tone in ('brand','sky','mint','sun','coral')),
  created_at timestamptz not null default now()
);
create index if not exists subjects_user_idx on public.subjects (user_id);

create table if not exists public.subspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists subspaces_user_idx on public.subspaces (user_id);
create index if not exists subspaces_subject_idx on public.subspaces (subject_id);

-- ── Chat ───────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_subspace_created_idx
  on public.chat_messages (subspace_id, created_at desc);

-- ── Documents (RAG source of truth) ────────────────────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  name text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'uploading'
    check (status in ('uploading','processing','ready','failed')),
  error text,
  storage_path text,
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists documents_subspace_idx on public.documents (subspace_id);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  locator text,
  embedding vector(1536)
);
-- ivfflat needs at least a few thousand rows before it beats a scan; the
-- index still costs nothing at read time on small tables.
create index if not exists document_chunks_embedding_idx
  on public.document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists document_chunks_subspace_idx
  on public.document_chunks (subspace_id);

-- ── Notes ──────────────────────────────────────────────────────────
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  title text not null,
  body_md text not null default '',
  origin text not null default 'user' check (origin in ('user','agent','doc')),
  source_ids jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_subspace_idx on public.notes (subspace_id, updated_at desc);

-- ── Flashcards (SM-2 lite) ─────────────────────────────────────────
create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists decks_subspace_idx on public.decks (subspace_id);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  front text not null,
  back text not null,
  source text,
  ease real not null default 2.5,
  interval_days int not null default 0,
  reps int not null default 0,
  due_at timestamptz not null default now()
);
create index if not exists flashcards_deck_due_idx on public.flashcards (deck_id, due_at);

-- ── Quizzes ────────────────────────────────────────────────────────
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  topic text,
  questions jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists quizzes_subspace_idx on public.quizzes (subspace_id, created_at desc);

create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  score int not null,
  submitted_at timestamptz not null default now()
);

-- ── Skills (custom AI personas) ────────────────────────────────────
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: library skills (is_library=true) are seeded with no owner.
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '🧠',
  tone text not null default 'brand'
    check (tone in ('brand','sky','mint','sun','coral')),
  description text,
  instructions text not null,
  capabilities jsonb not null default '["docs","quiz"]'::jsonb,
  is_library boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists skills_user_idx on public.skills (user_id);

create table if not exists public.subspace_skills (
  subspace_id uuid not null references public.subspaces(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  primary key (subspace_id, skill_id)
);

-- ── Gamification + prefs ───────────────────────────────────────────
create table if not exists public.daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  chat_messages int not null default 0,
  cards_reviewed int not null default 0,
  quizzes_taken int not null default 0,
  study_seconds int not null default 0,
  primary key (user_id, day)
);
create index if not exists daily_activity_user_day_idx on public.daily_activity (user_id, day desc);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_goal int not null default 20,
  reminder_time time,
  streak_freeze_enabled boolean not null default true,
  spaced_pace text not null default 'balanced'
    check (spaced_pace in ('relaxed','balanced','aggressive')),
  answer_only_from_docs boolean not null default true,
  always_show_citations boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Storage bucket (private) ───────────────────────────────────────
-- Bucket rows live in the `storage` schema. Idempotent insert so re-running
-- the migration doesn't error.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
