import type { database } from "@/server/db";

// The wall's shown set (wall_shown, migration 0018) is rebuilt by the importer
// and taggers when they finish (platform/src/wall.ts). This is the safety net
// for a writer that does not: a crawler running older code, a fix made by
// hand in SQL. The database decides whether anything changed since the last
// rebuild and lets one caller at a time do it, so asking is cheap; a rebuild
// itself takes the database seconds, so it happens at most every ten minutes,
// the same staleness the wall's response cache already allows.

const MIN_AGE = "10 minutes";
/** How often this server asks at most. */
const EVERY_MS = 60_000;

declare global {
  var sectionaryWallAsked: number | undefined;
}

/**
 * Ask the database to rebuild wall_shown if it is stale. Never waits and never
 * throws: the wall answers from the set it has. Call it from wall requests.
 */
export function refreshWallSoon(sql: ReturnType<typeof database>): void {
  const now = Date.now();
  if (globalThis.sectionaryWallAsked && now - globalThis.sectionaryWallAsked < EVERY_MS) return;
  globalThis.sectionaryWallAsked = now;
  void sql`SELECT refresh_wall_shown(${MIN_AGE}::interval)`.catch((error: unknown) => {
    console.error("wall_shown refresh failed", error);
  });
}
