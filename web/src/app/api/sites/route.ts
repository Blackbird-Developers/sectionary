import { apiError, database, pgArray, PUBLIC_CACHE } from "@/server/db";
import { latestPages, siteFlowOrder, toStore } from "@/server/sites";
import { cachedJson, keyOf } from "@/server/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // On globalThis: one line for every copy of this module Next.js loads.
  var sectionarySitesTurn: Promise<unknown> | undefined;
}

/**
 * One page of the list is built at a time. The Sites page asks for its pages
 * together (lib/load-blocks.ts), which costs nothing when they are in the
 * answer cache; when they are not, each takes the database seconds, and
 * building them all at once would hold most of the five connections
 * (server/db.ts) against every other visitor, which is how a busy pool came
 * to be taken for a stuck one (server/pool-health.ts). In turn, they use one.
 */
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = (globalThis.sectionarySitesTurn ?? Promise.resolve()).then(job, job);
  globalThis.sectionarySitesTurn = run.catch(() => undefined);
  return run;
}

/**
 * GET /api/sites · every store with its pages at their latest capture, for
 * the Sites grid and the Flows index (SEC-47). A SiteProfile per store without
 * the capture history, paged like every list: `cursor`, `limit` up to 200.
 * Stores never captured come back with no pages. Ranked order, as /api/stores.
 *
 * `order=flow` is the Flows index a page at a time: only stores with a
 * capture, in Flows order (complete flows first, see lib/flows.ts), 40 a
 * request unless `limit` says otherwise, and the index's `counts` with every
 * page. Complete flows only unless `all=1`; the incomplete ones follow the
 * complete ones, so both lists share their first `counts.complete` stores.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), sql = database();
    if (url.searchParams.get("order") === "flow") return await cachedJson(keyOf(url), PUBLIC_CACHE, () => inTurn(() => flowPage(url)), request);
    return await cachedJson(keyOf(url), PUBLIC_CACHE, () => inTurn(async () => {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const rows = await sql`SELECT *, count(*) OVER()::int AS total FROM sites ORDER BY rank ASC NULLS LAST, host LIMIT ${limit} OFFSET ${offset}`;
    const pages = await latestPages(sql, rows.map((r) => r.id as string));
    const items = rows.map((r, i) => ({ store: toStore(r, offset + i + 1), pages: pages.get(r.id) ?? [] }));
    const total = rows[0]?.total ?? 0;
    return { body: { items, generatedAt: new Date().toISOString(), nextCursor: offset + items.length < total ? String(offset + items.length) : null, total } };
    }), request);
  } catch (error) { return apiError(error); }
}

/** One page of the Flows index: the stores in its place in the order, each with its pages. */
async function flowPage(url: URL) {
  const sql = database();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 40));
  const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
  const { ids: ordered, counts } = await siteFlowOrder(sql);
  const total = url.searchParams.get("all") === "1" ? ordered.length : counts.complete;
  const ids = ordered.slice(offset, Math.max(offset, Math.min(total, offset + limit)));
  const rows = ids.length ? await sql`SELECT * FROM sites WHERE id=ANY(${pgArray(ids)}::uuid[])` : [];
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const pages = await latestPages(sql, ids);
  // In the order's order. A store deleted since the order was made is skipped.
  const items = ids.flatMap((id, i) => {
    const row = byId.get(id);
    return row ? [{ store: toStore(row, offset + i + 1), pages: pages.get(id) ?? [] }] : [];
  });
  const end = offset + ids.length;
  return { body: { items, generatedAt: new Date().toISOString(), nextCursor: ids.length > 0 && end < total ? String(end) : null, total, counts } };
}
