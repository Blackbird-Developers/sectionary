// npm test (web): whether a new server waits for migrations (server/migration-verdict.ts), no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_MS, migrationVerdict } from "./migration-verdict.ts";

const expected = ["0019_hide.sql", "0020_onboarding.sql", "0021_onboarding_backfill.sql"];

test("every expected migration applied: ok", () => {
  assert.deepEqual(migrationVerdict(expected, expected, 0), { status: "ok" });
});

test("extra migrations in the database (an older build) are fine", () => {
  assert.deepEqual(migrationVerdict(expected.slice(0, 2), expected, 0), { status: "ok" });
});

test("a missing migration on a server that just started blocks traffic, and says which", () => {
  assert.deepEqual(migrationVerdict(expected, expected.slice(0, 1), 5_000), {
    status: "behind",
    missing: ["0020_onboarding.sql", "0021_onboarding_backfill.sql"],
    gate: true,
  });
});

test("a server that has been up past the gate only reports it", () => {
  const verdict = migrationVerdict(expected, expected.slice(0, 2), GATE_MS + 1);
  assert.deepEqual(verdict, { status: "behind", missing: ["0021_onboarding_backfill.sql"], gate: false });
});

test("a build without the list checks nothing", () => {
  assert.deepEqual(migrationVerdict([], [], 0), { status: "skipped" });
});
