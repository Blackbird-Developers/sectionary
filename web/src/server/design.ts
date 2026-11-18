import type { Viewport } from "@/contracts/block";
import type { Benchmark, StoreDesignProfile } from "@/contracts/design";
import type { PageStyles } from "@/contracts/manifest";
import { database, pgArray } from "@/server/db";

// Design data readers (SEC-31): store design profiles (L3), page profiles
// (L2), page flows and benchmarks (L4). Shared by the MCP server and, later,
// the API routes of brief section 8, so both serve the same numbers.
// Measurements only: nothing here selects a block element's tag, id or classes.

type Sql = ReturnType<typeof database>;

/** Where design data would be, until a capture made with --styles is imported (brief section 7.5). */
export const DESIGN_NOTE = "no capture of this store was made with design metadata yet; it fills in at the next recapture";
export const PAGE_STYLE_NOTE = "this page was captured before design metadata was collected";

export const normalHost = (host: string) => host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

async function siteOf(sql: Sql, host: string) {
  const h = normalHost(host);
  const [site] = await sql`SELECT id, host, brand, industry, design_profile, design_profile_at FROM sites WHERE host=${h} OR host=${`www.${h}`} ORDER BY host=${h} DESC LIMIT 1`;
  return site ?? null;
}

/**
 * The accessibility signals are signals, not an audit: a store's own go only
 * to signed-in accounts and MCP keys (owner decision, brief section 12 item 5).
 */
export function withoutAccessibility<T extends { accessibility?: unknown }>(value: T): Omit<T, "accessibility"> & { accessibility: null; accessibility_note: string } {
  const { accessibility: _, ...rest } = value;
  void _;
  return { ...rest, accessibility: null, accessibility_note: "accessibility signals are shown to signed-in accounts" };
}

export type StoreDesign = {
  host: string;
  brand: string;
  industry: string | null;
  design: StoreDesignProfile | null;
  built_at: string | null;
  design_note?: string;
};

export async function storeDesign(host: string): Promise<StoreDesign | null> {
  const site = await siteOf(database(), host);
  if (!site) return null;
  const design = (site.design_profile as StoreDesignProfile | null) ?? null;
  return {
    host: String(site.host), brand: String(site.brand ?? site.host), industry: (site.industry as string | null) ?? null,
    design, built_at: site.design_profile_at ? (site.design_profile_at as Date).toISOString() : null,
    ...(design ? {} : { design_note: DESIGN_NOTE }),
  };
}

export type PageProfile = {
  host: string;
  page_type: string;
  page_url: string;
  captured_at: string;
  /** Page styles per viewport; a viewport is null when its capture lacked them. */
  profiles: Partial<Record<Viewport, PageStyles | null>>;
  profile_note?: string;
  /** Other pages of this type the store has, by URL, when there are several. */
  other_pages: string[];
};

/**
 * The page profile (L2) of a store's page type: the latest capture with page
 * styles of the page of that type captured most recently; failing that, the
 * latest capture at all, with null profiles and a note.
 */
export async function pageProfile(host: string, pageType: string, viewport?: Viewport): Promise<PageProfile | null> {
  const sql = database();
  const site = await siteOf(sql, host);
  if (!site) return null;
  const rows = await sql`
    SELECT p.url, c.captured_at, c.page_styles FROM pages p JOIN captures c ON c.page_id = p.id
    WHERE p.site_id = ${site.id} AND p.type = ${pageType}
    ORDER BY (c.page_styles IS NOT NULL) DESC, c.captured_at DESC, p.url`;
  if (!rows.length) return null;
  const [best] = rows;
  const styles = (best.page_styles as Partial<Record<Viewport, PageStyles>> | null) ?? null;
  const vps: Viewport[] = viewport ? [viewport] : ["desktop", "mobile"];
  const profiles = Object.fromEntries(vps.map((vp) => [vp, styles?.[vp] ?? null])) as PageProfile["profiles"];
  return {
    host: String(site.host), page_type: pageType, page_url: String(best.url), captured_at: (best.captured_at as Date).toISOString(),
    profiles, ...(Object.values(profiles).some(Boolean) ? {} : { profile_note: PAGE_STYLE_NOTE }),
    other_pages: [...new Set(rows.map((r) => String(r.url)))].filter((u) => u !== best.url),
  };
}

