-- Exact per-topic vector search, and an index for ingestion's own queries.
--
-- 1. DROP the ivfflat index. It was silently making retrieval worse:
--    - It was built while `document_chunks` was EMPTY (both earlier
--      migrations say so). ivfflat's list centroids are computed at build time
--      from the rows present, so every centroid is meaningless.
--    - pgvector's default `ivfflat.probes = 1` searches 1 of 100 lists, i.e.
--      roughly 1% of the vectors.
--    - The `subspace_id` filter is applied AFTER the index scan. A query can
--      therefore return fewer than `match_count` rows, or none, even though
--      the topic has relevant chunks.
--    All three together mean recall can collapse as data grows, with no
--    error anywhere. Retrieval is always scoped to one topic, and a topic
--    holds hundreds to low thousands of 384-dim chunks: an exact scan of
--    that through `document_chunks_subspace_idx` is a few milliseconds, and
--    it is exact. An ANN index only pays off orders of magnitude later — and
--    would then be HNSW, built on real data, with iterative scans for the
--    filter.
--
-- 2. ADD an index on `document_id`. Background ingestion lists stored chunk
--    indexes to resume, and reprocess/delete filter by document. Without it
--    each of those is a sequential scan of every student's chunks.
--
-- `match_document_chunks` itself is unchanged: with no ANN index the planner
-- filters by subspace first, then sorts by distance — exact top-k.
--
-- HOW TO APPLY: `npm run db:push` from the repo root (see
-- docs/operations/setup.md). Safe on a live table: dropping an index and
-- creating a b-tree one are both quick at this size, and nothing reads the
-- ivfflat index by name.

drop index if exists public.document_chunks_embedding_idx;

create index if not exists document_chunks_document_idx
  on public.document_chunks (document_id, chunk_index);
