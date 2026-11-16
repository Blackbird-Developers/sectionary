# The Blimp MCP server (SEC-31)

An MCP server so Claude, Cursor and other agents can search the library.
Brief: `mcp-metadata-brief.md` (design metadata for the Blimp MCP). This page
covers what is built.

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
  trial); Free gets 402. Owner decision pending (brief section 12, item 2).
- **Limits:** 120 requests a minute per key, 5,000 a day per account, in the
  shared `rate_limits` table. Over the limit: 429 with `Retry-After`.

## Tools (v1)

All read-only (`readOnlyHint: true`), all with an output schema, structured
content plus a short text rendering.

| Tool | What it does |
|---|---|
| `blimp_list_taxonomy` | Valid block types with meanings, page roles, style tags, industries, page types and platforms in the library, and how much is tagged |
| `blimp_search_blocks` | Plain-language query plus filters (block type, page type, industry, platform, app, viewport, style tag, has price / reviews / video, store). At most 20, cursor paging |
| `blimp_get_block` | One block: metadata, tagger output, 400 characters of text, image and thumbnail URLs, capture date |
| `blimp_search_stores` | Stores by name, industry, platform, country, app |
| `blimp_get_store` | One store: stack, apps, captured pages, capture history |

## Response rules

- **No source.** No HTML, CSS, class names or element ids. Queries never select
  them and `withoutSource` (`web/src/server/mcp/shape.ts`) strips them again.
- **Missing is null.** Style, outline and the store design profile are `null`
  with a note until the crawler measures them (`--styles`, brief section 6).
- **Errors say what to do:** an unknown block type, industry or app names the
  closest valid values and points to `blimp_list_taxonomy`.
- **Untagged blocks** carry `block_type: null`, their theme's `type_hint` and a
  `tag_note`. A `block_type` filter also accepts a type hint. Tagger filters
  (style tag, has price, has reviews) only match tagged blocks.

## Not yet

v2 after the style work: `blimp_get_store_design`, `blimp_get_page_profile`,
`blimp_get_store_flow`, `blimp_get_benchmark`, `blimp_find_similar_blocks`;
then `blimp_compare_stores` after the compare pilot. The 10 evaluation
questions (brief section 9.4) need production data and are still to write.

## Checking it locally

`platform/src/local-db.ts` gives a throwaway Postgres with every migration;
import `fixtures/manifests`, add a user and a key, run `next dev` with that
`DATABASE_URL`, and call the endpoint with any MCP client.
