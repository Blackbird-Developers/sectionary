import { apiError, database, PUBLIC_CACHE } from "@/server/db";
import { blockColumns, blockJoins, LATEST, toBlock } from "@/server/blocks";
import { cachedJson, keyOf } from "@/server/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A capture's viewport as the importer stores it, once the image pipeline has run (viewportWithImage in platform/src/import.ts). */
type StoredViewport = {
  image?: { src?: string | null; width?: number; height?: number; slices?: { index: number; src: string; width: number; height: number }[] | null } | null;
} | null;

/**
 * The files of a viewport's full-page screenshot, top to bottom, with their
 * pixel sizes: one WebP, or its slices when the page is taller than WebP
 * allows. Null when the pipeline has not uploaded one.
 */
function shotsOf(viewport: StoredViewport): { src: string; w: number; h: number }[] | null {
  const image = viewport?.image;
  if (!image) return null;
  const slices = (image.slices ?? []).filter((s) => s?.src && s.width > 0 && s.height > 0);
  if (slices.length > 0) return [...slices].sort((a, b) => a.index - b.index).map((s) => ({ src: s.src, w: s.width, h: s.height }));
  return image.src && image.width && image.height ? [{ src: image.src, w: image.width, h: image.height }] : null;
}

/**
 * GET /api/sites/[host]/page?url=<page url> · every block of one page at its
 * latest capture, in page order, per viewport: `{ desktop, mobile }`.
 *
 * Unlike /api/blocks this keeps the sections a store repeats (the header on
 * every page), and each block carries `top`, how far down the page it starts
 * in CSS pixels. `shots` is the page itself: the full-page screenshot of each
 * viewport at full size (see shotsOf), which is what the site profile's page
 * viewer draws; a click on it opens the block at that height.
 */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const { host } = await params;
    const url = new URL(request.url).searchParams.get("url");
    if (!url) return Response.json({ error: "url is required", code: "BAD_REQUEST" }, { status: 400 });
    const sql = database();
    return await cachedJson(keyOf(new URL(request.url)), PUBLIC_CACHE, async () => {
    const rows = await sql`SELECT ${blockColumns(sql)}, b.top FROM ${blockJoins(sql)}
      WHERE s.host=${host.toLowerCase()} AND p.url=${url} AND ${LATEST(sql)}
      ORDER BY b.viewport, b.block_index, b.id`;
    const blocks = rows.map((r) => ({ ...toBlock(r), top: r.top as number }));
    const [capture] = await sql`SELECT c.desktop, c.mobile FROM captures c JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id
      WHERE s.host=${host.toLowerCase()} AND p.url=${url} AND ${LATEST(sql)} LIMIT 1`;
    return { body: {
      desktop: blocks.filter((b) => b.viewport === "desktop"), mobile: blocks.filter((b) => b.viewport === "mobile"),
      shots: { desktop: shotsOf(capture?.desktop as StoredViewport), mobile: shotsOf(capture?.mobile as StoredViewport) },
    } };
    });
  } catch (error) { return apiError(error); }
}
