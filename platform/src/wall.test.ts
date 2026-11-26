// npm test: the wall's precomputed set (migration 0018) over every fixture store
// imported into a throwaway Postgres.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { startLocalDb, type LocalDb } from "./local-db.js";
import { refreshWall } from "./wall.js";

const run = promisify(execFile);

// The rule the web app ran on every request before migration 0018 (SHOWN in web/src/server/blocks.ts, 20 Nov 2026),
// plus migration 0019: a block hidden from the wall is skipped.
const SHOWN_BEFORE = `SELECT DISTINCT ON (s.host, b.viewport, regexp_replace(coalesce(b.block_type,b.type_hint), '-part$', '')) b.id
  FROM blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id
  WHERE c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1) AND NOT b.wall_hidden
  ORDER BY s.host, b.viewport, regexp_replace(coalesce(b.block_type,b.type_hint), '-part$', ''),
    array_position(ARRAY['home','collection','product']::text[], p.type) NULLS LAST,
    coalesce(b.block_type,b.type_hint) LIKE '%-part', p.url, b.block_index, b.id`;

let local: LocalDb;
let sql: postgres.Sql;
const quiet = () => {};
const shownIds = async () => (await sql`SELECT id FROM wall_shown ORDER BY id`).map((r) => r.id as string);
const ruleIds = async () => (await sql.unsafe(`SELECT id FROM (${SHOWN_BEFORE}) x ORDER BY id`)).map((r) => r.id as string);
/** A shown block whose store has another copy of the same section in the same viewport, on a latest capture. */
const shownWithSecondCopy = () => sql`SELECT w.id, w.host, w.viewport, regexp_replace(w.block, '-part$', '') AS section FROM wall_shown w
  WHERE EXISTS (SELECT 1 FROM blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id
    WHERE s.host=w.host AND b.viewport=w.viewport AND b.id<>w.id AND NOT b.wall_hidden
      AND regexp_replace(coalesce(b.block_type,b.type_hint), '-part$', '')=regexp_replace(w.block, '-part$', '')
      AND c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1))
  ORDER BY w.id LIMIT 1`;

before(async () => {
  local = await startLocalDb();
  sql = postgres(local.url, { max: 2, prepare: false, onnotice: quiet });
  await run("npx", ["tsx", "src/import.ts", resolve(import.meta.dirname, "../../fixtures/manifests")],
    { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: local.url }, shell: true, maxBuffer: 1 << 26 });
});
after(async () => { await sql?.end(); await local?.stop(); });

test("after an import the wall's set is exactly what the old per-request rule chose", async () => {
  const ids = await shownIds();
  assert.ok(ids.length > 50, `the fixture stores fill the wall (${ids.length} blocks)`);
  assert.deepEqual(ids, await ruleIds());
  const [cols] = await sql`SELECT w.* FROM wall_shown w JOIN blocks b ON b.id=w.id LIMIT 1`;
  for (const key of ["store_id", "host", "viewport", "block", "page_type", "platform", "theme_name", "apps", "industry", "country", "videos", "background", "capture_id", "captured_at", "block_index", "turn", "vp_turn", "store_order"])
    assert.ok(key in cols, `wall_shown has ${key}`);
});

test("turns deal each store's blocks one at a time: a store's turns are 1..n", async () => {
  const rows = await sql`SELECT store_id, count(*)::int AS n, min(turn) AS lo, max(turn) AS hi, count(DISTINCT turn)::int AS distinct_turns FROM wall_shown GROUP BY store_id`;
  for (const r of rows) assert.deepEqual([r.lo, r.hi, r.distinct_turns], [1, r.n, r.n]);
});

