import { database, resetDatabase } from "@/server/db";
import { poolWatch, type PoolHealth } from "@/server/pool-health";
import { migrationState } from "@/server/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // On globalThis: every load balancer's check must share one watch, however often Next.js loads this module.
  var sectionaryPoolWatch: (() => Promise<PoolHealth>) | undefined;
}

/**
 * GET /api/health · the ECS load balancer's health check. 200 while the
 * server is up, whatever the database says: a slow or down Supabase must not
 * get the app restarted in a loop, since a new task would meet the same
 * database. Each check also probes the connection pool, and drops it
 * (server/db.ts) once nothing has answered for a minute, so a pool whose
 * connections are stuck comes back instead of hanging every request until
 * the task is replaced. A pool that is only busy is left alone: dropping it
 * fails every query in flight (server/pool-health.ts has the two incidents).
 *
 * `database` reports the pool: ok, busy (the probe is waiting behind other
 * queries), down (the probe failed), reset (the pool was just dropped), or
 * unconfigured.
 *
 * The one exception to "200 while up": a server that has just started on a
 * database missing migrations it was built with answers 503, so ECS keeps the
 * old version and rolls the deploy back (server/migrations.ts).
 */
export async function GET() {
  const check = (globalThis.sectionaryPoolWatch ??= poolWatch({ probe: () => database()`SELECT 1`, reset: resetDatabase }));
  const state = process.env.DATABASE_URL ? await check() : "unconfigured";
  const migrations = await migrationState();
  const blocked = migrations.status === "behind" && migrations.gate;
  return Response.json(
    { ok: !blocked, database: state, migrations: migrations.status === "behind" ? { status: "behind", missing: migrations.missing } : migrations.status },
    { status: blocked ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
