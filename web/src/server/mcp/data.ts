import { database, pgArray } from "@/server/db";
import { blockJoins, blockWhere, UUID, withColours, type BlockFilters } from "@/server/blocks";
import { searchBlocks, type ExtraWhere } from "@/server/search";
import { latestPages, toStore } from "@/server/sites";
import { assetUrl } from "@/lib/data-source";
import { clip, MAX_TEXT } from "@/server/mcp/shape";

// What the MCP tools read (SEC-31, brief section 9). The same tables, joins
// and filters as the wall and the API, so an agent and a person see the same
// library. Measurements and our own screenshots only: no query here selects a
// block element's tag, id or classes (brief section 3).

type Sql = ReturnType<typeof database>;

/** Shown wherever design metadata would be, until captures carry it (brief section 7.5). */
export const STYLE_NOTE = "captured before design metadata was collected";
/** Shown wherever tagger output would be, for blocks the tagger has not reached. */
export const UNTAGGED_NOTE = "not tagged yet: block_type is null and type_hint is the theme's own section name";

const MCP_COLUMNS = (sql: Sql) => sql`b.id, s.host, s.brand, s.industry, s.platform, s.theme_name, s.apps,
  p.type AS page_type, p.url AS page_url, c.captured_at, b.viewport, b.block_index, b.type_hint, b.block_type,
  b.headline, b.background, b.width, b.height, b.image_key, b.thumbnail_key, b.buttons, b.images, b.videos,
  b.ai_description, b.tags AS style_tags, b.ai_response->>'page_role' AS page_role, b.ai_response->'patterns' AS patterns,
  (b.ai_response->>'has_price')::boolean AS has_price, (b.ai_response->>'has_reviews')::boolean AS has_reviews,
  b.ai_response->>'prompt_version' AS tagger_version, left(b.text, ${MAX_TEXT}) AS text, b.style, b.outline`;

export type McpBlock = {
  id: string;
  store: string;
  brand: string;
  industry: string | null;
  platform: string | null;
  page_type: string;
  page_url: string;
  viewport: string;
  position: number;
  block_type: string | null;
  type_hint: string;
  page_role: string | null;
  style_tags: string[];
  description: string | null;
  headline: string | null;
  size: { width: number; height: number };
  counts: { buttons: number; images: number; videos: number };
  has_price: boolean | null;
  has_reviews: boolean | null;
  background: string | null;
  thumbnail_url: string | null;
  captured_at: string;
  tagger_version: string | null;
  blimp_url: string;
  tag_note?: string;
  // full / get_block only
  image_url?: string | null;
  text?: string | null;
  patterns?: string[];
  theme?: string | null;
  apps?: string[];
  outline?: unknown[] | null;
  style?: Record<string, unknown> | null;
  style_note?: string;
};

function toMcpBlock(r: Record<string, unknown>, origin: string, full: boolean): McpBlock {
  const w = Number(r.width), h = Number(r.height);
  const image = r.image_key ? assetUrl(String(r.image_key)) : null;
  // A thumbnail stops 1,200px down, so a very tall block gets its full image (lib/blocks.ts thumbOf).
  const thumb = r.thumbnail_key && h <= w * 2 ? assetUrl(String(r.thumbnail_key)) : image;
  const tagged = r.block_type != null;
  const block: McpBlock = {
    id: String(r.id), store: String(r.host), brand: String(r.brand ?? r.host), industry: (r.industry as string | null) ?? null,
    platform: (r.platform as string | null) ?? null, page_type: String(r.page_type), page_url: String(r.page_url),
    viewport: String(r.viewport), position: Number(r.block_index),
    block_type: (r.block_type as string | null) ?? null, type_hint: String(r.type_hint),
    page_role: (r.page_role as string | null) ?? null, style_tags: (r.style_tags as string[] | null) ?? [],
    description: (r.ai_description as string | null) ?? null, headline: clip(r.headline as string | null, 120),
    size: { width: w, height: h }, counts: { buttons: Number(r.buttons), images: Number(r.images), videos: Number(r.videos) },
    has_price: (r.has_price as boolean | null) ?? null, has_reviews: (r.has_reviews as boolean | null) ?? null,
    background: (r.background as string | null) ?? null, thumbnail_url: thumb,
    captured_at: (r.captured_at as Date).toISOString(), tagger_version: (r.tagger_version as string | null) ?? null,
    blimp_url: `${origin}/?open=${r.id}`,
    ...(tagged ? {} : { tag_note: UNTAGGED_NOTE }),
  };
  if (!full) return block;
  return {
    ...block, image_url: image, text: clip(r.text as string | null, MAX_TEXT), patterns: (r.patterns as string[] | null) ?? [],
    theme: (r.theme_name as string | null) ?? null, apps: (r.apps as string[] | null) ?? [],
    outline: (r.outline as unknown[] | null) ?? null, style: (r.style as Record<string, unknown> | null) ?? null,
    ...(r.style ? {} : { style_note: STYLE_NOTE }),
  };
}

