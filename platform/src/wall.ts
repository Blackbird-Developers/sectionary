// The wall's precomputed set (migration 0018, wall_shown): rebuilt after a job
// changes blocks, so the wall shows the change at once instead of at the web
// app's next safety-net refresh (up to ten minutes later, web/src/server/wall.ts).

import type postgres from "postgres";

/**
 * Rebuild wall_shown when something it reads changed. true when it rebuilt;
 * false when nothing changed, another caller was already rebuilding, or the
 * database predates migration 0018.
 */
export async function refreshWall(sql: postgres.Sql, log: (line: string) => void = console.log): Promise<boolean> {
  const started = Date.now();
  try {
    const [{ refreshed }] = await sql`SELECT refresh_wall_shown() AS refreshed`;
    if (refreshed) log(`Refreshed wall_shown in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    return refreshed as boolean;
  } catch (e) {
    if ((e as { code?: string }).code === "42883") return false; // no function yet: migration 0018 not applied
    throw e;
  }
}
