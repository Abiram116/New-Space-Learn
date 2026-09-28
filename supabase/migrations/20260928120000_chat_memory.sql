-- Rolling per-topic chat memory.
--
-- Chat's live history window is deliberately short (8/20/40 turns depending
-- on the active skill's memory_scope — see subspace_chat._history_limit),
-- because a large in-context window is real latency and cost paid on every
-- single turn. But a topic can run for hundreds of messages, and nothing
-- above that window was ever remembered. chat_memory.py folds turns that
-- have scrolled out of the live window into a compact summary here, so
-- rag.build_prompt can hand the model what happened earlier without paying
-- full-transcript cost every time.
--
-- `memory_through` is the created_at of the newest message already folded
-- into `memory_summary` — the high-water mark chat_memory.py advances each
-- time it folds another batch, so the same messages are never summarized
-- twice.
--
-- SAFE TO RUN ON A POPULATED TABLE. Both columns are nullable with no
-- default, so every existing subspace starts with no summary and nothing
-- rewritten — a null memory_through reads as "nothing folded yet", and
-- chat_memory.py simply starts from the beginning of the topic's history
-- the next time enough turns pile up outside the live window.
alter table public.subspaces
  add column if not exists memory_summary text,
  add column if not exists memory_through timestamptz;
