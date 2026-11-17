// Store design profiles (L3, SEC-31 brief sections 4.4 and 7.3).
//
//   npm run profile-sites                 # every store with page styles
//   npm run profile-sites -- --host x.com # one store
//
// For each store, reads the latest capture with page styles of each page type,
// builds the profile and its template summary (design-profile.ts, no AI call)
// and writes sites.design_profile. Stores with no capture made with --styles
// keep a null profile: nothing is estimated. Run after every import, before
// `npm run benchmarks`.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import type { Viewport } from "../../web/src/contracts/block.js";
import type { PageStyles } from "../../web/src/contracts/manifest.js";
import { buildDesignProfile, type ProfileInput } from "./design-profile.js";

/** The inputs for one store: per page type, the latest capture that carries page styles. */
export async function profileInputs(sql: postgres.Sql, siteId: string): Promise<ProfileInput[]> {
  const rows = await sql`
    SELECT DISTINCT ON (p.type) p.type, p.url, c.id AS capture_id, c.captured_at, c.page_styles
    FROM captures c JOIN pages p ON p.id = c.page_id
    WHERE p.site_id = ${siteId} AND c.page_styles IS NOT NULL
    ORDER BY p.type, c.captured_at DESC, p.url`;
  if (!rows.length) return [];
  // Product imagery: the most common image ratio of each block that shows a price or product cards, on product and collection pages.
  const ratios = await sql`
    SELECT capture_id, style->'imagery'->>'ratio' AS ratio FROM blocks
    WHERE capture_id = ANY(${`{${rows.map((r) => r.capture_id).join(",")}}`}::uuid[]) AND style->'imagery'->>'ratio' IS NOT NULL
      AND (coalesce((style->'commerce'->>'price')::boolean, false) OR coalesce((style->'commerce'->>'products')::int, 0) > 0)`;
  return rows.map((r) => ({
    pageType: String(r.type),
    url: String(r.url),
    capturedAt: (r.captured_at as Date).toISOString(),
    styles: r.page_styles as Partial<Record<Viewport, PageStyles>>,
    productRatios: ["product", "collection"].includes(String(r.type))
      ? ratios.filter((x) => x.capture_id === r.capture_id).map((x) => String(x.ratio)) : [],
  }));
}

/** Builds and stores the profile of every store with page styles (or one host). Returns how many were written. */
export async function profileSites(sql: postgres.Sql, opts: { host?: string; log?: (line: string) => void } = {}): Promise<number> {
  const log = opts.log ?? (() => {});
  const host = opts.host?.toLowerCase() ?? null;
  const sites = await sql`
    SELECT s.id, s.host FROM sites s
    WHERE (${host}::text IS NULL OR s.host = ${host})
      AND EXISTS (SELECT 1 FROM pages p JOIN captures c ON c.page_id = p.id WHERE p.site_id = s.id AND c.page_styles IS NOT NULL)
    ORDER BY s.host`;
  let written = 0;
  for (const site of sites) {
    const profile = buildDesignProfile(await profileInputs(sql, site.id));
    if (!profile) continue;
    await sql`UPDATE sites SET design_profile = ${sql.json(JSON.parse(JSON.stringify(profile)))}, design_profile_at = now(), updated_at = now() WHERE id = ${site.id}`;
    written += 1;
    log(`  ${site.host}: ${profile.sources.length} page type(s). ${profile.summary}`);
  }
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
  const at = process.argv.indexOf("--host");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const n = await profileSites(sql, { host: at >= 0 ? process.argv[at + 1] : undefined, log: console.log });
    console.log(`Wrote ${n} store design profile(s).`);
  } finally { await sql.end(); }
}
