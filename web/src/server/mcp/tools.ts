import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import type { BlockFilters } from "@/server/blocks";
import { BLOCK_TYPES, INDUSTRIES, STYLE_TAGS } from "@/server/mcp/taxonomy";
import { decodeCursor, encodeCursor, MAX_ITEMS, PAGE_TYPES, unknownValue, withoutSource } from "@/server/mcp/shape";
import { appName, findBlocks, findStores, getBlock, getStore, isTypeHint, libraryTaxonomy, similarBlocks, STYLE_NOTE, type McpBlock } from "@/server/mcp/data";
import { benchmarks, PAGE_STYLE_NOTE, pageProfile, storeDesign, storeFlow } from "@/server/design";
import { CATEGORICAL_BENCHMARKS, MIN_BENCHMARK_N, NUMERIC_BENCHMARKS } from "@/contracts/design";
import type { McpTier } from "@/server/plans";

// The Blimp MCP server (SEC-31, brief section 9). v1: taxonomy, block and
// store search, one block, one store. v2: store design, page profile, flow,
// benchmarks and similar blocks. All read-only. One fresh server per request
// (createMcpHandler in the route). A valid key counts as signed in, so the
// accessibility signals are included (brief section 12 item 5).

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const VIEWPORTS = ["desktop", "mobile"] as const;
const BLOCK_INCLUDES = ["outline", "style", "text", "image"] as const;

// ---------------------------------------------------------------- output shapes

const blockItem = z.object({
  id: z.string(), store: z.string(), brand: z.string(), industry: z.string().nullable(), platform: z.string().nullable(),
  page_type: z.string(), page_url: z.string(), viewport: z.string(), position: z.number(),
  block_type: z.string().nullable(), type_hint: z.string(), page_role: z.string().nullable(), style_tags: z.array(z.string()),
  description: z.string().nullable(), headline: z.string().nullable(),
  size: z.object({ width: z.number(), height: z.number() }),
  counts: z.object({ buttons: z.number(), images: z.number(), videos: z.number() }),
  has_price: z.boolean().nullable(), has_reviews: z.boolean().nullable(), background: z.string().nullable(),
  thumbnail_url: z.string().nullable(), captured_at: z.string(), tagger_version: z.string().nullable(), blimp_url: z.string(),
  tag_note: z.string().optional(),
  image_url: z.string().nullable().optional(), text: z.string().nullable().optional(), patterns: z.array(z.string()).optional(),
  theme: z.string().nullable().optional(), apps: z.array(z.string()).optional(),
  outline: z.array(z.unknown()).nullable().optional(), style: z.record(z.string(), z.unknown()).nullable().optional(), style_note: z.string().optional(),
});

const storeItem = z.object({
  host: z.string(), brand: z.string(), industry: z.string().nullable(), country: z.string().nullable(), platform: z.string().nullable(),
  theme: z.string().nullable(), builder: z.string().nullable(), apps: z.array(z.string()), currency: z.string().nullable(), rank: z.number().nullable(),
});

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number(), has_more: z.boolean(), cursor: z.string().nullable() });

// ---------------------------------------------------------------- helpers

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });
const ok = (structured: Record<string, unknown>, text: string): Result => {
  const clean = withoutSource(structured);
  return { content: [{ type: "text", text }], structuredContent: clean };
};

const line = (b: McpBlock) =>
  `- ${b.id} · ${b.store} · ${b.page_type} · ${b.viewport} · ${b.block_type ?? `${b.type_hint} (untagged)`}${b.headline ? ` · "${b.headline}"` : ""}`;

const lower = (v: string | undefined) => v?.trim().toLowerCase() || undefined;
const noApp = (app: string) => `No store in the library runs '${app}'. App names are as detected, e.g. 'Klaviyo', 'Yotpo'; blimp_get_store lists a store's apps.`;

/** A filter value checked against its closed list; returns the error text or null. */
function check(field: string, value: string | undefined, valid: readonly string[]): string | null {
  return value && !valid.includes(value) ? unknownValue(field, value, valid) : null;
}

// ---------------------------------------------------------------- the server

/** Which plan the key's account is on (plans.ts, mcpTier) and, during a trial, when it ends. */
export type McpAccess = { tier: McpTier; trialEndsAt: string | null };

