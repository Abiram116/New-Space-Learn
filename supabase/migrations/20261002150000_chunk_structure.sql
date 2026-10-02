-- Chunks that know where they are from.
--
-- Until now a chunk was a 900-character window with a character offset.
-- Ingestion now reads a document's structure (app/services/chunking.py), so a
-- chunk records its pages and its heading path, and a citation can say
-- "p. 8–9 · Learning rate" instead of "offset 5306".
--
--   document_chunks.page_start / page_end   1-based; null for files with no pages
--   document_chunks.section                 "Gradient descent › Momentum"
--   documents.index_version                 which chunker built its chunks
--
-- `index_version` is how a later improvement finds the documents it has not
-- reached yet: everything stored before this is version 1, and
-- `scripts/reembed_documents.py --outdated` rebuilds whatever is behind the
-- current version. Nothing is rebuilt by this migration itself.
--
-- Additive only, with defaults: existing rows keep working unchanged, and it
-- is safe to run more than once. RUN THIS BEFORE DEPLOYING THE CODE THAT GOES
-- WITH IT — new uploads write these columns.

alter table public.document_chunks
  add column if not exists page_start int,
  add column if not exists page_end   int,
  add column if not exists section    text;

alter table public.documents
  add column if not exists index_version int not null default 1;

-- Finding the documents still on an old version (the re-index script).
create index if not exists documents_index_version_idx
  on public.documents (index_version) where status = 'ready';