test("nothing changed: no rebuild; a change the rule reads: one rebuild that picks it up", async () => {
  assert.equal(await refreshWall(sql, quiet), false, "the import already rebuilt it");

  // Retype one shown block to a type no other block has: it stays shown, as its own section now, and the store's
  // other copy of the section it left takes that section's place. The copy is what makes the stale set differ
  // from the rule: block ids are random, so "the lowest id" alone sometimes picked a block with no copy (26 Nov 2026).
  const [victim] = await shownWithSecondCopy();
  assert.ok(victim, "the fixtures have a store with two copies of a section");
  await sql`UPDATE blocks SET block_type = 'wall-test-only' WHERE id = ${victim.id}`;
  assert.notDeepEqual(await shownIds(), await ruleIds(), "the change is not on the wall before a rebuild");
  assert.equal(await refreshWall(sql, quiet), true);
  assert.deepEqual(await shownIds(), await ruleIds());
  const [row] = await sql`SELECT block FROM wall_shown WHERE id = ${victim.id}`;
  assert.equal(row.block, "wall-test-only");
  assert.equal(await refreshWall(sql, quiet), false, "and only once");
});

test("columns the rule does not read change nothing", async () => {
  await sql`UPDATE blocks SET ai_description = 'wall test' WHERE id = (SELECT id FROM blocks LIMIT 1)`;
  await sql`UPDATE sites SET title = title WHERE id = (SELECT id FROM sites LIMIT 1)`;
  assert.equal(await refreshWall(sql, quiet), false);
});

test("min_age holds a rebuild back until the last one is that old", async () => {
  await sql`UPDATE sites SET country = coalesce(country, 'US') WHERE id = (SELECT id FROM sites LIMIT 1)`;
  const [held] = await sql`SELECT refresh_wall_shown(interval '10 minutes') AS r`;
  assert.equal(held.r, false, "the last rebuild was moments ago");
  await sql`UPDATE wall_refresh SET refreshed_at = now() - interval '11 minutes'`;
  const [done] = await sql`SELECT refresh_wall_shown(interval '10 minutes') AS r`;
  assert.equal(done.r, true);
});

