import { apiError, PUBLIC_CACHE } from "@/server/db";
import { userForRequest } from "@/server/accounts";
import { siteDesign } from "@/server/design";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/sites/[host]/design · SiteDesign, the store design profile (L3) and
 * its summary (SEC-31 brief section 8). One indexed read of a stored record, so
 * no memory cache. Signed out it is the same for everyone and publicly
 * cacheable, without the store's own accessibility signals; signed in it
 * carries them and is not cached (brief section 12 item 5).
 */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const signedIn = Boolean(await userForRequest(request));
    const design = await siteDesign((await params).host, signedIn);
    if (!design) return Response.json({ error: "Site not found", code: "NOT_FOUND" }, { status: 404 });
    return Response.json(design, { headers: signedIn ? PRIVATE : PUBLIC_CACHE });
  } catch (error) { return apiError(error); }
}
