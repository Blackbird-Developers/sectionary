-- Migration 13: API keys for the MCP server (SEC-31).
--
-- One account may hold a few keys; an agent sends one as a bearer token to
-- /api/mcp. Only the SHA-256 of a key is stored, as with sessions.token_hash:
-- the key itself is shown once, when it is made. `prefix` (the first
-- characters) lets the account page tell keys apart. Revoking sets revoked_at
-- rather than deleting, so last use stays visible.
--
-- Hand-written, mirrored in platform/src/schema.ts.

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  prefix text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX api_keys_hash_uidx ON api_keys(key_hash);
CREATE INDEX api_keys_user_idx ON api_keys(user_id);

-- Same posture as every table since migration 11: RLS on, nothing for the
-- Data API roles, and the web app's role (migration 12) writes it.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_keys FROM anon, authenticated;
GRANT INSERT, UPDATE ON api_keys TO sectionary_app;
CREATE POLICY "web app" ON api_keys TO sectionary_app USING (true) WITH CHECK (true);
