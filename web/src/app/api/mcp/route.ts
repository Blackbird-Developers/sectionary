import { createMcpHandler } from "@modelcontextprotocol/server";
import { apiError } from "@/server/db";
import { hasDatabase } from "@/server/blocks";
import { bearer, userForApiKey } from "@/server/api-keys";
import { accessOf, can } from "@/server/plans";
import { hit, RateLimitError } from "@/server/rate-limit";
import { siteOrigin } from "@/server/site-url";
import { blimpServer } from "@/server/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mcp · the Blimp MCP server (SEC-31). Streamable HTTP, stateless: every
 * request gets a fresh server from the factory, so it runs the same on Vercel
 * and on ECS, where instances come and go. Read-only tools (server/mcp/tools.ts).
 *
 * In front of the SDK's handler, which does no auth of its own: a bearer API
 * key from the account page (server/api-keys.ts), the "mcp" plan feature, and
 * limits per key and per account in the shared rate_limits table.
 */
const handler = createMcpHandler(
  (ctx) => blimpServer(siteOrigin(new URL(ctx.requestInfo?.url ?? "http://localhost").origin)),
  { responseMode: "json", onerror: (error) => console.error("[mcp]", error.message) },
);

/** Per key: a busy agent's pace. Per account: a day's heavy use across all its keys. */
const limits = (keyId: string, userId: string) => [
  { key: `mcp:k:${keyId}`, max: 120, windowSeconds: 60 },
  { key: `mcp:u:${userId}`, max: 5000, windowSeconds: 86_400 },
];

const deny = (status: number, error: string, code: string, headers?: Record<string, string>) =>
  Response.json({ error, code }, { status, headers: { "cache-control": "no-store", ...headers } });

async function serve(request: Request): Promise<Response> {
  try {
    if (!hasDatabase()) return deny(503, "The MCP server needs the database, which this deployment does not have.", "NO_DATABASE");
    const found = await userForApiKey(bearer(request));
    if (!found) {
      return deny(401, "Send an API key from your Blimp account page as 'Authorization: Bearer <key>'.", "INVALID_KEY",
        { "WWW-Authenticate": 'Bearer realm="blimp", error="invalid_token"' });
    }
    if (!can(accessOf(found.user), "mcp")) return deny(402, "The Blimp MCP server comes with Pro.", "PLAN_REQUIRED");
    await hit(limits(found.keyId, found.user.id), "Too many MCP requests for now.");
    return await handler.fetch(request);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return deny(429, `${error.message} Try again in ${error.retryAfter} seconds.`, error.code, { "Retry-After": String(error.retryAfter) });
    }
    return apiError(error);
  }
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
