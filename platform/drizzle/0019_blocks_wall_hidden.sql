-- Migration 19: a block can be hidden from the Blocks page and stay on its store's page.
--
-- Many blocks the wall shows offer nothing to someone browsing: a lone photo, a
-- copyright sliver, a bare line of text, a "collection is empty" page. They are
-- still part of their page, so Sites must keep showing them. wall_hidden takes a
-- block off the wall only: wall_shown (migration 0018) skips it, and every
-- reader of the wall (/api/blocks, its facets and counts, the "similar" pools)
-- reads wall_shown. Sites, page views, block detail, boards and the MCP read
-- blocks directly and are unchanged. Nothing is deleted; clearing the flag
-- brings a block back at the next rebuild.
--
-- wall_shown keeps one block per store, viewport and section. When the block a
-- section showed is hidden, the next one of that section from the same store
-- (by the same order as before) takes its place, so a hide never empties a
-- section a store has another copy of.
--
-- Who sets it: npm run hide-blocks (platform/src/hide-blocks.ts), from a review
-- of the blocks (26 Nov 2026: Claude Haiku 5.5 over the 22,867 blocks then on
-- the wall). wall_hidden_reason says why ("review: just-image (2/5): ..."),
-- wall_hidden_at when. A recapture makes new block rows, unhidden.

ALTER TABLE blocks
  ADD COLUMN wall_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN wall_hidden_reason text,
  ADD COLUMN wall_hidden_at timestamptz;

-- The rebuild reads blocks through this covering index (migration 0017): it now needs wall_hidden too.
DROP INDEX IF EXISTS blocks_wall_idx;
CREATE INDEX blocks_wall_idx ON blocks (capture_id)
  INCLUDE (id, viewport, block_index, block_type, type_hint, videos, background, wall_hidden);

-- A materialized view's query cannot be altered: drop and create it again, as in
-- migration 0018 plus "AND NOT b.wall_hidden". refresh_wall_shown() finds it by name.
DROP MATERIALIZED VIEW wall_shown;
CREATE MATERIALIZED VIEW wall_shown AS
SELECT d.*,
  row_number() OVER (PARTITION BY d.store_id ORDER BY md5(d.id::text))::int AS turn,
  row_number() OVER (PARTITION BY d.store_id, d.viewport ORDER BY md5(d.id::text))::int AS vp_turn,
  md5(d.store_id::text) AS store_order
FROM (
  SELECT DISTINCT ON (s.host, b.viewport, regexp_replace(coalesce(b.block_type, b.type_hint), '-part$', ''))
    b.id, s.id AS store_id, s.host, b.viewport, coalesce(b.block_type, b.type_hint) AS block,
    p.type AS page_type, s.platform, s.theme_name, s.apps, s.industry, s.country,
    b.videos, b.background, b.capture_id, c.captured_at, b.block_index
  FROM blocks b JOIN captures c ON c.id = b.capture_id JOIN pages p ON p.id = c.page_id JOIN sites s ON s.id = p.site_id
  WHERE c.id = (SELECT c2.id FROM captures c2 WHERE c2.page_id = p.id ORDER BY c2.captured_at DESC LIMIT 1)
    AND NOT b.wall_hidden
  ORDER BY s.host, b.viewport, regexp_replace(coalesce(b.block_type, b.type_hint), '-part$', ''),
    array_position(ARRAY['home', 'collection', 'product']::text[], p.type) NULLS LAST,
    coalesce(b.block_type, b.type_hint) LIKE '%-part', p.url, b.block_index, b.id
) d;

-- Unique: REFRESH ... CONCURRENTLY needs it, and search joins by id.
CREATE UNIQUE INDEX wall_shown_id_idx ON wall_shown (id);
-- The mixed wall reads in this order and stops after a page.
CREATE INDEX wall_shown_order_idx ON wall_shown (turn, store_order, id);
CREATE INDEX wall_shown_vp_order_idx ON wall_shown (viewport, vp_turn, store_order, id);

GRANT SELECT ON wall_shown TO sectionary_app;
REVOKE ALL ON wall_shown FROM anon, authenticated;

-- Hiding or unhiding a block is a change the rule reads: it marks the set stale like the other columns.
DROP TRIGGER wall_changed_rows ON blocks;
CREATE TRIGGER wall_changed_rows AFTER INSERT OR DELETE OR UPDATE OF id, capture_id, viewport, block_type, type_hint, block_index, videos, background, wall_hidden
  ON blocks FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
