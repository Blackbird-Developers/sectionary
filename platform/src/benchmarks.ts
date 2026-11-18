// Benchmarks (L4, SEC-31 brief sections 4.5 and 7.3): what is typical per
// industry, page type and viewport, and overall.
//
//   npm run benchmarks     # rebuild the benchmarks table
//
// One value per store and group: a store with two collection pages counts once,
// at the median of its pages. Numeric metrics get n and quartiles, categorical
// ones the share of stores per value, and every block type the share of stores
// that have it on the page type and its median position (from the tagger's
// block_type, so empty until tagging runs). A row is stored only when at least
// MIN_BENCHMARK_N stores were measured. Run after `npm run profile-sites`,
// after every import.
//
// Page length, block count and images per screen come from every capture; the
// rest needs page styles (captures made with --styles).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import type { Viewport } from "../../web/src/contracts/block.js";
import {
  CATEGORICAL_BENCHMARKS, MIN_BENCHMARK_N, NUMERIC_BENCHMARKS, type CategoricalBenchmark, type NumericBenchmark,
} from "../../web/src/contracts/design.js";
import type { PageStyles } from "../../web/src/contracts/manifest.js";
import { median } from "./design-profile.js";

/** CSS viewport heights the crawler captures at (src/capture-page.ts), for page length without page styles. */
const VIEWPORT_HEIGHT: Record<Viewport, number> = { desktop: 900, mobile: 844 };

/** The metric names live in the contract, so the MCP server validates against the same list. */
export const NUMERIC_METRICS = Object.keys(NUMERIC_BENCHMARKS) as NumericBenchmark[];
export const CATEGORICAL_METRICS = Object.keys(CATEGORICAL_BENCHMARKS) as CategoricalBenchmark[];
export type NumericMetric = NumericBenchmark;
export type CategoricalMetric = CategoricalBenchmark;

/** One captured page at one viewport, as the job reads it. */
export type PageFacts = {
  host: string;
  industry: string;
  pageType: string;
  viewport: Viewport;
  /** Full page height in CSS pixels, from the capture. */
  fullHeight: number | null;
  blocks: number;
  images: number;
  styles: PageStyles | null;
  /** Tagged block types on the page with their first position (the block index as captured, 1 for the top block). */
  blockTypes: Record<string, number>;
};

export type BenchmarkRow = {
  industry: string; pageType: string; viewport: Viewport; metric: string; n: number;
  p25: number | null; p50: number | null; p75: number | null; shares: Record<string, number> | null;
};

// ---------------------------------------------------------------- what one page says

const SERIF = /\b(serif|times|georgia|garamond|baskerville|caslon|didot|bodoni|playfair|lora|merriweather|canela|tiempos|freight|cormorant|crimson|spectral|fraunces|libre caslon|minion|domaine|ogg|chronicle|sabon|bembo|cardo|prata|gilda|noto serif|source serif|pt serif|dm serif|ibm plex serif|roboto slab|zilla slab|arvo|rockwell)\b/i;
const SANS = /\b(sans|grotesk|grotesque|helvetica|arial|inter|roboto|open sans|lato|montserrat|poppins|nunito|work sans|raleway|futura|avenir|proxima|gotham|graphik|circular|manrope|dm sans|figtree|jost|outfit|karla|rubik|mulish|barlow|ubuntu|segoe|system-ui|-apple-system|neue haas|aktiv|gt america|gt walsheim|founders grotesk|apercu|brandon|gill|frutiger|univers|verdana|tahoma|trebuchet|quicksand|josefin|archivo|hanken|plus jakarta|sora|lexend|space grotesk|ibm plex sans|noto sans|source sans|pt sans)\b/i;
const DISPLAY = /\b(display|bebas|anton|oswald|lobster|pacifico|abril|righteous|bangers|monoton|alfa slab|fredoka|luckiest|happy monkey|permanent marker|caveat|dancing script|great vibes|satisfy|shrikhand|chango|bungee|cooper|recoleta|grandstander|chewy|sniglet)\b/i;

/**
 * A family name's class, from a fixed list of known families. "other" when the
 * name is not on it: the measurement is a name, so we do not guess its design.
 */
