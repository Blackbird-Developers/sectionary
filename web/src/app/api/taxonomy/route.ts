import { apiError, PUBLIC_CACHE } from "@/server/db";
import { libraryTaxonomy } from "@/server/mcp/data";
import { cachedJson, keyOf } from "@/server/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/taxonomy · Taxonomy: block types with their one-line meanings, page
 * roles, style tags, industries, and the page types and platforms the library
 * holds (SEC-31 brief section 8). The same lists as blimp_list_taxonomy.
 */
export async function GET(request: Request) {
  try {
    return await cachedJson(keyOf(new URL(request.url)), PUBLIC_CACHE, async () => ({ body: await libraryTaxonomy() }), request);
  } catch (error) { return apiError(error); }
}
