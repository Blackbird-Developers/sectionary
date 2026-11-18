// npm test: benchmarks (SEC-31 brief 4.5), pure and over every fixture store
// imported into a throwaway Postgres.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { computeBenchmarks, familyClass, quantile, rebuildBenchmarks, type PageFacts } from "./benchmarks.js";
import { startLocalDb, type LocalDb } from "./local-db.js";

const run = promisify(execFile);

const page = (host: string, over: Partial<PageFacts> = {}): PageFacts => ({
  host, industry: "pets", pageType: "product", viewport: "desktop", fullHeight: 4500, blocks: 8, images: 10, styles: null, blockTypes: {}, ...over,
});

test("quartiles and family classes", () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(quantile([], 0.5), null);
  assert.equal(familyClass("Canela Deck"), "serif");
  assert.equal(familyClass("Poppins"), "sans");
  assert.equal(familyClass("Noto Sans Display"), "display");
  assert.equal(familyClass("PT Sans"), "sans");
  assert.equal(familyClass("Happy Monkey"), "display");
  assert.equal(familyClass("Brand Custom Face"), "other", "an unknown name is not guessed");
  assert.equal(familyClass(null), null);
});

test("one value per store, n with every row, nothing under 10 stores", () => {
  // Ten stores; store-0 has two product pages (8 and 12 blocks), counted once at 10.
  const pages = Array.from({ length: 10 }, (_, i) => page(`store-${i}.test`, { blocks: 5 + i, blockTypes: i < 4 ? { "product-reviews": 3 + i } : {} }));
  pages[0] = page("store-0.test", { blocks: 8 });
  pages.push(page("store-0.test", { blocks: 12 }));
  const rows = computeBenchmarks(pages);
  const blocks = rows.find((r) => r.industry === "pets" && r.pageType === "product" && r.metric === "blocks")!;
  assert.equal(blocks.n, 10);
  assert.deepEqual([blocks.p25, blocks.p50, blocks.p75], [8.25, 10, 11.75], "store-0 counts once, at 10");
  assert.ok(rows.some((r) => r.industry === "all" && r.pageType === "all" && r.metric === "blocks"));
  assert.ok(!rows.some((r) => r.metric === "body-size"), "no page styles, no body-size row");
  const reviews = rows.find((r) => r.pageType === "product" && r.industry === "pets" && r.metric === "block:product-reviews")!;
  assert.deepEqual(reviews.shares, { present: 0.3 }, "stores 1-3 have it; store-0's second page has none");
  assert.equal(reviews.p50, 5);
  assert.ok(!rows.some((r) => r.pageType === "all" && r.metric.startsWith("block:")));
  assert.equal(computeBenchmarks(pages.slice(0, 9).filter((p) => p.host !== "store-0.test")).length, 0, "eight stores: no rows at all");
});

let local: LocalDb;
let sql: postgres.Sql;
before(async () => {
  local = await startLocalDb();
  sql = postgres(local.url, { max: 2, prepare: false, onnotice: () => {} });
  await run("npx", ["tsx", "src/import.ts", resolve(import.meta.dirname, "../../fixtures/manifests")],
    { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: local.url }, shell: true, maxBuffer: 1 << 26 });
});
after(async () => { await sql?.end(); await local?.stop(); });

test("npm run benchmarks over the fixture stores", async () => {
  const written = await rebuildBenchmarks(sql);
  const rows = await sql`SELECT * FROM benchmarks ORDER BY industry, page_type, viewport, metric`;
  assert.equal(rows.length, written);
  assert.ok(rows.every((r) => r.n >= 10), "nothing under 10 stores is stored");
  const homeBlocks = rows.find((r) => r.industry === "all" && r.page_type === "home" && r.viewport === "desktop" && r.metric === "blocks");
  assert.ok(homeBlocks, "13 fixture stores have a home page");
  assert.equal(homeBlocks.n, 13);
  assert.ok(homeBlocks.p25 <= homeBlocks.p50 && homeBlocks.p50 <= homeBlocks.p75);
  assert.ok(!rows.some((r) => r.metric === "body-size"), "one store with page styles: no style benchmarks yet");
  assert.ok(!rows.some((r) => r.metric.startsWith("block:")), "untagged library: no block-type rows");
  assert.equal(await rebuildBenchmarks(sql), written, "rebuilding gives the same table");

  // With the floor at 1, the one --styles store gives style rows: shares are stored as JSON objects.
  await rebuildBenchmarks(sql, 1);
  const [radius] = await sql`SELECT * FROM benchmarks WHERE industry='all' AND page_type='product' AND viewport='desktop' AND metric='radius-label'`;
  assert.deepEqual(radius.shares, { rounded: 1 });
  const [body] = await sql`SELECT * FROM benchmarks WHERE industry='all' AND page_type='product' AND viewport='desktop' AND metric='body-size'`;
  assert.equal(body.n, 1);
  assert.equal(body.p50, 15);
  await rebuildBenchmarks(sql);

  // Labels as the rule tagger writes them (rules-v1): the first block of every home page is the header,
  // and on stores whose name sorts before "n" the last one is labelled footer.
  await sql`UPDATE blocks b SET block_type = 'header-navigation', tag_model = 'rules-v1',
      ai_response = jsonb_build_object('source', 'rules', 'prompt_version', 'rules-v1', 'block_type', 'header-navigation')
    FROM captures c JOIN pages p ON p.id = c.page_id WHERE c.id = b.capture_id AND p.type = 'home'
      AND b.block_index = (SELECT min(b2.block_index) FROM blocks b2 WHERE b2.capture_id = b.capture_id AND b2.viewport = b.viewport)`;
  await sql`UPDATE blocks b SET block_type = 'footer', tag_model = 'rules-v1'
    FROM captures c JOIN pages p ON p.id = c.page_id JOIN sites s ON s.id = p.site_id
    WHERE c.id = b.capture_id AND p.type = 'home' AND s.host < 'n'
      AND b.block_index = (SELECT max(b2.block_index) FROM blocks b2 WHERE b2.capture_id = b.capture_id AND b2.viewport = b.viewport)`;
  await rebuildBenchmarks(sql);
  const [header] = await sql`SELECT * FROM benchmarks WHERE industry='all' AND page_type='home' AND viewport='desktop' AND metric='block:header-navigation'`;
  assert.equal(header.n, 13);
  assert.deepEqual(header.shares, { present: 1 });
  const [{ first }] = await sql`SELECT min(block_index)::int AS first FROM blocks`;
  assert.equal(header.p50, first, "first on the page");
  const [footer] = await sql`SELECT * FROM benchmarks WHERE industry='all' AND page_type='home' AND viewport='desktop' AND metric='block:footer'`;
  const [{ k }] = await sql`SELECT count(DISTINCT s.host)::int AS k FROM sites s JOIN pages p ON p.site_id = s.id WHERE p.type = 'home' AND s.host < 'n'`;
  assert.deepEqual(footer.shares, { present: Math.round((k / 13) * 1000) / 1000 });
  assert.ok(footer.p50 > 0);
});
