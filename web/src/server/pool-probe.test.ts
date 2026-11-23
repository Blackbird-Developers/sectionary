// npm test (web): node:test under Node's type stripping, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_MS, makeProbe, STUCK_MS } from "./pool-probe.ts";

/** A fake pool: each probe waits until the test answers it. */
function setup() {
  let clock = 0;
  const asked: number[] = [];
  const answers: ((ok: boolean) => void)[] = [];
  let resets = 0;
  const probe = makeProbe({
    now: () => clock,
    responds: (ms) => {
      asked.push(ms);
      return new Promise<boolean>((resolve) => answers.push(resolve));
    },
    reset: () => void (resets += 1),
    log: () => {},
  });
  return {
    probe,
    asked,
    answer: (ok: boolean) => answers.shift()!(ok),
    tick: (ms: number) => void (clock += ms),
    resets: () => resets,
  };
}

test("the health check answers at once and gives the pool STUCK_MS, not 3 s", () => {
  const t = setup();
  assert.equal(t.probe.check(), true);
  assert.deepEqual(t.asked, [STUCK_MS]);
  assert.ok(STUCK_MS >= 60_000);
});

test("a busy pool that answers late is not reset", async () => {
  const t = setup();
  t.probe.check();
  t.tick(20_000);
  // The load balancer checks again while the first probe still waits: no second probe, still healthy.
  assert.equal(t.probe.check(), true);
  assert.equal(t.asked.length, 1);
  t.answer(true);
  await t.probe.pending();
  assert.equal(t.resets(), 0);
  assert.equal(t.probe.check(), true);
});

test("a pool that stays silent is reset once, and reported", async () => {
  const t = setup();
  t.probe.check();
  t.tick(STUCK_MS);
  t.answer(false);
  await t.probe.pending();
  assert.equal(t.resets(), 1);
  assert.equal(t.probe.check(), false);
});

test("probes at most every EVERY_MS once one has finished", async () => {
  const t = setup();
  t.probe.check();
  t.answer(true);
  await t.probe.pending();
  t.tick(EVERY_MS - 1);
  t.probe.check();
  assert.equal(t.asked.length, 1);
  t.tick(1);
  t.probe.check();
  assert.equal(t.asked.length, 2);
});

test("a probe that throws counts as no answer", async () => {
  let resets = 0;
  const probe = makeProbe({ now: () => 0, responds: () => Promise.reject(new Error("boom")), reset: () => void (resets += 1), log: () => {} });
  probe.check();
  await probe.pending();
  assert.equal(resets, 1);
});
