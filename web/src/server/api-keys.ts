import { randomBytes } from "node:crypto";
import { database } from "@/server/db";
import { hashToken, userById, type SessionUser } from "@/server/accounts";

// API keys for the MCP server (SEC-31, platform/drizzle/0013_api_keys.sql).
// A key is "blimp_" and 32 random bytes; only its SHA-256 is stored, the same
// as session tokens, so a database leak gives no working key. The key is
// shown once, when it is made.

/** Active keys one account may hold. */
export const MAX_KEYS = 5;
const PREFIX = "blimp_";
/** last_used_at is written at most this often per key, so every MCP call is not a write. */
const TOUCH_MS = 5 * 60_000;

export type ApiKeyInfo = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export class ApiKeyError extends Error {}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const rows = await database()`SELECT id, name, prefix, created_at, last_used_at FROM api_keys
    WHERE user_id=${userId} AND revoked_at IS NULL ORDER BY created_at DESC`;
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at) }));
}

/** A new key. Returns the key itself, which is never stored and cannot be shown again. */
export async function createApiKey(userId: string, name: string): Promise<{ key: string; info: ApiKeyInfo }> {
  const label = name.replace(/\s+/g, " ").trim().slice(0, 60) || "MCP key";
  const sql = database();
  return sql.begin(async (tx) => {
    // Serialise per user, so two tabs cannot both pass the count below.
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const [{ n }] = await tx`SELECT count(*)::int AS n FROM api_keys WHERE user_id=${userId} AND revoked_at IS NULL`;
    if (n >= MAX_KEYS) throw new ApiKeyError(`You already have ${MAX_KEYS} keys. Revoke one you no longer use first.`);
    const key = PREFIX + randomBytes(32).toString("base64url");
    const prefix = key.slice(0, PREFIX.length + 6);
    const [r] = await tx`INSERT INTO api_keys (user_id, key_hash, prefix, name) VALUES (${userId}, ${hashToken(key)}, ${prefix}, ${label})
      RETURNING id, name, prefix, created_at, last_used_at`;
    return { key, info: { id: r.id, name: r.name, prefix: r.prefix, createdAt: iso(r.created_at)!, lastUsedAt: null } };
  });
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  await database()`UPDATE api_keys SET revoked_at=now() WHERE id=${id} AND user_id=${userId} AND revoked_at IS NULL`;
}

/** The account behind a bearer key, or null when the key is unknown or revoked. */
export async function userForApiKey(key: string | null): Promise<{ user: SessionUser; keyId: string } | null> {
  if (!key || !key.startsWith(PREFIX) || key.length > 100) return null;
  const sql = database();
  const [row] = await sql`SELECT id, user_id, last_used_at FROM api_keys WHERE key_hash=${hashToken(key)} AND revoked_at IS NULL`;
  if (!row) return null;
  const user = await userById(row.user_id);
  if (!user) return null;
  const last = row.last_used_at instanceof Date ? row.last_used_at.getTime() : 0;
  if (Date.now() - last > TOUCH_MS) await sql`UPDATE api_keys SET last_used_at=now() WHERE id=${row.id}`;
  return { user, keyId: row.id };
}

/** The bearer token in an Authorization header, or null. */
export function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}