/** Tools a Free account may call. Every other tool answers with how to upgrade, and no data. */
const FREE_TOOLS = new Set(["blimp_list_taxonomy"]);

const upgradeText = (origin: string) =>
  `This needs Blimp Pro. This account is on the Free plan: it can connect and list the filter values (blimp_list_taxonomy), ` +
  `but searching and reading the library comes with Pro or Team. Upgrade at ${origin}/account, then try again. ` +
  `Tell the user this rather than retrying.`;

const trialText = (origin: string, endsAt: string) =>
  `Blimp Pro trial: ends ${new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}. ` +
  `After that the library tools need Pro or Team (${origin}/account).`;

/** `access` comes from the route after the key is checked. Without it the server fails closed, as Free. */
export function blimpServer(origin: string, given?: McpAccess): McpServer {
  const access: McpAccess = given ?? { tier: "free", trialEndsAt: null };
  const free = access.tier === "free";
  const server = new McpServer(
    { name: "blimp", version: "2.1.0", title: "Blimp" },
    {
      instructions:
        "Blimp is a library of e-commerce website sections (blocks) captured from real stores, desktop and phone. " +
        "Call blimp_list_taxonomy first to learn the valid block types, page types and industries. " +
        "Search with blimp_search_blocks, then open the few worth it with blimp_get_block. " +
        "For a store's design system use blimp_get_store_design; for one page, blimp_get_page_profile; for what is typical, blimp_get_benchmark. " +
        "Facts are measured from public pages; fields that were not collected are null, never guessed." +
        (free ? ` This account is on the Free plan: only blimp_list_taxonomy answers; the other tools need Pro (${origin}/account).` : ""),
    },
  );

  // The plan gate sits around every tool's handler, so each call-site below keeps
  // its typed arguments. Free: an upgrade message, never data. Trial: the answer
  // plus when the trial ends. Paid and gates-off: the answer as is.
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: never, handler: (...args: unknown[]) => Promise<Result>) =>
    register(name, config, (async (...args: unknown[]) => {
      if (free && !FREE_TOOLS.has(name)) return fail(upgradeText(origin));
      const result = await handler(...args);
      if (access.tier === "trial" && access.trialEndsAt && !result.isError) {
        return { ...result, content: [...result.content, { type: "text" as const, text: trialText(origin, access.trialEndsAt) }] };
      }
      return result;
    }) as never)) as typeof server.registerTool;

  server.registerTool(
    "blimp_list_taxonomy",
    {
      title: "List Blimp's filter values",
      description:
        "The valid values for every filter: block types with what each means, page roles, style tags, industries, page types and platforms in the library, " +
        "and how much of the library the tagger has labelled. Call this first: other tools reject values outside these lists.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        block_types: z.array(z.object({ value: z.string(), group: z.enum(["global", "ecommerce"]), meaning: z.string() })),
        page_roles: z.array(z.object({ value: z.string(), meaning: z.string() })),
        style_tags: z.array(z.string()),
        industries: z.array(z.string()),
        page_types: z.array(z.object({ value: z.string(), pages: z.number() })),
        platforms: z.array(z.object({ value: z.string(), stores: z.number() })),
        viewports: z.array(z.string()),
        tagging: z.object({ blocks: z.number(), tagged: z.number(), share: z.number(), tagger_version: z.string(), note: z.string() }),
      }),
      annotations: READ_ONLY,
    },
    async () => {
      const t = await libraryTaxonomy();
      const share = t.tagging.blocks ? Math.round((t.tagging.tagged / t.tagging.blocks) * 1000) / 1000 : 0;
      const out = {
        block_types: t.blockTypes, page_roles: t.pageRoles, style_tags: t.styleTags, industries: t.industries,
        page_types: t.pageTypes, platforms: t.platforms, viewports: t.viewports,
        tagging: {
          blocks: t.tagging.blocks, tagged: t.tagging.tagged, share, tagger_version: t.tagging.taggerVersion,
          note: share < 0.95
            ? "Most blocks are not tagged yet. block_type, page_role, style_tag, has_price and has_reviews filters only match tagged blocks; use query for the rest. A block_type filter also accepts a theme's own section name (type_hint)."
            : "Tagging is complete enough to filter on.",
        },
      };
      return ok(out, `${out.block_types.length} block types, ${out.industries.length} industries, ${t.pageTypes.length} page types. ` +
        `${t.tagging.tagged} of ${t.tagging.blocks} blocks tagged (${Math.round(share * 100)}%). Full lists in the structured result.`);
    },
  );

  server.registerTool(
    "blimp_search_blocks",
    {
      title: "Search blocks",
      description:
        "Find website sections across stores. `query` is plain language (\"subscription picker with savings badge\"); filters narrow it. " +
        "Without a query, lists blocks matching the filters. One block per section type per store and viewport. " +
        "Returns at most 20; page on with `cursor`. `detail: \"full\"` adds the block's text (400 characters), image URL, tagger patterns, and its measured outline and style (null for captures without design metadata).",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Plain-language description of the section wanted"),
        block_type: z.string().optional().describe("From blimp_list_taxonomy, e.g. 'product-reviews'"),
        page_type: z.string().optional().describe("home, collection, product, cart, ..."),
        industry: z.string().optional(),
        platform: z.string().optional().describe("e.g. 'shopify'"),
        app: z.string().optional().describe("An app the store runs, e.g. 'klaviyo', 'yotpo'"),
        viewport: z.enum(VIEWPORTS).optional(),
        style_tag: z.string().optional(),
        has_price: z.boolean().optional(),
        has_reviews: z.boolean().optional(),
        has_video: z.boolean().optional(),
        store: z.string().optional().describe("A store's host, e.g. 'myzoobox.com'"),
        limit: z.number().int().min(1).max(MAX_ITEMS).default(8),
        cursor: z.string().optional(),
        detail: z.enum(["concise", "full"]).default("concise"),
      }),
      outputSchema: page(blockItem),
      annotations: READ_ONLY,
    },
    async (a) => {
      const blockType = lower(a.block_type), pageType = lower(a.page_type), industry = lower(a.industry), styleTag = lower(a.style_tag);
      const error =
        (blockType && !BLOCK_TYPES.includes(blockType as never) && !(await isTypeHint(blockType)) ? unknownValue("block_type", blockType, BLOCK_TYPES) : null) ??
        check("page_type", pageType, PAGE_TYPES) ?? check("industry", industry, INDUSTRIES) ?? check("style_tag", styleTag, STYLE_TAGS);
      if (error) return fail(error);
      const offset = decodeCursor(a.cursor);
      if (offset === null) return fail("That cursor is not one this server gave out. Repeat the search without it.");

      const filters: BlockFilters = {};
      if (blockType) filters.block = [blockType];
      if (pageType) filters.page = [pageType];
      if (industry) filters.industry = [industry];
      if (a.platform) filters.platform = [lower(a.platform)!];
      if (a.app) {
        const app = await appName(a.app);
        if (!app) return fail(noApp(a.app));
        filters.app = [app];
      }
      if (a.viewport) filters.vp = [a.viewport];
      if (a.store) filters.host = [lower(a.store)!.replace(/^https?:\/\//, "").replace(/\/.*$/, "")];
      if (a.has_video !== undefined) filters.video = [a.has_video ? "yes" : "no"];

      const found = await findBlocks({
        query: a.query, filters, tags: { styleTags: styleTag ? [styleTag] : undefined, hasPrice: a.has_price, hasReviews: a.has_reviews },
        limit: a.limit, offset, full: a.detail === "full", origin,
      });
      const cursor = found.hasMore ? encodeCursor(offset + found.items.length) : null;
      const head = found.items.length ? `${found.total} matches; showing ${offset + 1}-${offset + found.items.length}.` : "No blocks match.";
      const hint = !found.items.length && (blockType || styleTag || a.has_price !== undefined || a.has_reviews !== undefined)
        ? " Tagger filters only match tagged blocks; try `query` instead (see tagging in blimp_list_taxonomy)." : "";
      return ok({ items: found.items, total: found.total, has_more: found.hasMore, cursor },
        [head + hint, ...found.items.map(line), cursor ? `More: pass cursor "${cursor}".` : ""].filter(Boolean).join("\n"));
    },
  );

  server.registerTool(
    "blimp_get_block",
    {
      title: "Get one block",
      description:
        "One block in full: store, page, position, block type and tagger output, up to 400 characters of its visible text, " +
        "screenshot and thumbnail URLs, and the capture date. Includes the measured outline and style for captures made with design metadata; null with a note for older ones.",
      inputSchema: z.object({
        id: z.string().describe("A block id from blimp_search_blocks"),
        include: z.array(z.enum(BLOCK_INCLUDES)).max(BLOCK_INCLUDES.length).optional()
          .describe("Optional detail fields. Left out, all four are returned for compatibility."),
      }),
      outputSchema: blockItem,
      annotations: READ_ONLY,
    },
    async ({ id, include }) => {
      const block = await getBlock(id.trim(), origin);
      if (!block) return fail(`No block with id '${id}'. Ids come from blimp_search_blocks.`);
      const wanted = new Set(include ?? BLOCK_INCLUDES);
      const selected: McpBlock = { ...block };
      if (!wanted.has("outline")) delete selected.outline;
      if (!wanted.has("style")) { delete selected.style; delete selected.style_note; }
      if (!wanted.has("text")) delete selected.text;
      if (!wanted.has("image")) delete selected.image_url;
      return ok(selected, `${line(block).slice(2)}\nCaptured ${block.captured_at.slice(0, 10)} from ${block.page_url}\n` +
        `${wanted.has("text") && block.text ? `Text: ${block.text}\n` : ""}` +
        `${wanted.has("image") ? `Image: ${block.image_url ?? "none"}\n` : ""}` +
        `${wanted.has("style") ? `Style: ${block.style ? "measured (outline and style in the structured result)" : `null (${STYLE_NOTE})`}` : ""}`);
    },
  );

  server.registerTool(
    "blimp_search_stores",
    {
      title: "Search stores",
      description: "Find stores in the library by name or domain words, industry, platform, country (ISO code) or an app they run. Most-visited stores first. At most 20; page on with `cursor`.",
      inputSchema: z.object({
        query: z.string().max(100).optional(),
        industry: z.string().optional(),
        platform: z.string().optional(),
        country: z.string().length(2).optional().describe("ISO 3166 code, e.g. 'US', 'GB'"),
        app: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_ITEMS).default(10),
        cursor: z.string().optional(),
      }),
      outputSchema: page(storeItem),
      annotations: READ_ONLY,
    },
    async (a) => {
      const industry = lower(a.industry);
      const error = check("industry", industry, INDUSTRIES);
      if (error) return fail(error);
      const offset = decodeCursor(a.cursor);
      if (offset === null) return fail("That cursor is not one this server gave out. Repeat the search without it.");
      const app = a.app ? await appName(a.app) : undefined;
      if (app === null) return fail(noApp(a.app!));
      const found = await findStores({ query: a.query, industry, platform: lower(a.platform), country: a.country, app, limit: a.limit, offset });
      const cursor = found.hasMore ? encodeCursor(offset + found.items.length) : null;
      return ok({ items: found.items, total: found.total, has_more: found.hasMore, cursor },
        [found.items.length ? `${found.total} stores; showing ${offset + 1}-${offset + found.items.length}.` : "No stores match.",
          ...found.items.map((s) => `- ${s.host} · ${s.brand} · ${s.industry ?? "?"} · ${s.platform ?? "unknown platform"}${s.theme ? ` (${s.theme})` : ""}`),
          cursor ? `More: pass cursor "${cursor}".` : ""].filter(Boolean).join("\n"));
    },
  );

  server.registerTool(
    "blimp_get_store",
    {
      title: "Get one store",
      description: "One store: industry, country, platform, theme, page builder, apps, every captured page with its block count and capture date, and the capture history.",
      inputSchema: z.object({ host: z.string().describe("The store's domain, e.g. 'myzoobox.com'") }),
      outputSchema: storeItem.extend({
        title: z.string().nullable(),
        pages: z.array(z.object({ url: z.string(), type: z.string(), captured_at: z.string(), blocks: z.number(),
          desktop_thumbnail_url: z.string().nullable(), mobile_thumbnail_url: z.string().nullable() })),
        captures: z.array(z.object({ captured_at: z.string(), pages: z.number() })),
        design: z.string().nullable(), design_note: z.string().optional(), blimp_url: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async ({ host }) => {
      const store = await getStore(host, origin);
      if (!store) return fail(`No store '${host}' in the library. Find stores with blimp_search_stores.`);
      return ok(store, `${store.brand} (${store.host}) · ${store.industry ?? "?"} · ${store.platform ?? "unknown platform"}${store.theme ? ` · theme ${store.theme}` : ""}\n` +
        `Apps: ${store.apps.join(", ") || "none detected"}\n` +
        `Pages: ${store.pages.map((p) => `${p.type} (${p.blocks} blocks, ${p.captured_at.slice(0, 10)})`).join("; ") || "none"}\n` +
        `Design: ${store.design ?? `null (${store.design_note})`}`);
    },
  );

  // ---------------------------------------------------------------- v2: design data (brief section 9.2)

  server.registerTool(
    "blimp_get_store_design",
    {
      title: "Get a store's design system",
      description:
        "A store's design system in one record, measured from its rendered pages: heading, body and UI fonts, type scale, each heading level's size, " +
        "weight and case (and how consistent it is across pages), palette roles with the accent, primary and secondary buttons, corner radius, spacing, " +
        "page lengths, product grid columns and image ratios, consistency counts, accessibility signals, and a DESIGN.md-style `summary`. " +
        "Null with a note for stores not yet captured with design metadata. `viewport` narrows the per-page layout list.",
      inputSchema: z.object({ host: z.string().describe("The store's domain, e.g. 'myzoobox.com'"), viewport: z.enum(VIEWPORTS).optional() }),
      outputSchema: z.object({
        host: z.string(), brand: z.string(), industry: z.string().nullable(),
        design: z.record(z.string(), z.unknown()).nullable(), built_at: z.string().nullable(), design_note: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ host, viewport }) => {
      const found = await storeDesign(host);
      if (!found) return fail(`No store '${host}' in the library. Find stores with blimp_search_stores.`);
      const d = found.design;
      if (!d) return ok({ ...found, design: null }, `${found.brand} (${found.host}): design null (${found.design_note}).`);
      const design = viewport ? { ...d, layout: { ...d.layout, pages: d.layout.pages.filter((p) => p.viewport === viewport) } } : d;
      const t = d.typography;
      return ok({ ...found, design: design as unknown as Record<string, unknown> },
        `${found.brand} (${found.host}), built ${found.built_at?.slice(0, 10)} from ${d.sources.map((s) => `${s.pageType} (${s.capturedAt.slice(0, 10)})`).join(", ")}.\n` +
        `${d.summary}\nFonts: headings ${t.heading ?? "?"}, body ${t.body ?? "?"}, UI ${t.ui ?? "?"}. ` +
        `Consistency: ${d.consistency.families} families, ${d.consistency.sizes} sizes, ${d.consistency.textColours} text colours, ${d.consistency.buttonVariants} button variants.`);
    },
  );

  server.registerTool(
    "blimp_get_page_profile",
    {
      title: "Get one page's design profile",
      description:
        "The measured design profile of one of a store's pages at desktop and phone width: type scale and font families, every heading level " +
        "(count, size, weight, family, case, length) with hierarchy checks, palette roles, button variants and the primary one, shape, spacing, " +
        "page length and density, component counts and accessibility signals. Null with a note for pages captured before design metadata was collected.",
      inputSchema: z.object({
        host: z.string().describe("The store's domain"),
        page_type: z.string().describe("home, collection, product, cart, ..."),
        viewport: z.enum(VIEWPORTS).optional().describe("Both when left out"),
      }),
      outputSchema: z.object({
        host: z.string(), page_type: z.string(), page_url: z.string(), captured_at: z.string(),
        profiles: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()), profile_note: z.string().optional(), other_pages: z.array(z.string()),
      }),
      annotations: READ_ONLY,
    },
    async ({ host, page_type, viewport }) => {
      const pageType = lower(page_type)!;
      const error = check("page_type", pageType, PAGE_TYPES);
      if (error) return fail(error);
      const found = await pageProfile(host, pageType, viewport);
      if (!found) {
        return (await storeDesign(host))
          ? fail(`'${host}' has no ${pageType} page captured. blimp_get_store lists the pages it has.`)
          : fail(`No store '${host}' in the library. Find stores with blimp_search_stores.`);
      }
      const lines = Object.entries(found.profiles).map(([vp, p]) => {
        if (!p) return `${vp}: null (${PAGE_STYLE_NOTE})`;
        const h = p.headings.levels.filter((l) => l.count > 0).map((l) => `h${l.level}×${l.count} ${l.size}px ${l.family ?? ""}`.trim()).join(", ");
        return `${vp}: body ${p.typography.bodySize ?? "?"}px; ${h || "no headings"}; ${p.layout.screens} screens, ${p.layout.blocks} blocks${p.partial ? " (partial)" : ""}`;
      });
      return ok(found as unknown as Record<string, unknown>,
        `${found.host} ${found.page_type} page, captured ${found.captured_at.slice(0, 10)} from ${found.page_url}\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "blimp_get_store_flow",
    {
      title: "Get a store's shopping flow",
      description:
        "A store's home, collection, product and cart pages in order, each with its sections top to bottom: position, block type (null when untagged, " +
        "with the theme's own section name in type_hint), headline and height. At most 20 sections per page; `more_blocks` counts the rest.",
      inputSchema: z.object({ host: z.string().describe("The store's domain"), viewport: z.enum(VIEWPORTS).default("desktop") }),
      outputSchema: z.object({
        host: z.string(),
        steps: z.array(z.object({
          page_type: z.string(), page_url: z.string(), captured_at: z.string(), viewport: z.string(),
          blocks: z.array(z.object({ id: z.string(), position: z.number(), block_type: z.string().nullable(), type_hint: z.string(), headline: z.string().nullable(), height: z.number() })),
          more_blocks: z.number(),
        })),
        missing: z.array(z.string()),
      }),
      annotations: READ_ONLY,
    },
    async ({ host, viewport }) => {
      const flow = await storeFlow(host, viewport);
      if (!flow) return fail(`No store '${host}' in the library. Find stores with blimp_search_stores.`);
      const text = flow.steps.map((s) => `${s.page_type} (${s.captured_at.slice(0, 10)}): ` +
        s.blocks.map((b) => b.block_type ?? `${b.type_hint}*`).join(" → ") + (s.more_blocks ? ` (+${s.more_blocks} more)` : ""));
      return ok(flow, [`${flow.host}, ${viewport}. * = untagged, theme section name.`, ...text,
        flow.missing.length ? `Not captured: ${flow.missing.join(", ")}.` : ""].filter(Boolean).join("\n"));
    },
  );

  server.registerTool(
    "blimp_get_benchmark",
    {
      title: "Get what is typical",
      description:
        "What is typical across stores, per industry ('all' for every one), page type ('all' for every page) and viewport: for numeric metrics " +
        "the number of stores measured (n) and the 25th, 50th and 75th percentiles; for categorical metrics the share of stores per value; for " +
        "'block:<block_type>' the share of stores that have that block on the page type and its median position (1 = top). Only published from " +
        `${MIN_BENCHMARK_N} stores. Numeric: ${Object.entries(NUMERIC_BENCHMARKS).map(([k, v]) => `${k} (${v})`).join("; ")}. ` +
        `Categorical: ${Object.entries(CATEGORICAL_BENCHMARKS).map(([k, v]) => `${k} (${v})`).join("; ")}.`,
      inputSchema: z.object({
        industry: z.string().default("all").describe("From blimp_list_taxonomy, or 'all'"),
        page_type: z.string().describe("home, collection, product, ... or 'all'"),
        viewport: z.enum(VIEWPORTS).default("desktop"),
        metrics: z.array(z.string()).max(MAX_ITEMS).optional().describe("Leave out for every published metric"),
      }),
      outputSchema: z.object({
        industry: z.string(), page_type: z.string(), viewport: z.string(), stores: z.number(),
        items: z.array(z.object({ metric: z.string(), n: z.number(), p25: z.number().nullable(), p50: z.number().nullable(), p75: z.number().nullable(),
          shares: z.record(z.string(), z.number()).nullable(), meaning: z.string(), computed_at: z.string() })),
        not_published: z.array(z.string()),
        note: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const industry = lower(a.industry) ?? "all", pageType = lower(a.page_type)!;
      const metrics = a.metrics?.map((m) => m.trim().toLowerCase());
      const valid = [...Object.keys(NUMERIC_BENCHMARKS), ...Object.keys(CATEGORICAL_BENCHMARKS)];
      const badMetric = metrics?.find((m) => !valid.includes(m) && !(m.startsWith("block:") && BLOCK_TYPES.includes(m.slice(6) as never)));
      const error = check("industry", industry, [...INDUSTRIES, "all"]) ?? check("page_type", pageType, [...PAGE_TYPES, "all"]) ??
        (badMetric ? `Unknown metric '${badMetric}'. Valid: ${valid.join(", ")}, or 'block:<block_type>' with a type from blimp_list_taxonomy.` : null);
      if (error) return fail(error);

      const { rows, stores } = await benchmarks({ industry, pageType, viewport: a.viewport, metrics });
      const where = `${industry === "all" ? "all industries" : `'${industry}'`}, ${pageType === "all" ? "any page" : `${pageType} page`}, ${a.viewport}`;
      const meaning = (m: string) => (NUMERIC_BENCHMARKS as Record<string, string>)[m] ?? (CATEGORICAL_BENCHMARKS as Record<string, string>)[m] ??
        (m.startsWith("block:") ? `share of stores with a ${m.slice(6)} block on the page (shares.present) and its median position (p50, 1 = top)` : m);
      const items = rows.map((r) => ({ metric: r.metric, n: r.n, p25: r.p25, p50: r.p50, p75: r.p75, shares: r.shares, meaning: meaning(r.metric), computed_at: r.computedAt }));
      const notPublished = (metrics ?? []).filter((m) => !rows.some((r) => r.metric === m));
      const base = { industry, page_type: pageType, viewport: a.viewport, stores, items, not_published: notPublished };

      if (!items.length) {
        const why = stores < MIN_BENCHMARK_N
          ? `Only ${stores} store${stores === 1 ? "" : "s"} in ${where} ${stores === 1 ? "has" : "have"} that page captured; not enough to say what is typical (needs ${MIN_BENCHMARK_N}).`
          : `${stores} stores have that page captured, but fewer than ${MIN_BENCHMARK_N} were measured for ${metrics?.length ? metrics.join(", ") : "any metric"}. ` +
            "Style metrics need captures made with design metadata; block metrics need tagged blocks.";
        return ok({ ...base, note: why }, why);
      }
      const fmt = (i: (typeof items)[number]) => i.shares && i.p50 === null
        ? `${i.metric}: ${Object.entries(i.shares).map(([v, s]) => `${v} ${Math.round(s * 100)}%`).join(", ")} (n=${i.n})`
        : `${i.metric}: median ${i.p50}, middle half ${i.p25}–${i.p75}${i.shares ? `, on ${Math.round((i.shares.present ?? 0) * 100)}% of stores` : ""} (n=${i.n})`;
      const note = notPublished.length ? `Not published (fewer than ${MIN_BENCHMARK_N} stores measured): ${notPublished.join(", ")}.` : undefined;
      return ok({ ...base, ...(note ? { note } : {}) }, [`${where}, ${stores} stores with that page:`, ...items.map(fmt), note ?? ""].filter(Boolean).join("\n"));
    },
  );

  server.registerTool(
    "blimp_find_similar_blocks",
    {
      title: "Find similar blocks",
      description:
        "Blocks like this one from other stores, one per store, same viewport. Nearest by meaning when the block has a search vector; otherwise " +
        "the same kind of section, ranked by colour family, page type, platform and shape. `basis` says which.",
      inputSchema: z.object({ id: z.string().describe("A block id from blimp_search_blocks"), limit: z.number().int().min(1).max(MAX_ITEMS).default(8) }),
      outputSchema: z.object({ source: blockItem, basis: z.enum(["embedding", "section"]), items: z.array(blockItem) }),
      annotations: READ_ONLY,
    },
    async ({ id, limit }) => {
      const found = await similarBlocks(id.trim(), limit, origin);
      if (!found) return fail(`No block with id '${id}'. Ids come from blimp_search_blocks.`);
      return ok(found, [`Like ${line(found.source).slice(2)} (by ${found.basis === "embedding" ? "meaning" : "section type"}):`,
        ...(found.items.length ? found.items.map(line) : ["No similar block in another store."])].join("\n"));
    },
  );

  return server;
}
