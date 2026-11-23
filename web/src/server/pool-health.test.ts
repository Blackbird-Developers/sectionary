// npm test (web): when the health check drops the database pool, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_MS, poolWatch, STUCK_MS } from "./pool-health.ts";

/** Lets the promises a probe's answer sets off run to their end. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A pool whose probes answer only when the test says so, and a clock the test
 * moves. A reset fails the probes still waiting, as resetDatabase() does to
 * every query on the old pool; `dropOnReset: false` leaves them hanging.
 */
function fakePool({ dropOnReset = true } = {}) {
  let time = 1_000_000;
  let resets = 0;
  const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const check = poolWatch({
    probe: () => new Promise<void>((resolve, reject) => waiting.push({ resolve, reject })),
    reset: () => {
      resets++;
      if (dropOnReset) for (const probe of waiting.splice(0)) probe.reject(new Error("CONNECTION_DESTROYED"));
    },
    now: () => time,
    slowMs: 0,
    log: () => {},
  });
  return {
    check,
    advance: (ms: number) => void (time += ms),
    /** The probes sent and not yet answered. */
    waiting: () => waiting.length,
    /** The database answers the oldest waiting probe. */
    answer: async () => {
      waiting.shift()?.resolve();
      await settle();
    },
    /** The database refuses the oldest waiting probe. */
    fail: async () => {
      waiting.shift()?.reject(new Error("connect ECONNREFUSED"));
      await settle();
    },
    resets: () => resets,
  };
}

test("a probe that is answered is ok, and probes go out at most every EVERY_MS", async () => {
  const pool = fakePool();
  const first = pool.check();
  await pool.answer();
  assert.equal(await first, "ok");

  pool.advance(EVERY_MS - 1);
  assert.equal(await pool.check(), "ok");
  assert.equal(pool.waiting(), 0, "no second probe inside EVERY_MS");

  pool.advance(1);
  const next = pool.check();
  assert.equal(pool.waiting(), 1);
  await pool.answer();
  assert.equal(await next, "ok");
});

test("a busy pool is never reset: the probe waits its turn and is answered", async () => {
  const pool = fakePool();
  // The pool answers, then no check comes for 30 s, as between a load balancer's checks.
  const first = pool.check();
  await pool.answer();
  assert.equal(await first, "ok");
  pool.advance(30_000);

  // Five slow queries now hold the pool for 50 s. The load balancers keep checking.
  for (let waited = 0; waited < 50_000; waited += 5_000) {
    assert.equal(await pool.check(), "busy");
    pool.advance(5_000);
  }
  assert.equal(pool.waiting(), 1, "one probe waiting, not one per check");
  assert.equal(pool.resets(), 0, "80 s since the last answer, but the probe has waited only 50 s");

  // One of the slow queries finishes, and the probe is next.
  await pool.answer();
  assert.equal(pool.resets(), 0);

  // The check after that sends a new probe, which a pool with room answers at once.
  const after = pool.check();
  await pool.answer();
  assert.equal(await after, "ok");
  assert.equal(pool.resets(), 0);
});

test("a stuck pool is reset once a probe has waited STUCK_MS, and the new pool starts clean", async () => {
  const pool = fakePool();
  assert.equal(await pool.check(), "busy");
  pool.advance(STUCK_MS - 1);
  assert.equal(await pool.check(), "busy");
  assert.equal(pool.resets(), 0);

  pool.advance(1);
  assert.equal(await pool.check(), "reset");
  assert.equal(pool.resets(), 1);

  // The old probe failed with the old pool. That is not held against the new one.
  await settle();
  pool.advance(5_000);
  const fresh = pool.check();
  assert.equal(pool.waiting(), 1, "the new pool is probed at the next check");
  await pool.answer();
  assert.equal(await fresh, "ok");
  assert.equal(pool.resets(), 1);
});

test("a pool that stays stuck is reset again only after its own STUCK_MS", async () => {
  const pool = fakePool();
  await pool.check();
  pool.advance(STUCK_MS);
  assert.equal(await pool.check(), "reset");

  // The new pool's minute starts when its first probe goes out, not at the reset.
  pool.advance(5_000);
  assert.equal(await pool.check(), "busy");
  pool.advance(STUCK_MS - 1);
  assert.equal(await pool.check(), "busy");
  assert.equal(pool.resets(), 1);

  pool.advance(1);
  assert.equal(await pool.check(), "reset");
  assert.equal(pool.resets(), 2);
});

test("an answer from the dropped pool does not count for the new one", async () => {
  const pool = fakePool({ dropOnReset: false });
  await pool.check();
  pool.advance(STUCK_MS);
  assert.equal(await pool.check(), "reset");

  pool.advance(5_000);
  assert.equal(await pool.check(), "busy");
  assert.equal(pool.waiting(), 2, "the old pool's probe, and the new pool's");

  // The old pool's probe is answered after all. The new pool's is still waiting.
  await pool.answer();
  assert.equal(await pool.check(), "busy");

  pool.advance(STUCK_MS);
  assert.equal(await pool.check(), "reset", "the new pool's own minute still counts");
  assert.equal(pool.resets(), 2);
});

test("a database that refuses the probe is down, and reset only if that lasts STUCK_MS", async () => {
  const pool = fakePool();
  const first = pool.check();
  await pool.fail();
  assert.equal(await first, "down");
  assert.equal(pool.resets(), 0);

  // It comes back before STUCK_MS: no reset, and the count starts over.
  pool.advance(EVERY_MS);
  const second = pool.check();
  await pool.answer();
  assert.equal(await second, "ok");

  // It goes away for good: down at every probe for a minute, and only then the reset.
  for (let refused = 0; refused < STUCK_MS; refused += EVERY_MS) {
    pool.advance(EVERY_MS);
    const check = pool.check();
    await pool.fail();
    assert.equal(await check, "down");
  }
  assert.equal(pool.resets(), 0);

  pool.advance(EVERY_MS);
  const last = pool.check();
  await pool.fail();
  assert.equal(await last, "reset");
  assert.equal(pool.resets(), 1);
});
