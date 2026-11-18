// npm test: store design profiles (SEC-31 brief 4.4) from the real --styles
// fixture, pure and through the importer into a throwaway Postgres.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import type { Manifest } from "../../web/src/contracts/manifest.js";
import type { StoreDesignProfile } from "../../web/src/contracts/design.js";
import { buildDesignProfile, designSummary, median, mode, radiusLabel } from "./design-profile.js";
import { startLocalDb, type LocalDb } from "./local-db.js";
import { profileSites } from "./profile.js";

const run = promisify(execFile);
const fixtures = resolve(import.meta.dirname, "../../fixtures/manifests");
const stylesManifest = resolve(fixtures, "myzoobox.com/products-zoologist-club-styles/manifest.json");

test("small statistics", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, null, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(mode(["a", "b", "b", null]), "b");
  assert.equal(mode(["a", "b"]), "a");
  assert.equal(radiusLabel(24, 48), "pill");
  assert.equal(radiusLabel(2), "sharp");
  assert.equal(radiusLabel(6), "soft");
  assert.equal(radiusLabel(12), "rounded");
  assert.equal(radiusLabel(null), null);
});

test("a profile from the myzoobox.com product page (--styles fixture)", async () => {
  const m = JSON.parse(await readFile(stylesManifest, "utf8")) as Manifest;
  const p = buildDesignProfile([{ pageType: "product", url: m.page.url, capturedAt: m.page.capturedAt, styles: m.pageStyles!, productRatios: ["1:1", "1:1", "4:3"] }], "2026-11-17T00:00:00.000Z")!;
  assert.equal(p.version, 1);
  assert.equal(p.typography.heading, "Poppins", "h1 and h3 text outweighs the small Happy Monkey labels");
  assert.equal(p.typography.body, "Poppins");
  assert.deepEqual(p.typography.bodySize, { desktop: 15, mobile: 14 });
  assert.deepEqual(p.headings.map((h) => h.pages), [2, 0, 2, 2, 0, 0]);
  assert.deepEqual(p.headings[0].size, { desktop: 36, mobile: 36 });
  assert.equal(p.headings[0].weight, 900);
  assert.equal(p.headings[1].distinctSizes, 0);
  assert.deepEqual(p.accent, { colour: "#258d8f", bucket: "teal" });
  assert.equal(p.palette.find((c) => c.role === "background")?.colour, "#ffffff");
  assert.equal(p.buttons.primary?.height, 53);
  assert.equal(p.buttons.primary?.case, "uppercase");
  assert.ok(p.buttons.secondary);
  assert.equal(p.shape.label, "rounded", "desktop first");
  assert.equal(p.spacing.contentWidth, 1260, "spacing from desktop when there is desktop");
  assert.deepEqual(p.layout.productImageRatios, ["1:1", "4:3"]);
  assert.deepEqual(p.layout.pages, [{ pageType: "product", viewport: "desktop", screens: 4.1, blocks: 5 }, { pageType: "product", viewport: "mobile", screens: 6, blocks: 5 }]);
  assert.equal(p.accessibility.tapTargets, 0.23);
  assert.equal(p.accessibility.headingOrderValid, 0);
  assert.equal(p.accessibility.lang, true);
  assert.equal(p.consistency.families, 2);
  assert.equal(
    p.summary,
    "Headings and body in Poppins; headings 900, body 15px. Type scale 12, 13, 14, 15, 16, 17, 18, 24, 30, 36. " +
      "Dark grey text on white, accent teal #258d8f for buttons. Rounded buttons, 53px tall, uppercase labels. Product images 1:1.",
  );
  assert.equal(designSummary(p), p.summary, "the same numbers give the same words");
  assert.ok(!/class|<[a-z]|font-face|url\(|\.woff/i.test(JSON.stringify(p)), "measurements only, no source");
});

test("no page styles, no profile", () => {
  assert.equal(buildDesignProfile([]), null);
  assert.equal(buildDesignProfile([{ pageType: "home", url: "https://x.test/", capturedAt: "2026-01-01T00:00:00Z", styles: {} }]), null);
});

let local: LocalDb;
let sql: postgres.Sql;
before(async () => {
  local = await startLocalDb();
  sql = postgres(local.url, { max: 2, prepare: false, onnotice: () => {} });
  // The real importer, pointed at the throwaway database (an environment variable wins over platform/.env).
  for (const store of ["myzoobox.com", "typology.com"]) {
    await run("npx", ["tsx", "src/import.ts", resolve(fixtures, store)],
      { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: local.url }, shell: true, maxBuffer: 1 << 26 });
  }
});
after(async () => { await sql?.end(); await local?.stop(); });

test("profile-sites writes a profile only for stores with page styles", async () => {
  assert.equal(await profileSites(sql), 1);
  const rows = await sql`SELECT host, design_profile, design_profile_at FROM sites ORDER BY host`;
  const zoo = rows.find((r) => r.host === "myzoobox.com")!, others = rows.filter((r) => r.host !== "myzoobox.com");
  const profile = zoo.design_profile as StoreDesignProfile;
  assert.ok(zoo.design_profile_at instanceof Date);
  assert.deepEqual(profile.sources.map((s) => s.pageType), ["product"], "the latest capture with page styles per page type");
  assert.equal(profile.typography.heading, "Poppins");
  assert.ok(profile.summary.startsWith("Headings and body in Poppins"));
  assert.ok(others.length >= 1);
  assert.ok(others.every((r) => r.design_profile === null), "captured without --styles: null, never estimated");
  assert.equal(await profileSites(sql, { host: String(others[0].host) }), 0);
});