export function familyClass(family: string | null | undefined): "serif" | "sans" | "display" | "other" | null {
  if (!family) return null;
  if (DISPLAY.test(family)) return "display";
  if (/\bsans\b/i.test(family)) return "sans";
  if (SERIF.test(family)) return "serif";
  if (SANS.test(family)) return "sans";
  return "other";
}

export function numericOf(p: PageFacts): Record<NumericMetric, number | null> {
  const s = p.styles;
  const screens = s?.layout.screens ?? (p.fullHeight ? Math.round((p.fullHeight / VIEWPORT_HEIGHT[p.viewport]) * 10) / 10 : null);
  const primary = s && s.buttons.primary !== null ? s.buttons.variants[s.buttons.primary] ?? null : null;
  const headingSizes = s?.headings.levels.filter((l) => l.count > 0 && l.size !== null).map((l) => l.size!) ?? [];
  return {
    "body-size": s?.typography.bodySize ?? null,
    "largest-heading-size": headingSizes.length ? Math.max(...headingSizes) : null,
    screens,
    blocks: p.blocks,
    "words-per-screen": s?.layout.wordsPerScreen ?? null,
    "images-per-screen": s?.layout.imagesPerScreen ?? (screens ? Math.round((p.images / screens) * 100) / 100 : null),
    "button-height": primary?.height ?? null,
    "button-radius": primary?.radius ?? null,
    "grid-columns": s?.layout.gridColumns ?? null,
    "contrast-pass": s?.colour.contrastPass ?? null,
    "alt-share": s?.accessibility.altShare ?? null,
  };
}

export function categoricalOf(p: PageFacts): Record<CategoricalMetric, string | null> {
  const s = p.styles;
  if (!s) return { "heading-family-class": null, "radius-label": null, "uppercase-headings": null, "button-case": null };
  const top = s.headings.levels.find((l) => l.count > 0 && l.family);
  const primary = s.buttons.primary !== null ? s.buttons.variants[s.buttons.primary] ?? null : null;
  return {
    "heading-family-class": familyClass(top?.family),
    "radius-label": s.shape.label,
    "uppercase-headings": s.typography.headingUppercaseShare === null ? null : s.typography.headingUppercaseShare >= 0.5 ? "yes" : "no",
    "button-case": primary?.case ?? null,
  };
}

// ---------------------------------------------------------------- statistics

/** Linear-interpolation quantile (R type 7), rounded to 2 decimals. */
export function quantile(values: number[], q: number): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (v.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return Math.round((v[lo] + (v[hi] - v[lo]) * (at - lo)) * 100) / 100;
}

const share = (k: number, n: number) => Math.round((k / n) * 1000) / 1000;

// ---------------------------------------------------------------- the table

/**
 * Every benchmark row the pages support. Groups are industry (and "all") ×
 * page type (and "all") × viewport; within a group each store contributes one
 * value per metric, the median of its pages. Rows under MIN_BENCHMARK_N stores
 * are left out.
 */