async function byIds(sql: Sql, ids: string[], origin: string, full: boolean): Promise<McpBlock[]> {
  if (!ids.length) return [];
  const rows = await sql`SELECT ${MCP_COLUMNS(sql)} FROM ${blockJoins(sql)} WHERE b.id=ANY(${pgArray(ids)}::uuid[])`;
  const byId = new Map(rows.map((r) => [String(r.id), toMcpBlock(r, origin, full)]));
  return ids.map((id) => byId.get(id)).filter((b): b is McpBlock => Boolean(b));
}

export type TagFilters = { styleTags?: string[]; hasPrice?: boolean; hasReviews?: boolean };

/** The tagger's fields as one condition, or undefined when none is asked for. They live in blocks.tags and blocks.ai_response. */
function tagWhere(sql: Sql, t: TagFilters): ExtraWhere | undefined {
  const parts = [
    t.styleTags?.length ? sql`coalesce(b.tags && ${pgArray(t.styleTags)}::text[], false)` : null,
    t.hasPrice !== undefined ? sql`coalesce((b.ai_response->>'has_price')::boolean, false) = ${t.hasPrice}` : null,
    t.hasReviews !== undefined ? sql`coalesce((b.ai_response->>'has_reviews')::boolean, false) = ${t.hasReviews}` : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  return parts.length ? parts.reduce((all, next) => sql`${all} AND ${next}`) : undefined;
}

export type BlockSearch = { query?: string; filters: BlockFilters; tags: TagFilters; limit: number; offset: number; full: boolean; origin: string };

/** One page of blocks: ranked by relevance with a query (server/search.ts), otherwise stores mixed in a fixed order, or page order for one store. */
export async function findBlocks(s: BlockSearch): Promise<{ items: McpBlock[]; total: number; hasMore: boolean }> {
  const sql = database();
  const f = await withColours(sql, s.filters);
  const extra = tagWhere(sql, s.tags);
  if (s.query?.trim()) {
    const found = await searchBlocks(s.query, f, s.limit, s.offset, false, extra);
    return { items: await byIds(sql, found.items.map((b) => b.id), s.origin, s.full), total: found.total, hasMore: found.nextCursor !== null };
  }
  const where = extra ? sql`${blockWhere(sql, f)} AND ${extra}` : blockWhere(sql, f);
  const order = f.host?.length ? sql`s.host, p.type, p.url, b.viewport, b.block_index, b.id` : sql`md5(b.id::text)`;
  const [rows, [{ total }]] = await Promise.all([
    sql`SELECT ${MCP_COLUMNS(sql)} FROM ${blockJoins(sql)} WHERE ${where} ORDER BY ${order} LIMIT ${s.limit} OFFSET ${s.offset}`,
    sql`SELECT count(*)::int AS total FROM ${blockJoins(sql)} WHERE ${where}`,
  ]);
  return { items: rows.map((r) => toMcpBlock(r, s.origin, s.full)), total, hasMore: s.offset + rows.length < total };
}

export async function getBlock(id: string, origin: string): Promise<McpBlock | null> {
  if (!UUID.test(id)) return null;
  const [block] = await byIds(database(), [id], origin, true);
  return block ?? null;
}

/** An app as the library spells it ("klaviyo" → "Klaviyo"): sites.apps holds display names and the filters compare exactly. Null when no store runs it. */
export async function appName(value: string): Promise<string | null> {
  const [row] = await database()`SELECT a FROM sites, unnest(apps) a WHERE lower(a)=lower(${value.trim()}) LIMIT 1`;
  return row ? String(row.a) : null;
}

/** Whether any block carries this theme section name, so a block_type filter on an untagged library still finds it. */
export async function isTypeHint(value: string): Promise<boolean> {
  const [row] = await database()`SELECT 1 FROM blocks WHERE type_hint=${value} LIMIT 1`;
  return Boolean(row);
}

export type McpStore = {
  host: string; brand: string; industry: string | null; country: string | null; platform: string | null;
  theme: string | null; builder: string | null; apps: string[]; currency: string | null; rank: number | null;
};

const toMcpStore = (r: Record<string, unknown>): McpStore => {
  const s = toStore(r);
  return { host: s.host, brand: s.brand, industry: s.industry ?? null, country: s.country, platform: s.platform, theme: s.theme,
    builder: s.builder, apps: s.apps ?? [], currency: s.currency, rank: s.rank };
};

export type StoreSearch = { query?: string; industry?: string; platform?: string; country?: string; app?: string; limit: number; offset: number };

export async function findStores(s: StoreSearch): Promise<{ items: McpStore[]; total: number; hasMore: boolean }> {
  const sql = database();
  const q = s.query?.trim() || null, industry = s.industry ?? null, platform = s.platform ?? null, country = s.country?.toUpperCase() ?? null, app = s.app ?? null;
  const rows = await sql`SELECT *, count(*) OVER()::int AS total FROM sites
    WHERE (${platform}::text IS NULL OR platform=${platform}) AND (${industry}::text IS NULL OR industry=${industry})
      AND (${country}::text IS NULL OR country=${country}) AND (${app}::text IS NULL OR ${app}=ANY(apps))
      AND (${q}::text IS NULL OR to_tsvector('simple',coalesce(host,'')||' '||coalesce(brand,'')||' '||coalesce(title,'')) @@ websearch_to_tsquery('simple',${q}))
      AND EXISTS (SELECT 1 FROM pages p WHERE p.site_id=sites.id)
    ORDER BY rank ASC NULLS LAST, host LIMIT ${s.limit} OFFSET ${s.offset}`;
  const total = Number(rows[0]?.total ?? 0);
  return { items: rows.map(toMcpStore), total, hasMore: s.offset + rows.length < total };
}

export type McpStoreDetail = McpStore & {
  title: string | null;
  pages: { url: string; type: string; captured_at: string; blocks: number; desktop_thumbnail_url: string | null; mobile_thumbnail_url: string | null }[];
  captures: { captured_at: string; pages: number }[];
  design: null;
  design_note: string;
  blimp_url: string;
};

export async function getStore(host: string, origin: string): Promise<McpStoreDetail | null> {
  const sql = database();
  const [site] = await sql`SELECT * FROM sites WHERE host=${host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")} LIMIT 1`;
  if (!site) return null;
  const [pages, captures] = await Promise.all([
    latestPages(sql, [site.id]),
    sql`SELECT c.captured_at, count(DISTINCT c.page_id)::int AS pages FROM captures c JOIN pages p ON p.id=c.page_id
      WHERE p.site_id=${site.id} GROUP BY c.captured_at ORDER BY c.captured_at DESC LIMIT 20`,
  ]);
  const shot = (u: string | null) => (u ? assetUrl(u) : null);
  return {
    ...toMcpStore(site), title: (site.title as string | null) ?? null,
    pages: (pages.get(site.id) ?? []).map((p) => ({ url: p.url, type: p.type, captured_at: p.capturedAt, blocks: p.blocks,
      desktop_thumbnail_url: shot(p.desktop), mobile_thumbnail_url: shot(p.mobile) })),
    captures: captures.map((c) => ({ captured_at: (c.captured_at as Date).toISOString(), pages: Number(c.pages) })),
    design: null, design_note: STYLE_NOTE, blimp_url: `${origin}/sites/${site.host}`,
  };
}

/** Live values for the taxonomy tool: what the library actually holds, with counts. */
export async function libraryFacts(): Promise<{
  pageTypes: { value: string; pages: number }[]; platforms: { value: string; stores: number }[];
  blocks: number; tagged: number;
}> {
  const sql = database();
  const [pageTypes, platforms, [counts]] = await Promise.all([
    sql`SELECT type AS value, count(*)::int AS n FROM pages GROUP BY type ORDER BY n DESC`,
    sql`SELECT platform AS value, count(*)::int AS n FROM sites WHERE platform IS NOT NULL GROUP BY platform ORDER BY n DESC`,
    sql`SELECT count(*)::int AS blocks, count(block_type)::int AS tagged FROM blocks`,
  ]);
  return {
    pageTypes: pageTypes.map((r) => ({ value: String(r.value), pages: Number(r.n) })),
    platforms: platforms.map((r) => ({ value: String(r.value), stores: Number(r.n) })),
    blocks: Number(counts.blocks), tagged: Number(counts.tagged),
  };
}
