import { database } from "@/server/db";
import { migrationVerdict, type MigrationState } from "@/server/migration-verdict";

// Is the database ready for this build? Deploys go out on every push to main,
// but migrations are applied by hand (npm run db:migrate in platform/). Code
// that reads a column its migration has not added yet fails every query that
// touches it, sign-in included. So a new server checks sectionary_migrations
// against the migrations it was built with (next.config.ts puts their names in
// SECTIONARY_MIGRATIONS), and /api/health answers 503 while any are missing.
// ECS then never moves traffic to it and rolls the deploy back, leaving the
// old version serving.
//
// Only in a server's first GATE_MS: a version that is already live is never
// taken down by this (a missing migration found later is reported, not acted
// on), since replacement servers would meet the same database.

const RECHECK_MS = 30_000;

export const expectedMigrations = () => (process.env.SECTIONARY_MIGRATIONS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

declare global {
  // On globalThis, like the pool watch: one answer per server, however often Next.js loads this module.
  var sectionaryMigrationCheck: { state: MigrationState; at: number } | undefined;
}

/**
 * This server's answer, cached: "ok" for good once seen, anything else for
 * RECHECK_MS. A failed query is "unknown", which never blocks: a slow
 * database must not stop a deploy that needs nothing new.
 */
export async function migrationState(now = Date.now()): Promise<MigrationState> {
  const expected = expectedMigrations();
  if (!process.env.DATABASE_URL || expected.length === 0) return { status: "skipped" };
  const cached = globalThis.sectionaryMigrationCheck;
  if (cached && (cached.state.status === "ok" || now - cached.at < RECHECK_MS)) return cached.state;
  let state: MigrationState;
  try {
    const rows = await database()`SELECT name FROM sectionary_migrations`;
    state = migrationVerdict(expected, rows.map((r) => r.name as string), process.uptime() * 1000);
    if (state.status === "behind") console.error("[migrations] the database is missing", state.missing.join(", "), state.gate ? "(not taking traffic)" : "");
  } catch (error) {
    console.error("[migrations] could not check", error);
    state = { status: "unknown" };
  }
  globalThis.sectionaryMigrationCheck = { state, at: now };
  return state;
}
