-- Migration 18: the wall's "one block per section" set, worked out once instead of on every request.
--
-- Every /api/blocks request used to work out SHOWN (web/src/server/blocks.ts):
-- the latest capture of every page, then one block per store, viewport and
-- section, then the facets over that set. On 23 Nov 2026 that took the
-- production database 7 s warm and 26 s cold, almost all of it in memory: the
-- Supabase Free compute has little CPU, and the work sorted 68,000 blocks down
-- to 21,000 every time. Pools filled, requests answered 503.
--
-- wall_shown holds that set, with every column the wall's filters, facets and
-- order read, so counting and facets read this one narrow table with no joins,
-- and a page of blocks joins only the rows it returns.
--
-- turn and store_order mix the stores on the wall, as the query did: each
-- store's blocks are dealt in turns, in an order from a hash of the ids. The
-- query counted turns over the filtered set; here they are counted ahead of
-- time, over each store (turn) and over each store and viewport (vp_turn). The
-- wall nearly always shows one viewport, which vp_turn deals exactly as before;
-- other filters are still mixed, but no longer strictly one block per store per turn.
--
-- Keeping it current. The rule reads blocks, captures, pages and sites. A
-- statement trigger on each bumps the sequence wall_changes when a column the
-- rule reads changes (nextval takes no lock and never waits, so writers do not
-- queue on it). refresh_wall_shown(min_age) rebuilds the set when the sequence
-- has moved since the last rebuild and that rebuild is at least min_age old.
-- One caller rebuilds at a time; the others return at once. CONCURRENTLY, so the
-- wall keeps reading the old set while the new one is built.
--   - The importer and taggers call it with no wait when they finish (platform/src/wall.ts).
--   - The web app calls it with 10 minutes, as a safety net for writers that
--     do not (web/src/server/wall.ts).
-- The app's role runs it as its owner, so sectionary_app needs no rights on
-- the view's tables; anon and authenticated cannot run it at all.

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
  ORDER BY s.host, b.viewport, regexp_replace(coalesce(b.block_type, b.type_hint), '-part$', ''),
    array_position(ARRAY['home', 'collection', 'product']::text[], p.type) NULLS LAST,
    coalesce(b.block_type, b.type_hint) LIKE '%-part', p.url, b.block_index, b.id
) d;

-- Unique: REFRESH ... CONCURRENTLY needs it, and search joins by id.
CREATE UNIQUE INDEX wall_shown_id_idx ON wall_shown (id);
-- The mixed wall reads in this order and stops after a page.
CREATE INDEX wall_shown_order_idx ON wall_shown (turn, store_order, id);
CREATE INDEX wall_shown_vp_order_idx ON wall_shown (viewport, vp_turn, store_order, id);

CREATE SEQUENCE wall_changes;
CREATE TABLE wall_refresh (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seen bigint NOT NULL,
  refreshed_at timestamptz NOT NULL
);
ALTER TABLE wall_refresh ENABLE ROW LEVEL SECURITY;
INSERT INTO wall_refresh (seen, refreshed_at) VALUES (0, now());

CREATE FUNCTION wall_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM nextval('wall_changes');
  RETURN NULL;
END $$;

CREATE TRIGGER wall_changed_rows AFTER INSERT OR DELETE OR UPDATE OF id, capture_id, viewport, block_type, type_hint, block_index, videos, background
  ON blocks FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_truncate AFTER TRUNCATE ON blocks FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_rows AFTER INSERT OR DELETE OR UPDATE OF id, page_id, captured_at
  ON captures FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_truncate AFTER TRUNCATE ON captures FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_rows AFTER INSERT OR DELETE OR UPDATE OF id, site_id, type, url
  ON pages FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_truncate AFTER TRUNCATE ON pages FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_rows AFTER INSERT OR DELETE OR UPDATE OF id, host, platform, theme_name, apps, industry, country
  ON sites FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();
CREATE TRIGGER wall_changed_truncate AFTER TRUNCATE ON sites FOR EACH STATEMENT EXECUTE FUNCTION wall_changed();

-- true when it rebuilt the set. The sequence is read before the rebuild, so a
-- change that lands during one makes the next call rebuild again.
CREATE FUNCTION refresh_wall_shown(min_age interval DEFAULT interval '0') RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  latest bigint;
  state wall_refresh;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('wall_shown')) THEN RETURN false; END IF;
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO latest FROM wall_changes;
  SELECT * INTO state FROM wall_refresh WHERE id = 1;
  IF latest <= state.seen OR state.refreshed_at > now() - min_age THEN RETURN false; END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY wall_shown;
  UPDATE wall_refresh SET seen = latest, refreshed_at = now() WHERE id = 1;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION refresh_wall_shown(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wall_changed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_wall_shown(interval) TO sectionary_app;
-- Default privileges cover tables, not materialized views made before them in every setup: say it.
GRANT SELECT ON wall_shown TO sectionary_app;
REVOKE ALL ON wall_shown FROM anon, authenticated;
