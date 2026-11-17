// npm test: clips (migration 0015), the importer's mapping and the columns on a real Postgres (PGlite).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { startLocalDb, type LocalDb } from "./local-db.js";
import { clipOf, type UploadedClip } from "./clips.js";
import type { ManifestClip } from "../../web/src/contracts/manifest.js";

const clip: ManifestClip = { kind: "video", file: "blocks/d-02-hero.mp4", width: 1080, height: 518, durationMs: 5012, bytes: 1131155, rect: { x: 0, y: 0, width: 1440, height: 691 } };
const uploaded: Record<string, UploadedClip> = { "blocks/d-02-hero.mp4": { source: "2026-11-18/myzoobox.com/home/blocks/d-02-hero.mp4", key: "2026-11-18/myzoobox.com/home/blocks/d-02-hero.mp4", bytes: 1131155 } };
const toUrl = (key: string) => `https://cdn.test/${key}`;

test("a recorded and uploaded clip is stored with its public URL", () => {
  assert.deepEqual(clipOf({ clip }, uploaded, toUrl), {
    kind: "video", url: "https://cdn.test/2026-11-18/myzoobox.com/home/blocks/d-02-hero.mp4", width: 1080, height: 518, durationMs: 5012, bytes: 1131155, rect: { x: 0, y: 0, width: 1440, height: 691 },
  });
});

test("no clip, a clip that failed to encode, or one never uploaded: null, never a broken URL", () => {
  assert.equal(clipOf({}, uploaded, toUrl), null);
  assert.equal(clipOf({ clip: { ...clip, file: null, error: "too-few-frames" } }, uploaded, toUrl), null);
  assert.equal(clipOf({ clip }, {}, toUrl), null);
});

let local: LocalDb;
let sql: postgres.Sql;
before(async () => {
  local = await startLocalDb();
  sql = postgres(local.url, { max: 2, prepare: false, onnotice: () => {} });
});
after(async () => {
  await sql.end();
  await local.stop();
});

test("blocks keep motion_hint and clip, and blocks without them read null", async () => {
  const [site] = await sql`INSERT INTO sites (host, origin) VALUES ('myzoobox.com', 'https://myzoobox.com') RETURNING id`;
  const [page] = await sql`INSERT INTO pages (site_id, url, type, slug) VALUES (${site.id}, 'https://myzoobox.com/', 'home', 'home') RETURNING id`;
  const [capture] = await sql`INSERT INTO captures (page_id, captured_at) VALUES (${page.id}, now()) RETURNING id`;
  const stored = clipOf({ clip }, uploaded, toUrl)!;
  const insert = (index: number, motion: string | null, value: object | null) => sql`
    INSERT INTO blocks (capture_id, ref, block_index, viewport, type_hint, top, height, width, text, text_length, buttons, images, videos, background, motion_hint, clip)
    VALUES (${capture.id}, ${`b${index}`}, ${index}, 'desktop', 'hero', 0, 691, 1440, '', 0, 0, 0, 1, '#fff', ${motion}, ${value ? sql.json(value as never) : null})`;
  await insert(2, "video", stored);
  await insert(3, "carousel", null);
  await insert(4, null, null);
  const rows = await sql`SELECT block_index, motion_hint, clip FROM blocks WHERE capture_id = ${capture.id} ORDER BY block_index`;
  assert.deepEqual(rows.map((r) => [r.block_index, r.motion_hint, r.clip]), [[2, "video", stored], [3, "carousel", null], [4, null, null]]);
});
