import { apiError, PUBLIC_CACHE } from "@/server/db";
import { findBlockDetail } from "@/server/blocks";
import { siteOrigin } from "@/server/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blocks/[id] · one BlockDetail: the Block, so a pasted `?open=<id>`
 * link works without the wall having loaded it, plus its tagger output and
 * measured style and outline (SEC-31 brief section 8). Null where not collected.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const block = await findBlockDetail((await params).id, siteOrigin(url.origin));
    if (!block) return Response.json({ error: "Block not found", code: "NOT_FOUND" }, { status: 404 });
    // One primary-key read, so not worth the memory cache; the header lets a CDN keep it.
    return Response.json(block, { headers: PUBLIC_CACHE });
  } catch (error) { return apiError(error); }
}
