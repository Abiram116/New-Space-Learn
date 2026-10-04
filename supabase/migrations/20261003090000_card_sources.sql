-- Which chunk a generated card was written from.
--
-- Decks were written from the same few chunks every time (a search for the
-- topic name, or for "core concepts"). Card generation now spreads across a
-- topic's sections, least-used first, like quizzes do — and "least used" is
-- read from what earlier cards were written from. Quizzes keep that inside
-- their questions; a card is its own row, so it gets a column.
--
-- No foreign key on purpose: re-processing a document replaces its chunks,
-- and a card must not be deleted, or block that, because the chunk it came
-- from was rebuilt. A stale id simply counts for nothing.
--
-- Additive, nullable, safe to re-run. RUN THIS BEFORE DEPLOYING THE CODE THAT
-- GOES WITH IT — generated cards write this column.

alter table public.flashcards
  add column if not exists source_chunk uuid;
