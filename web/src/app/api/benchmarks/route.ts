import type { BenchmarksResponse } from "@/contracts/api";
import type { Viewport } from "@/contracts/block";
import { CATEGORICAL_BENCHMARKS, MIN_BENCHMARK_N, NUMERIC_BENCHMARKS } from "@/contracts/design";
import { apiError, PUBLIC_CACHE } from "@/server/db";
import { benchmarks } from "@/server/design";
import { BLOCK_TYPES, INDUSTRIES } from "@/server/mcp/taxonomy";
import { PAGE_TYPES, unknownValue } from "@/server/mcp/shape";
import { cachedJson, keyOf } from "@/server/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METRICS = [...Object.keys(NUMERIC_BENCHMARKS), ...Object.keys(CATEGORICAL_BENCHMARKS)];
const validMetric = (m: string) => METRICS.includes(m) || (m.startsWith("block:") && BLOCK_TYPES.includes(m.slice(6) as never));
const invalid = (error: string) => Response.json({ error, code: "INVALID" }, { status: 400 });

/**
 * GET /api/benchmarks?industry=&page=&vp=&metric= · BenchmarksResponse, what is
 * typical across stores (L4, SEC-31 brief section 8). The same rows as
 * blimp_get_benchmark. Public, benchmarks included (brief section 12 item 5).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), q = url.searchParams;
    const industry = q.get("industry")?.trim().toLowerCase() || "all";
    const pageType = q.get("page")?.trim().toLowerCase() || "all";
    const viewport = (q.get("vp")?.trim().toLowerCase() || "desktop") as Viewport;
    const metrics = q.get("metric")?.split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);

    if (industry !== "all" && !INDUSTRIES.includes(industry as never)) return invalid(unknownValue("industry", industry, [...INDUSTRIES, "all"]));
    if (pageType !== "all" && !PAGE_TYPES.includes(pageType)) return invalid(unknownValue("page", pageType, [...PAGE_TYPES, "all"]));
    if (viewport !== "desktop" && viewport !== "mobile") return invalid("vp is desktop or mobile.");
    const bad = metrics?.find((m) => !validMetric(m));
    if (bad) return invalid(`Unknown metric '${bad}'. Valid: ${METRICS.join(", ")}, or 'block:<block_type>'.`);

    return await cachedJson(keyOf(url), PUBLIC_CACHE, async () => {
      const { rows, stores } = await benchmarks({ industry, pageType, viewport, metrics });
      const body: BenchmarksResponse = { industry, pageType, viewport, stores, minN: MIN_BENCHMARK_N, items: rows };
      return { body };
    });
  } catch (error) { return apiError(error); }
}