export const FLOW_PAGE_TYPES = ["home", "collection", "product", "cart"] as const;
/** At most this many blocks of one page in a flow; the rest is counted. */
export const FLOW_MAX_BLOCKS = 20;

export type FlowStep = {
  page_type: string;
  page_url: string;
  captured_at: string;
  viewport: Viewport;
  blocks: { id: string; position: number; block_type: string | null; type_hint: string; headline: string | null; height: number }[];
  more_blocks: number;
};

/** Home, collection, product, cart: each page's latest capture, its blocks in order. Pages the store lacks are left out. */
export async function storeFlow(host: string, viewport: Viewport): Promise<{ host: string; steps: FlowStep[]; missing: string[] } | null> {
  const sql = database();
  const site = await siteOf(sql, host);
  if (!site) return null;
  const pages = await sql`
    SELECT DISTINCT ON (p.type) p.type, p.url, c.id AS capture_id, c.captured_at
    FROM pages p JOIN LATERAL (SELECT * FROM captures WHERE page_id = p.id ORDER BY captured_at DESC LIMIT 1) c ON true
    WHERE p.site_id = ${site.id} AND p.type = ANY(${pgArray(FLOW_PAGE_TYPES)}::text[])
    ORDER BY p.type, c.captured_at DESC, p.url`;
  const steps: FlowStep[] = [];
  for (const type of FLOW_PAGE_TYPES) {
    const page = pages.find((p) => p.type === type);
    if (!page) continue;
    const blocks = await sql`SELECT b.id, b.block_index, b.block_type, b.type_hint, b.headline, b.height FROM blocks b
      WHERE b.capture_id = ${page.capture_id} AND b.viewport = ${viewport} ORDER BY b.block_index`;
    steps.push({
      page_type: type, page_url: String(page.url), captured_at: (page.captured_at as Date).toISOString(), viewport,
      blocks: blocks.slice(0, FLOW_MAX_BLOCKS).map((b) => ({
        id: String(b.id), position: Number(b.block_index), block_type: (b.block_type as string | null) ?? null, type_hint: String(b.type_hint),
        headline: b.headline ? String(b.headline).replace(/\s+/g, " ").trim().slice(0, 120) : null, height: Number(b.height),
      })),
      more_blocks: Math.max(0, blocks.length - FLOW_MAX_BLOCKS),
    });
  }
  return { host: String(site.host), steps, missing: FLOW_PAGE_TYPES.filter((t) => !pages.some((p) => p.type === t)) };
}

export type BenchmarkQuery = { industry: string; pageType: string; viewport: Viewport; metrics?: string[] };

/** Stored rows (all with n ≥ MIN_BENCHMARK_N) and how many stores the group has, for an honest refusal. */
export async function benchmarks(q: BenchmarkQuery): Promise<{ rows: Benchmark[]; stores: number }> {
  const sql = database();
  const metrics = q.metrics?.length ? pgArray(q.metrics) : null;
  const [rows, [{ stores }]] = await Promise.all([
    sql`SELECT * FROM benchmarks WHERE industry = ${q.industry} AND page_type = ${q.pageType} AND viewport = ${q.viewport}
      AND (${metrics}::text[] IS NULL OR metric = ANY(${metrics}::text[])) ORDER BY metric LIKE 'block:%', metric`,
    // Stores with a captured page of this type (any type for "all") and blocks at this viewport.
    sql`SELECT count(DISTINCT s.id)::int AS stores FROM sites s JOIN pages p ON p.site_id = s.id JOIN captures c ON c.page_id = p.id
      WHERE (${q.industry} = 'all' OR s.industry = ${q.industry}) AND (${q.pageType} = 'all' OR p.type = ${q.pageType})
        AND EXISTS (SELECT 1 FROM blocks b WHERE b.capture_id = c.id AND b.viewport = ${q.viewport})`,
  ]);
  return {
    rows: rows.map((r) => ({
      industry: String(r.industry), pageType: String(r.page_type), viewport: r.viewport as Viewport, metric: String(r.metric), n: Number(r.n),
      p25: r.p25 === null ? null : Number(r.p25), p50: r.p50 === null ? null : Number(r.p50), p75: r.p75 === null ? null : Number(r.p75),
      shares: (r.shares as Record<string, number> | null) ?? null, computedAt: (r.computed_at as Date).toISOString(),
    })),
    stores: Number(stores),
  };
}
