/**
 * When the health check probes the database pool, and when it drops it.
 *
 * On 13 Nov 2026 the one AWS task had all its connections stuck for hours: no
 * error, no answer. The health check has dropped a pool that did not answer
 * `SELECT 1` ever since. Until 23 Nov it allowed 3 s, and that could not tell a
 * stuck pool from a busy one: the wall asks for about fifteen cold reads at
 * once, each seconds long, the probe queued behind them, missed its 3 s, and the
 * reset failed every one of those reads with a 503. A stuck pool stays silent;
 * a busy one answers once its queue moves. So the probe now waits STUCK_MS,
 * in the background: the load balancer's check never waits on it.
 *
 * No database import here, so `npm test` can drive it with a fake clock.
 */

/**
 * How long `SELECT 1` may go unanswered before the pool counts as stuck. The
 * load balancer gives up on any request after 60 s, so a pool that cannot answer
 * within that is answering no visitor either: dropping it loses nothing.
 */
export const STUCK_MS = 60_000;

/** The load balancers check every 30 s, more than one of them: probe at most this often. */
export const EVERY_MS = 15_000;

export type ProbeDeps = {
  now: () => number;
  /** Whether the pool answers `SELECT 1` within `ms` (server/db.ts databaseResponds). */
  responds: (ms: number) => Promise<boolean>;
  /** Drops the pool (server/db.ts resetDatabase). */
  reset: () => void;
  log: (message: string) => void;
};

export function makeProbe({ now, responds, reset, log }: ProbeDeps) {
  let ok = true;
  let at = Number.NEGATIVE_INFINITY;
  let running: Promise<boolean> | undefined;

  /**
   * The last probe's verdict, at once. Starts a probe in the background when
   * none is running and the last one ended EVERY_MS ago or more.
   */
  function check(): boolean {
    if (!running && now() - at >= EVERY_MS) {
      running = responds(STUCK_MS)
        .catch(() => false)
        .then((answered) => {
          if (!answered) {
            log(`Health: the database did not answer SELECT 1 within ${STUCK_MS / 1000} s; resetting the connection pool.`);
            reset();
          }
          ok = answered;
          at = now();
          running = undefined;
          return answered;
        });
    }
    return ok;
  }

  /** The probe in progress, if any (for tests). */
  const pending = () => running;

  return { check, pending };
}
