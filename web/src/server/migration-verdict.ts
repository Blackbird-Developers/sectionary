// The decision behind server/migrations.ts, without the database, so npm test can check it.

/** How long after starting a server may refuse traffic for missing migrations. */
export const GATE_MS = 20 * 60_000;

export type MigrationState =
  | { status: "ok" }
  | { status: "behind"; missing: string[]; gate: boolean }
  | { status: "unknown" }
  | { status: "skipped" };

/** Which expected migrations the database lacks, and whether that blocks traffic (only in a server's first GATE_MS). */
export function migrationVerdict(expected: string[], applied: Iterable<string>, uptimeMs: number): MigrationState {
  if (expected.length === 0) return { status: "skipped" };
  const done = new Set(applied);
  const missing = expected.filter((name) => !done.has(name));
  return missing.length ? { status: "behind", missing, gate: uptimeMs < GATE_MS } : { status: "ok" };
}
