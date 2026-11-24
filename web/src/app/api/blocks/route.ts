import { apiError, database, PUBLIC_CACHE } from "@/server/db";
import { cachedJson, keyOf } from "@/server/response-cache";
import { blockColumns, facetCounts, readFilters, toBlock, wallJoins, wallWhere, withColours } from "@/server/blocks";
import { refreshWallSoon } from "@/server/wall";
import { searchBlocks } from "@/server/search";
import { userForRequest } from "@/server/accounts";
import { accessOf, can, FREE_FILTERS, gatesOn } from "@/server/plans";
import type { BlockFilters } from "@/server/blocks";

/**
 * Free and signed-out viewers filter by Store and Block type only (with
 * PLAN_GATES=on): any other filter is dropped. Only a request that carries one
 * looks up the session, so the wall's ordinary pages stay CDN-cached for all.
 */
async function allowedFilters(request: Request, f: BlockFilters): Promise<{ f: BlockFilters; personal: boolean }> {
  const extra = Object.keys(f).filter((k) => !FREE_FILTERS.has(k));
  if (!gatesOn() || extra.length === 0) return { f, personal: false };
  if (can(accessOf(await userForRequest(request)), "filters")) return { f, personal: true };
  const kept: BlockFilters = {};
  for (const k of Object.keys(f) as (keyof BlockFilters)[]) if (FREE_FILTERS.has(k)) (kept as Record<string, unknown>)[k] = f[k];
  return { f: kept, personal: true };
}
const PRIVATE = { "Cache-Control": "private, no-store" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blocks · BlocksQuery in, BlocksResponse out, plus the wall's
 * additions (WallQuery and WallResponse in lib/block-source.ts): the `video`
 * and `color` filters, facets for every filter and `nearMiss`.
 * Without `q`, stores are mixed (see below) unless the query names a store,
 * which keeps page order. With `q`, ranked by relevance: full text, typo
 * tolerance and semantic search fused (see server/search.ts).
 * Facets and near misses come with the first page only: they describe the
 * whole result set, so later pages would repeat them.
 *
 * The wall asks for the two halves separately, so the screenshots never wait
 * on the counts: `facets=0` is the first page of blocks alone, and
 * `facets=only` is the counts (facets, near misses, total) with no blocks.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sql = database();
    refreshWallSoon(sql);
    const gated = await allowedFilters(request, readFilters(url));
    // An answer every visitor gets alike is kept in memory (server/response-cache.ts):
    // on AWS no CDN keeps it, and building one takes the database seconds.
    if (gated.personal) {
      const { body, headers } = await answer(url, sql, gated.f);
      return Response.json(body, { headers: { ...PRIVATE, ...headers } });
    }
    return await cachedJson(keyOf(url), PUBLIC_CACHE, () => answer(url, sql, gated.f), request);
  } catch (error) { return apiError(error); }
}

/**
 * One page of blocks. `facets=0` leaves out facets and near misses even on the
 * first page, for callers that only want the blocks (the viewer's "similar").
 */
async function answer(url: URL, sql: ReturnType<typeof database>, filters: BlockFilters): Promise<{ body: unknown; headers?: Record<string, string> }> {
  const f = await withColours(sql, filters);
  const q = url.searchParams.get("q")?.trim() || null;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
  const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
  const mode = url.searchParams.get("facets");
  const first = offset === 0 && mode !== "0";
  const only = mode === "only";

  if (q) {
    const { items, total, nextCursor, facets, nearMiss, search } = await searchBlocks(q, f, only ? 1 : limit, only ? 0 : offset, only || first);
    // How the query was read goes in headers, so the body stays exactly BlocksResponse.
    const headers = {
      "x-search-terms": search.terms.join(" "),
      "x-search-corrected": Object.entries(search.corrected).map(([from, to]) => `${from}>${to}`).join(" "),
      "x-search-semantic": String(search.semantic),
      "x-search-intent": search.intents.join(" "),
    };
    if (only) return { body: { items: [], blocks: [], generatedAt: new Date().toISOString(), nextCursor: null, total, facets, nearMiss }, headers };
    return { body: { items, blocks: items, generatedAt: new Date().toISOString(), nextCursor, total, ...(first && { facets, nearMiss }) }, headers };
  }

  if (only) {
    const counts = await facetCounts(sql, f);
    return { body: { items: [], blocks: [], generatedAt: new Date().toISOString(), nextCursor: null, total: counts.total, facets: counts.facets, nearMiss: counts.nearMiss } };
  }

  // Latest capture of each page only.
  //
  // A query that names a store keeps page order within each capture, so that
  // store's blocks arrive ready for its page viewer and flow view.
  //
  // Any other query mixes the stores, so the wall is not a run of one store's
  // sections followed by a run of the next. Each store's blocks are dealt in
  // turns: every store's first, then every store's second, and so on. Which
  // block is a store's first, and the order of stores within a turn, come from
  // a hash of the ids: scattered, but the same on every request, so pages
  // follow on from one another and the answer can be cached. The turns are
  // worked out ahead of time in wall_shown (migration 0018): per store and
  // viewport for the usual one-viewport wall, which deals exactly as before,
  // and per store otherwise, so other filters are still mixed but not strictly
  // one block per store per turn.
  //
  // The mixed orders are indexes on wall_shown, so a page reads only its own
  // rows; one store is a few hundred rows of it, sorted as they come.
  const turn = f.vp?.length === 1 ? sql`w.vp_turn` : sql`w.turn`;
  const rowsQuery = f.host?.length
    ? sql`SELECT ${blockColumns(sql)} FROM ${wallJoins(sql)} WHERE ${wallWhere(sql, f)}
      ORDER BY w.captured_at DESC, w.capture_id, w.viewport, w.block_index, w.id LIMIT ${limit} OFFSET ${offset}`
    : sql`SELECT ${blockColumns(sql)} FROM ${wallJoins(sql)} WHERE ${wallWhere(sql, f)}
      ORDER BY ${turn}, w.store_order, w.id LIMIT ${limit} OFFSET ${offset}`;
  // Without facets the total is its own count, run alongside the page rather than after it.
  const [rows, counts, counted] = await Promise.all([
    rowsQuery,
    first ? facetCounts(sql, f) : null,
    first ? null : sql`SELECT count(*)::int AS total FROM wall_shown w WHERE ${wallWhere(sql, f)}`,
  ]);
  const total = counts?.total ?? (counted![0].total as number);
  const items = rows.map(toBlock);
  return {
    body: {
      items, blocks: items, generatedAt: new Date().toISOString(),
      nextCursor: offset + items.length < total ? String(offset + items.length) : null, total,
      ...(counts && { facets: counts.facets, nearMiss: counts.nearMiss }),
    },
  };
}
