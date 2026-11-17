-- Migration 14: design metadata (SEC-31, brief section 7.2).
--
-- blocks.style / blocks.outline   BlockStyle and OutlineNode[] from the manifest (web/src/contracts/manifest.ts).
-- captures.page_styles            { desktop?: PageStyles, mobile?: PageStyles }.
-- sites.design_profile            The store design profile (L3), built by `npm run profile-sites`.
-- benchmarks                      What is typical per industry, page type and viewport (L4), built by `npm run benchmarks`.
--
-- All null until captures made with --styles are imported: old captures cannot
-- be backfilled from screenshots, and readers show null, never a guess.
-- Measurements only, never a store's source (docs/CONTRACTS.md).
--
-- Hand-written, mirrored in platform/src/schema.ts.

ALTER TABLE blocks   ADD COLUMN style jsonb, ADD COLUMN outline jsonb;
ALTER TABLE captures ADD COLUMN page_styles jsonb;
ALTER TABLE sites    ADD COLUMN design_profile jsonb, ADD COLUMN design_profile_at timestamptz;

CREATE TABLE benchmarks (
  industry text NOT NULL,          -- an industry key, or 'all'
  page_type text NOT NULL,
  viewport text NOT NULL,
  metric text NOT NULL,
  n integer NOT NULL,              -- stores measured; a benchmark is served only from 10
  p25 real, p50 real, p75 real,    -- numeric metrics
  shares jsonb,                    -- categorical metrics: { value: share }
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (industry, page_type, viewport, metric)
);

-- Same posture as every table since migration 11. The web app only reads it
-- (SELECT comes from migration 12's default privileges); the platform jobs
-- write it as the owner.
ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON benchmarks FROM anon, authenticated;
CREATE POLICY "web app" ON benchmarks TO sectionary_app USING (true);
