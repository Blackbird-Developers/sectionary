import type { Store } from "@/contracts/store";
import type { SiteProfile } from "@/contracts/api";
import { database, pgArray } from "@/server/db";
import { flowOrder, type FlowOrder } from "@/lib/flows";

type Sql = ReturnType<typeof database>;

/** A `sites` row as the Store the contract describes. `n` is the row's place in its list. */
export function toStore(r: Record<string, unknown>, n = 1): Store {
  return {
    n, host: r.host as string, brand: (r.brand as string | null) ?? (r.host as string), title: r.title as string | null,
    platform: r.platform as string | null, builder: r.builder as string | null, theme: r.theme_name as string | null,
    themeVersion: r.theme_version as string | null, currency: r.currency as string | null, country: r.country as string | null,
    industry: r.industry as string, industryScore: r.industry_score as number, apps: r.apps as string[],
    collections: null, rank: r.rank as number | null, mentions: r.mentions as number, sources: r.sources as string[],
    validatedAt: (r.validated_at as Date | null)?.toISOString?.() ?? null,
  };
}

/**
 * A full-page shot as the site can load it: the thumbnail the image pipeline
 * uploaded (600px wide, the top of the page), which is what the previews show
 * (object-cover, from the top). The viewport's `file` is a path on the capture
 * machine ("desktop.jpg") and the full image may be split into slices, so
 * neither is usable here. Null without an upload: the preview stacks the blocks.
 */
const shotOf = (viewport: { image?: { thumbnail?: string | null } | null } | null | undefined) => viewport?.image?.thumbnail ?? null;

declare global {
  // On globalThis: one order for every copy of this module Next.js loads.
  var sectionaryFlowOrder: { at: number; order: Promise<FlowOrder> } | undefined;
}

/** How long one order serves every page of the Flows index: a visitor scrolling down reads pages cut from the same list. */
const FLOW_ORDER_MS = 5 * 60_000;

/**
 * Every captured store in Flows order, with the index's counts (lib/flows.ts).
 * One query over every page's latest capture, far lighter than the pages
 * themselves: it reads which page types have a shot to show (shotOf, above)
 * and nothing else. A store with no capture has no flow and is left out.
 */
export function siteFlowOrder(sql: Sql): Promise<FlowOrder> {
  const kept = globalThis.sectionaryFlowOrder;
  if (kept && Date.now() - kept.at < FLOW_ORDER_MS) return kept.order;
  const order = (async () => {
    const rows = await sql`SELECT s.id, s.host, s.brand, s.rank, string_agg(DISTINCT p.type, ',') FILTER (WHERE c.shown) AS shown
      FROM sites s JOIN pages p ON p.site_id=s.id
      JOIN LATERAL (SELECT coalesce(NULLIF(desktop->'image'->>'thumbnail',''), NULLIF(mobile->'image'->>'thumbnail','')) IS NOT NULL AS shown
        FROM captures WHERE page_id=p.id ORDER BY captured_at DESC LIMIT 1) c ON true
      GROUP BY s.id`;
    return flowOrder(rows.map((r) => ({
      id: r.id as string, host: r.host as string, brand: (r.brand as string | null) ?? (r.host as string), rank: r.rank as number | null,
      shown: ((r.shown as string | null) ?? "").split(",").filter(Boolean),
    })));
  })();
  globalThis.sectionaryFlowOrder = { at: Date.now(), order };
  // A failed query is not kept: the next request asks again.
  order.catch(() => {
    if (globalThis.sectionaryFlowOrder?.order === order) globalThis.sectionaryFlowOrder = undefined;
  });
  return order;
}

/** Every page of these sites at its latest capture, with full-page shots and block counts, keyed by site id. */
export async function latestPages(sql: Sql, siteIds: string[]): Promise<Map<string, SiteProfile["pages"]>> {
  const rows = siteIds.length
    ? await sql`SELECT p.site_id,p.url,p.type,p.title,c.captured_at,c.desktop,c.mobile,
        (SELECT count(*)::int FROM blocks b WHERE b.capture_id=c.id) AS blocks
        FROM pages p JOIN LATERAL (SELECT * FROM captures WHERE page_id=p.id ORDER BY captured_at DESC LIMIT 1) c ON true
        WHERE p.site_id=ANY(${pgArray(siteIds)}::uuid[]) ORDER BY p.type,p.url`
    : [];
  const bySite = new Map<string, SiteProfile["pages"]>();
  for (const p of rows) {
    const list = bySite.get(p.site_id) ?? [];
    list.push({ url: p.url, type: p.type, title: p.title, capturedAt: p.captured_at.toISOString(),
      desktop: shotOf(p.desktop), mobile: shotOf(p.mobile), blocks: p.blocks });
    bySite.set(p.site_id, list);
  }
  return bySite;
}
