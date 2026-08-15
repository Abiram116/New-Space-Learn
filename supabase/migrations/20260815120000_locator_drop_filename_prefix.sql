-- `chunk_text` used to bake the document's own filename into `locator`
-- ("<filename> · offset <N>"), even though every consumer of a citation
-- (ChatMessage's citation cards, notes' `sourceLine`, DocsView) already
-- pairs `document_name` with `locator` on the assumption the two are
-- complementary. With the filename baked into both, two citations to the
-- same document rendered as "file.pdf · file.pdf · offset 5306" — reads as
-- a duplication bug in the UI even though the underlying data was only
-- redundant, not wrong. Fixed going forward in
-- app/services/embeddings.py::chunk_text; this backfills chunks embedded
-- before that fix.
--
-- Only touches rows whose locator actually starts with their own document's
-- name followed by ' · ' — the exact shape the old code produced — so a
-- locator that was already clean, or one produced by some other path
-- entirely, is left untouched.
update public.document_chunks c
set locator = substring(c.locator from length(d.name) + 4)
from public.documents d
where c.document_id = d.id
  and c.locator like d.name || ' · %'
  and c.locator not like 'offset %';