test("a deleted capture brings back the page's previous one", async () => {
  // A page with two captures: drop the latest, and the older one's blocks are the page's again.
  // With no recapture in the fixtures, make one: a copy of a page's capture, an hour older, with its blocks.
  const [page] = await sql`SELECT page_id FROM captures GROUP BY page_id HAVING count(*) > 1 LIMIT 1`;
  const pageId = page?.page_id ?? (await sql`SELECT page_id FROM captures c JOIN wall_shown w ON w.capture_id = c.id LIMIT 1`)[0].page_id;
  if (!page) {
    const [src] = await sql`SELECT * FROM captures WHERE page_id = ${pageId} LIMIT 1`;
    const copy = (row: Record<string, unknown>, over: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...row, ...over };
      delete out.id;
      return out;
    };
    const [old] = await sql`INSERT INTO captures ${sql(copy(src, { captured_at: new Date(src.captured_at.getTime() - 3_600_000) }) as never)} RETURNING id`;
    const blocks = await sql`SELECT * FROM blocks WHERE capture_id = ${src.id}`;
    for (const b of blocks) await sql`INSERT INTO blocks ${sql(copy(b, { capture_id: old.id, type_hint: `older-${b.type_hint}` }) as never)}`;
    await refreshWall(sql, quiet);
  }
  const [latest] = await sql`SELECT id FROM captures WHERE page_id = ${pageId} ORDER BY captured_at DESC LIMIT 1`;
  await sql`DELETE FROM captures WHERE id = ${latest.id}`; // its blocks go with it (ON DELETE CASCADE)
  assert.equal(await refreshWall(sql, quiet), true);
  assert.deepEqual(await shownIds(), await ruleIds());
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM wall_shown w JOIN captures c ON c.id = w.capture_id WHERE c.page_id = ${pageId}`;
  assert.ok(n > 0, "the page's older capture is on the wall now");
});

test("the web app's role reads the set and may rebuild it; the Data API roles may do neither", async () => {
  const [can] = await sql`SELECT
    has_table_privilege('sectionary_app', 'wall_shown', 'SELECT') AS app_reads,
    has_function_privilege('sectionary_app', 'refresh_wall_shown(interval)', 'EXECUTE') AS app_runs,
    has_table_privilege('anon', 'wall_shown', 'SELECT') AS anon_reads,
    has_function_privilege('anon', 'refresh_wall_shown(interval)', 'EXECUTE') AS anon_runs,
    has_function_privilege('authenticated', 'refresh_wall_shown(interval)', 'EXECUTE') AS authed_runs`;
  assert.deepEqual({ ...can }, { app_reads: true, app_runs: true, anon_reads: false, anon_runs: false, authed_runs: false });
});

test("vp_turn deals each store's blocks per viewport: 1..n within a store and viewport", async () => {
  const rows = await sql`SELECT count(*)::int AS n, min(vp_turn) AS lo, max(vp_turn) AS hi, count(DISTINCT vp_turn)::int AS distinct_turns FROM wall_shown GROUP BY store_id, viewport`;
  for (const r of rows) assert.deepEqual([r.lo, r.hi, r.distinct_turns], [1, r.n, r.n]);
});

// Migration 0019: a block hidden from the wall (npm run hide-blocks) stays on its page, off the wall.
test("a hidden block leaves the wall, the next copy of its section takes its place, and unhiding brings it back", async () => {
  const [w] = await shownWithSecondCopy();
  assert.ok(w, "the fixtures have a store with two copies of a section");
  await sql`UPDATE blocks SET wall_hidden = true, wall_hidden_reason = 'wall test' WHERE id = ${w.id}`;
  assert.equal(await refreshWall(sql, quiet), true, "hiding is a change the rule reads");
  const shown = await shownIds();
  assert.ok(!shown.includes(w.id), "the hidden block is off the wall");
  assert.deepEqual(shown, await ruleIds());
  const [stand] = await sql`SELECT id FROM wall_shown WHERE host=${w.host} AND viewport=${w.viewport} AND regexp_replace(block, '-part$', '')=${w.section}`;
  assert.ok(stand && stand.id !== w.id, "another copy of the section stands in");
  const [page] = await sql`SELECT count(*)::int AS n FROM blocks WHERE id = ${w.id}`;
  assert.equal(page.n, 1, "the block itself is still there for Sites");

  await sql`UPDATE blocks SET wall_hidden = false, wall_hidden_reason = NULL WHERE id = ${w.id}`;
  assert.equal(await refreshWall(sql, quiet), true);
  assert.ok((await shownIds()).includes(w.id), "unhidden, it is back");
  assert.deepEqual(await shownIds(), await ruleIds());
});

test("npm run hide-blocks: a dry run changes nothing, --apply hides with a reason and rebuilds, --unhide brings them back", async () => {
  const [{ mkdtemp, writeFile, rm }, { tmpdir }, { join }] = await Promise.all([import("node:fs/promises"), import("node:os"), import("node:path")]);
  const ids = (await sql`SELECT id FROM wall_shown ORDER BY id DESC LIMIT 3`).map((r) => r.id as string);
  const dir = await mkdtemp(join(tmpdir(), "hide-blocks-"));
  const answers = join(dir, "answers.jsonl");
  await writeFile(answers, [
    JSON.stringify({ id: ids[0], action: "hide", issue: "just-image", score: 2, reason: "a lone photo" }),
    JSON.stringify({ id: ids[1], action: "hide", issue: "logo-strip", score: 1, reason: 'only a "logo"' }),
    JSON.stringify({ id: ids[2], action: "keep", issue: "none", score: 4, reason: "fine" }),
  ].join("\n"));
  const cli = (...args: string[]) => run("npx", ["tsx", "src/hide-blocks.ts", ...args.map((a) => `"${a}"`)],
    { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: local.url }, shell: true });
  const hidden = async () => (await sql`SELECT id, wall_hidden_reason FROM blocks WHERE wall_hidden ORDER BY id`).map((r) => [r.id, r.wall_hidden_reason]);
  try {
    await cli("--from", answers);
    assert.deepEqual(await hidden(), [], "a dry run writes nothing");

    await cli("--from", answers, "--apply");
    const now = new Map(await hidden() as [string, string][]);
    assert.deepEqual([...now.keys()].sort(), [ids[0], ids[1]].sort(), "only the hide answers");
    assert.equal(now.get(ids[1]), 'review: logo-strip (1/5): only a "logo"');
    const shown = await shownIds();
    assert.ok(!shown.includes(ids[0]) && !shown.includes(ids[1]) && shown.includes(ids[2]), "the wall was rebuilt");

    await cli("--unhide", answers, "--apply");
    assert.deepEqual(await hidden(), []);
    assert.deepEqual(await shownIds(), await ruleIds());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
