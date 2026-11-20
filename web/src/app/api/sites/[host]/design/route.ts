import { apiError, PUBLIC_CACHE } from "@/server/db";
import { userForRequest } from "@/server/accounts";
import { siteDesign } from "@/server/design";
import { cachedJson, keyOf } from "@/server/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/sites/[host]/design · SiteDesign, the store design profile (L3) and
 * its summary (SEC-31 brief section 8). Signed-out answers use the shared
 * public response cache and omit the store's own accessibility signals.
 * Signed-in answers carry those signals and are never cached (brief 12.5).
 */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const signedIn = Boolean(await userForRequest(request));
    const host = (await params).host;
    if (signedIn) {
      const design = await siteDesign(host, true);
      if (!design) return Response.json({ error: "Site not found", code: "NOT_FOUND" }, { status: 404, headers: PRIVATE });
      return Response.json(design, { headers: PRIVATE });
    }
    return await cachedJson(keyOf(new URL(request.url)), PUBLIC_CACHE, async () => {
      const design = await siteDesign(host, false);
      return design
        ? { body: design }
        : { body: { error: "Site not found", code: "NOT_FOUND" }, status: 404 };
    });
  } catch (error) { return apiError(error); }
}
