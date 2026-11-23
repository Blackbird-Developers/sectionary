// The health check's judgement of the database pool: busy, or stuck.
//
// Two states look the same to a quick `SELECT 1`, and need opposite answers.
//
// Stuck (13 Nov 2026): the one AWS task had all five connections hanging for
// hours. No error, no answer, every query queued behind them until the load
// balancer gave up at 60 s (HTTP 504). Only dropping the pool ends that.
//
// Busy (23 Nov 2026): five slow but healthy queries hold the five connections,
// which one visitor opening Flows or Sites on a cold cache is enough for. The
// probe waits its turn behind them. The first version of this check gave it
// 3 s and then dropped the pool, which failed every query in flight with
// CONNECTION_DESTROYED: Flows, Sites, Boards and the wall all answered 503,
// and since a failed answer is never cached, the next visitor did it again.
//
// So the probe is left to wait. postgres.js gives it a place in line: in its
// own queue, served in order, when every connection is full, or behind the
// queries already sent on one connection. Either way a busy pool answers it
// once the queries ahead of it finish, and a stuck one never does. The pool is
// dropped only when a probe has gone unanswered for STUCK_MS, so a stuck pool
// comes back in one to two minutes (the 3 s version took about 30 s).
//
// No imports, so `npm test` can load it without the database (pool-health.test.ts).

/** How long a check waits on the probe before answering. Under the load balancer's 5 s check timeout. */
export const SLOW_MS = 3_000;

/**
 * Nothing has answered since a probe sent this long ago, and the pool counts
 * as stuck. The load balancer answers 504 for any request at 60 s, so whatever
 * the probe waited behind has no reader left by then. Dropping the pool still
 * fails the younger queries on other connections: a last resort, not a reflex.
 */
export const STUCK_MS = 60_000;

/** More than one load balancer checks, every 30 s each: send a probe at most this often. */
export const EVERY_MS = 15_000;

/**
 * ok: the last probe was answered. busy: it is still waiting behind other
 * queries. down: it failed with an error. reset: nothing has answered for
 * STUCK_MS, so the pool was just dropped.
 */
export type PoolHealth = "ok" | "busy" | "down" | "reset";

export type PoolWatchOptions = {
  /** One cheap query on the pool. Resolves when the database answers it. */
  probe: () => PromiseLike<unknown>;
  /** Drops the pool, so the next query opens a fresh one. */
  reset: () => void;
  now?: () => number;
  slowMs?: number;
  log?: (message: string) => void;
};

/** A check to call from the health route. Keeps its state between calls. */
export function poolWatch({ probe, reset, now = Date.now, slowMs = SLOW_MS, log = console.error }: PoolWatchOptions): () => Promise<PoolHealth> {
  /** When the last probe went out. */
  let sentAt = Number.NEGATIVE_INFINITY;
  /**
   * When the oldest probe went out that nothing has answered since. Measured
   * from the send, not from the last answer: checks come up to 30 s apart, and
   * the quiet time between two of them is not the pool's silence.
   */
  let silentSince: number | undefined;
  let failed = false;
  let pending: Promise<void> | undefined;

  return async function check() {
    // One probe at a time: a second one would only wait behind the first.
    if (!pending && now() - sentAt >= EVERY_MS) {
      sentAt = now();
      silentSince ??= sentAt;
      failed = false;
      // probe() may throw before it returns a promise (a malformed DATABASE_URL): a failed probe like any other.
      let sent: PromiseLike<unknown>;
      try {
        sent = probe();
      } catch (error) {
        sent = Promise.reject(error);
      }
      const mine: Promise<void> = Promise.resolve(sent)
        .then(
          () => true,
          () => false,
        )
        .then((answered) => {
          // A probe the reset dropped belongs to the old pool: it says nothing about the new one.
          if (pending !== mine) return;
          pending = undefined;
          if (answered) silentSince = undefined;
          else failed = true;
        });
      pending = mine;
    }

    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([pending, new Promise<void>((resolve) => (timer = setTimeout(resolve, slowMs)))]);
      clearTimeout(timer);
    }

    if (silentSince !== undefined && now() - silentSince >= STUCK_MS) {
      log(`Health: the database has not answered SELECT 1 for ${Math.round((now() - silentSince) / 1000)} s; resetting the connection pool.`);
      reset();
      // The new pool starts clean: probed at the next check, with its own STUCK_MS.
      sentAt = Number.NEGATIVE_INFINITY;
      silentSince = undefined;
      failed = false;
      pending = undefined;
      return "reset";
    }
    if (pending) return "busy";
    return failed ? "down" : "ok";
  };
}
