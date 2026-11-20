# The Blimp MCP server (SEC-31)

An MCP server so Claude, Cursor and other agents can search the library.
Brief: `mcp-metadata-brief.md` (design metadata for the Blimp MCP, 16 Nov 2026).
This page covers what is built.

## Connect

1. Account page → **MCP API keys** → New key. The key is shown once.
2. Claude Code:

   ```
   claude mcp add --transport http blimp https://<site>/api/mcp --header "Authorization: Bearer <key>"
   ```

   Any client that speaks Streamable HTTP works the same way: the URL plus that header.

## How it is built

- One route, `web/src/app/api/mcp/route.ts`, on the same server code as the
  API (`web/src/server/mcp/`). No second service.
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `createMcpHandler`).
  Stateless: a fresh server per request, so it runs the same on Vercel and ECS.
  Serves the 2026-07-28 protocol and falls back to stateless 2025-era serving.
- **Auth:** a bearer key from `api_keys` (migration 13). Only the SHA-256 is
  stored, like session tokens. At most 5 active keys per account.
- **Plan:** the `"mcp"` feature. With `PLAN_GATES=on`, Pro and Team (and the
  7-day trial); Free gets 402. Owner decision, 18 Nov 2026 (brief section 12,
  item 2): it stays in Pro and Team, no separate plan or metering.
- **Limits:** 120 requests a minute per key, 5,000 a day per account, in the
  shared `rate_limits` table. Over the limit: 429 with `Retry-After`.

## Tools

All read-only (`readOnlyHint: true`), all with an output schema, structured
content plus a short text rendering. v1 serves the library as captured; v2
serves the design metadata (brief section 4), which is `null` with a note
until a store is captured with `--styles`.

| Tool | What it does |
|---|---|
| `blimp_list_taxonomy` | Valid block types with meanings, page roles, style tags, industries, page types and platforms in the library, and how much is tagged |
| `blimp_search_blocks` | Plain-language query plus filters (block type, page type, industry, platform, app, viewport, style tag, has price / reviews / video, store). At most 20, cursor paging |
| `blimp_get_block` | One block: metadata and tagger output; optional `include` selects outline, style, up to 400 characters of text, and the screenshot URL (all by default) |
| `blimp_search_stores` | Stores by name, industry, platform, country, app |
| `blimp_get_store` | One store: stack, apps, captured pages, capture history |
| `blimp_get_store_design` | v2. The store design profile (L3): fonts, type scale, heading system, palette and accent, buttons, shape, spacing, layout habits, consistency counts, accessibility signals, and a DESIGN.md-style `summary` |
| `blimp_get_page_profile` | v2. One page type's profile (L2) at desktop and phone: type scale, headings with hierarchy checks, palette, buttons, density, components, accessibility signals |
| `blimp_get_store_flow` | v2. Home, collection, product and cart, each with its sections top to bottom (at most 20 per page) |
| `blimp_get_benchmark` | v2. What is typical (L4) per industry, page type and viewport: quartiles or shares, always with `n`; refuses under 10 stores and says why |
| `blimp_find_similar_blocks` | v2. Blocks like one from other stores, one per store: by embedding when there is one, else by section type |

## Response rules

- **No source.** No HTML, CSS, class names or element ids. Queries never select
  them and `withoutSource` (`web/src/server/mcp/shape.ts`) strips them again.
- **Missing is null.** Style, outline, page profiles and the store design
  profile are `null` with a note until the crawler measures them (`--styles`,
  brief section 6). Benchmarks need 10 stores measured.
- **Accessibility signals** are signals, not an audit. A key counts as signed
  in, so the tools include a store's own; the public HTTP API leaves them out
  for signed-out requests (brief section 12 item 5).
- **Errors say what to do:** an unknown block type, industry or app names the
  closest valid values and points to `blimp_list_taxonomy`.
- **Untagged blocks** carry `block_type: null`, their theme's `type_hint` and a
  `tag_note`. A `block_type` filter also accepts a type hint. Tagger filters
  (style tag, has price, has reviews) only match tagged blocks.

## The same data over HTTP

Brief section 8: `GET /api/blocks/[id]` (with style, outline and tagger
output), `/api/sites/[host]/design`, `/api/benchmarks` and `/api/taxonomy`
read through the same functions as the tools (`web/src/server/design.ts`,
`web/src/server/mcp/data.ts`). Shapes in `docs/CONTRACTS.md`.

## Evaluation

`npm run mcp:eval` in `web/` (brief section 9.4): a throwaway Postgres with
the fixture manifests, `profile-sites` and `benchmarks` run as after an
import, a Pro account and key, and the official MCP client talking to the real
route through auth, plan gate and rate limits. Ten questions pinned to the
fixtures, with answers computed from the manifests rather than the server's
code; then the HTTP API is checked against the same answers, and every
response for source. All pass. These are scripted calls: they prove the tools
and data can answer, not that a given model picks the right calls.

## Not yet

- `blimp_compare_stores`, after the compare pilot (brief step 9).
- Design data in production fills in as stores are recaptured with
  `--styles` (brief section 7.5). `--styles` stays off by default until
  the 20-store accuracy check (brief section 10) passes.
- Owner decision in brief section 12 item 3: thumbnails or full screenshots
  for agents (today: thumbnails plus the screenshot URL).

## Checking it locally

`platform/src/local-db.ts` gives a throwaway Postgres with every migration;
import `fixtures/manifests`, add a user and a key, run `next dev` with that
`DATABASE_URL`, and call the endpoint with any MCP client.
