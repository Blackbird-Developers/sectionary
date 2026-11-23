import { databaseResponds, resetDatabase } from "@/server/db";
import { makeProbe } from "@/server/pool-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  var sectionaryProbe: ReturnType<typeof makeProbe> | undefined;
}

const probe = () =>
  (globalThis.sectionaryProbe ??= makeProbe({
    now: Date.now,
    responds: databaseResponds,
    reset: resetDatabase,
    log: (message) => console.error(message),
  }));

/**
 * GET /api/health · the ECS load balancer's health check. 200 while the
 * server is up, whatever the database says: a slow or down Supabase must not
 * get the app restarted in a loop, since a new task would meet the same
 * database. Each check also starts a probe of the connection pool in the
 * background (server/pool-probe.ts), which drops the pool only when it has
 * stayed silent for a minute: stuck, not merely busy. It answers at once and
 * never waits on the probe. `database` reports the last finished probe.
 */
export async function GET() {
  const ok = process.env.DATABASE_URL ? probe().check() : null;
  return Response.json({ ok: true, database: ok === null ? "unconfigured" : ok ? "ok" : "reset" }, { headers: { "cache-control": "no-store" } });
}