export function computeBenchmarks(pages: PageFacts[], minN = MIN_BENCHMARK_N): BenchmarkRow[] {
  type Group = { industry: string; pageType: string; viewport: Viewport; stores: Map<string, PageFacts[]> };
  const groups = new Map<string, Group>();
  for (const p of pages) {
    for (const industry of new Set([p.industry, "all"])) for (const pageType of new Set([p.pageType, "all"])) {
      const key = `${industry}|${pageType}|${p.viewport}`;
      if (!groups.has(key)) groups.set(key, { industry, pageType, viewport: p.viewport, stores: new Map() });
      const g = groups.get(key)!;
      g.stores.set(p.host, [...(g.stores.get(p.host) ?? []), p]);
    }
  }

  const rows: BenchmarkRow[] = [];
  for (const g of [...groups.values()].sort((a, b) => `${a.industry}|${a.pageType}|${a.viewport}`.localeCompare(`${b.industry}|${b.pageType}|${b.viewport}`))) {
    const base = { industry: g.industry, pageType: g.pageType, viewport: g.viewport };
    const stores = [...g.stores.values()];

    for (const metric of NUMERIC_METRICS) {
      const values = stores.map((ps) => median(ps.map((p) => numericOf(p)[metric]))).filter((v): v is number => v !== null);
      if (values.length < minN) continue;
      rows.push({ ...base, metric, n: values.length, p25: quantile(values, 0.25), p50: quantile(values, 0.5), p75: quantile(values, 0.75), shares: null });
    }

    for (const metric of CATEGORICAL_METRICS) {
      // A store's value is its most common one across its pages; ties go to the alphabetically first.
      const values = stores.map((ps) => {
        const counts = new Map<string, number>();
        for (const p of ps) { const v = categoricalOf(p)[metric]; if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
        return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      }).filter((v): v is string => v !== null);
      if (values.length < minN) continue;
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const shares = Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, c]) => [v, share(c, values.length)]));
      rows.push({ ...base, metric, n: values.length, p25: null, p50: null, p75: null, shares });
    }

    // Block types: per page type only ("all" pages mixes a footer on every page with a buy box on one).
    if (g.pageType === "all" || stores.length < minN) continue;
    const types = new Set(stores.flatMap((ps) => ps.flatMap((p) => Object.keys(p.blockTypes))));
    for (const type of [...types].sort()) {
      const positions = stores
        .map((ps) => median(ps.map((p) => p.blockTypes[type])))
        .filter((v): v is number => v !== null);
      rows.push({
        ...base, metric: `block:${type}`, n: stores.length,
        p25: quantile(positions, 0.25), p50: quantile(positions, 0.5), p75: quantile(positions, 0.75),
        shares: { present: share(positions.length, stores.length) },
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- the database

/** Every latest capture of every page, both viewports, with what the metrics need. */
export async function pageFacts(sql: postgres.Sql): Promise<PageFacts[]> {
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (c.page_id) c.id, c.page_id, c.desktop, c.mobile, c.page_styles
      FROM captures c ORDER BY c.page_id, c.captured_at DESC
    )
    SELECT s.host, s.industry, p.type AS page_type, vp.viewport,
      (CASE vp.viewport WHEN 'desktop' THEN l.desktop ELSE l.mobile END)->>'fullHeight' AS full_height,
      l.page_styles->vp.viewport AS styles,
      (SELECT count(*)::int FROM blocks b WHERE b.capture_id = l.id AND b.viewport = vp.viewport) AS blocks,
      (SELECT coalesce(sum(b.images), 0)::int FROM blocks b WHERE b.capture_id = l.id AND b.viewport = vp.viewport) AS images,
      (SELECT coalesce(jsonb_object_agg(t.block_type, t.position), '{}'::jsonb) FROM (
         SELECT b.block_type, min(b.block_index) AS position FROM blocks b
         WHERE b.capture_id = l.id AND b.viewport = vp.viewport AND b.block_type IS NOT NULL GROUP BY b.block_type) t) AS block_types
    FROM latest l JOIN pages p ON p.id = l.page_id JOIN sites s ON s.id = p.site_id
    CROSS JOIN (VALUES ('desktop'), ('mobile')) AS vp(viewport)
    ORDER BY s.host, p.type, p.url, vp.viewport`;
  return rows
    .filter((r) => Number(r.blocks) > 0)
    .map((r) => ({
      host: String(r.host), industry: String(r.industry ?? "other"), pageType: String(r.page_type), viewport: r.viewport as Viewport,
      fullHeight: r.full_height === null ? null : Number(r.full_height), blocks: Number(r.blocks), images: Number(r.images),
      styles: (r.styles as PageStyles | null) ?? null, blockTypes: (r.block_types as Record<string, number>) ?? {},
    }));
}

/** Rebuilds the table in one transaction, so readers never see it half done. Returns the rows written. */
export async function rebuildBenchmarks(sql: postgres.Sql, minN = MIN_BENCHMARK_N): Promise<number> {
  const rows = computeBenchmarks(await pageFacts(sql), minN);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM benchmarks`;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({
        industry: r.industry, page_type: r.pageType, viewport: r.viewport, metric: r.metric, n: r.n,
        p25: r.p25, p50: r.p50, p75: r.p75, shares: r.shares === null ? null : tx.json(r.shares),
      }));
      await tx`INSERT INTO benchmarks ${tx(chunk, "industry", "page_type", "viewport", "metric", "n", "p25", "p50", "p75", "shares")}`;
    }
  });
  return rows.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    console.log(`Wrote ${await rebuildBenchmarks(sql)} benchmark rows (groups of at least ${MIN_BENCHMARK_N} stores).`);
  } finally { await sql.end(); }
}
