-- Migration 17: covering indexes for the wall's query (web/src/server/blocks.ts).
--
-- Every /api/blocks request works out "one block per section of a store" (SHOWN)
-- over the latest capture of every page, then counts every facet over that set.
-- Both read only a few narrow columns of blocks, but without these indexes they
-- read the table itself: 136 MB of rows carrying text, tagger output, style and
-- embeddings. On the Supabase Free plan that does not stay in memory, so the
-- first request after a quiet spell read from disk: about 20 s for SHOWN alone
-- on 20 Nov 2026, long enough for the pooler to drop connections (the 5xx that
-- rolled back a deploy that day).
--
-- With them both steps are index-only scans over about 25 MB (measured on a
-- restore of production, 20 Nov 2026: pages read from outside shared buffers
-- for the facet query 19,442 -> 3,393, heap fetches 0):
--   blocks_wall_idx     SHOWN joins blocks by capture_id.
--   blocks_wall_id_idx  the outer query and facetCounts join back by id.
-- The INCLUDE columns are exactly what SHOWN, blockWhere and facetCounts read
-- from blocks; add a column here when one of those starts reading another.
-- Index-only scans rely on the visibility map, which autovacuum keeps current.
--
-- IF NOT EXISTS so a hand-made copy of the same index does not fail the run.
-- Hand-written. Drizzle's index builder has no INCLUDE, so platform/src/schema.ts
-- only points here.

CREATE INDEX IF NOT EXISTS blocks_wall_idx ON blocks (capture_id)
  INCLUDE (id, viewport, block_index, block_type, type_hint, videos, background);

CREATE INDEX IF NOT EXISTS blocks_wall_id_idx ON blocks (id)
  INCLUDE (capture_id, viewport, block_type, type_hint, videos, background);
