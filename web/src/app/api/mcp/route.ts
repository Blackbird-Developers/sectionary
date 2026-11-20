import { createMcpHandler } from "@modelcontextprotocol/server";
import { apiError } from "@/server/db";
import { hasDatabase } from "@/server/blocks";
import { bearer, userForApiKey } from "@/server/api-keys";
import { mcpTier, type McpTier } from "@/server/plans";
import { hit, RateLimitError } from "@/server/rate-limit";
import { siteOrigin } from "@/server/site-url";
import { blimpServer, type McpAccess } from "@/server/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mcp · the Blimp MCP server (SEC-31). Streamable HTTP, stateless: every
 * request gets a fresh server from the factory, so it runs the same on Vercel
 * and on ECS, where instances come and go. Read-only tools (server/mcp/tools.ts).
 *
 * In front of the SDK's handler, which does no auth of its own: a bearer API
 * key from the account page (server/api-keys.ts), the account's plan, and
 * limits per key and per account in the shared rate_limits table.
 *
 * Every plan can connect. A Free account gets the taxonomy and, from every
 * library tool, a message saying how to upgrade (server/mcp/tools.ts), so the
 * agent can tell the user why, rather than a bare HTTP error a client shows as
 * "failed to connect". Library data stays Pro and Team.
 */
const handler = createMcpHandler(
  (ctx) => blimpServer(siteOrigin(new URL(ctx.requestInfo?.url ?? "http://localhost").origin), ctx.authInfo?.extra as McpAccess | undefined),
  { responseMode: "json", onerror: (error) => console.error("[mcp]", error.message) },
);

/**
 * Per key: a busy agent's pace. Per account: a day's heavy use across all its keys.
 * Free keys can only list the taxonomy and read upgrade messages, so less of both.
 */
const limits = (tier: McpTier, keyId: string, userId: string) => [
  { key: `mcp:k:${keyId}`, max: tier === "free" ? 30 : 120, windowSeconds: 60 },
  { key: `mcp:u:${userId}`, max: tier === "free" ? 300 : 5000, windowSeconds: 86_400 },
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
    const tier = mcpTier(found.user);
    await hit(limits(tier, found.keyId, found.user.id), "Too many MCP requests for now.");
    // The plan reaches the server factory as authInfo, set here after the key was checked; a client cannot send it.
    const access: McpAccess = { tier, trialEndsAt: found.user.trialEndsAt };
    return await handler.fetch(request, { authInfo: { token: found.keyId, clientId: found.user.id, scopes: [], extra: access } });
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
