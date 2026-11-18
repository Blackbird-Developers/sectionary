// CONTRACT v1 · the HTTP API between the platform (Lane B) and the web app
// (Lane C). Until the endpoints exist the web app reads /sample/*.json, which
// carries the same item shapes. See docs/CONTRACTS.md for the rules.

import type { Block, Viewport } from "./block";
import type { Benchmark, StoreDesignProfile } from "./design";
import type { BlockStyle, OutlineNode } from "./manifest";
import type { Store } from "./store";

export const CONTRACT_VERSION = 1;

/** Cursor pagination everywhere: opaque cursor in, next cursor (or null) out. */
export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** GET /api/blocks · every filter is optional and multi-value filters are comma-separated. */
export type BlocksQuery = {
  page?: string;
  block?: string;
  vp?: Viewport;
  platform?: string;
  theme?: string;
  app?: string;
  industry?: string;
  country?: string;
  host?: string;
  q?: string;
  cursor?: string;
  /** Default 60, maximum 200. */
  limit?: number;
};
export type BlocksResponse = Page<Block> & { facets?: Record<string, { value: string; count: number }[]> };

/** GET /api/stores */
export type StoresQuery = { platform?: string; industry?: string; country?: string; q?: string; sort?: "rank" | "brand" | "platform" | "industry"; cursor?: string; limit?: number };
export type StoresResponse = Page<Store>;

/** GET /api/sites/[host] */
export type SiteProfile = {
  store: Store;
  pages: { url: string; type: string; title: string | null; capturedAt: string; desktop: string | null; mobile: string | null; blocks: number }[];
  captures: { capturedAt: string; pages: number }[];
};

/**
 * Boards (additive, M3). Until accounts exist a board is owned by whoever holds
 * its edit token: POST /api/boards returns it once, and every write sends it as
 * the `x-board-token` header. `shareSlug` is the public read-only link
 * (/b/<slug>), live while `shared` is true.
 */
export type BoardItem = {
  /** What was saved: a block (blockId, block) or, since migration 16, a whole site (host, site). Absent means "block". */
  kind?: "block" | "site";
  /** The block's id; null for a site item. */
  blockId: string | null;
  /** The saved site's host; null (or absent) for a block item. */
  host?: string | null;
  note: string | null;
  position: number;
  block: Block | null;
  /** The saved site's store, null when it has left the library. */
  site?: Store | null;
};
export type Board = {
  id: string;
  /** "folder": named, ordered, shareable (every board before migration 16). "library": the account's one Saved list. Absent means "folder". */
  kind?: "folder" | "library";
  name: string;
  description: string | null;
  shareSlug: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  items: BoardItem[];
};
/** POST /api/boards body. The response is BoardCreated (201). `kind: "library"` returns the account's Saved list, made if it has none. */
export type BoardCreate = { name: string; description?: string | null; kind?: "folder" | "library" };
export type BoardCreated = { board: Board; token: string };
/** PATCH /api/boards/[id]. `order` is the complete list of item keys (a block's id, a site's host) in their new order. */
export type BoardPatch = { name?: string; description?: string | null; shared?: boolean; order?: string[] };
/**
 * POST /api/boards/[id]/items adds a block, or a site by `host` (idempotent). PATCH and DELETE
 * /api/boards/[id]/items/[key] take the item's key: a block's id, or a site's host.
 */
export type BoardItemAdd = { blockId?: string; host?: string; note?: string | null };
/** GET /api/share/[slug] · what a client sees: no ids, no tokens, only shared boards. */
export type SharedBoard = { name: string; description: string | null; updatedAt: string; items: { note: string | null; block: Block }[] };

/**
 * GET /api/blocks/[id]/history · the time machine. Every capture of the block's
 * page, newest first, with the block that best matches this one in each
 * capture (same viewport and type, nearest position), or null when the page no
 * longer has one.
 */
export type BlockHistory = {
  blockId: string;
  page: { host: string; url: string; type: string; title: string | null };
  captures: {
    capturedAt: string;
    /** Full-page screenshot for the block's viewport, when known. */
    fullPage: { src: string; w: number; h: number } | null;
    block: Block | null;
    /** Block counts that changed against the previous capture (both viewports), when the importer recorded a diff. */
    diff: { added: number; removed: number; changed: number } | null;
  }[];
};

/**
 * POST /api/brief · "copy as design brief". Streams text/plain (Markdown). The
 * `x-brief-source` response header says `claude` or `template` (no API key on
 * the server, so the brief is assembled from the block's metadata).
 */
export type BriefTarget = "claude-code" | "cursor" | "designer";
export type BriefRequest = { blockId: string; target: BriefTarget };

/**
 * Accounts and plans (additive, M4 · SEC-27, SEC-28). Sign-in is a magic link;
 * the session is an httpOnly cookie, so the browser sends it with every
 * same-origin request and the API needs no token header.
 *
 * GET /api/account · `{ account: Account | null }` (null when signed out).
 * GET /api/boards · `{ items: Board[] }`, the signed-in account's boards (401 when signed out).
 * Board writes from a signed-in account need no `x-board-token`; a token board
 * opened by a signed-in account becomes that account's. With plan gates on,
 * creating and adding to boards answers 401 `SIGN_IN_REQUIRED` or 402
 * `PLAN_REQUIRED` for Free.
 */
export type Plan = "free" | "pro" | "team";
export type Account = {
  id: string;
  email: string;
  plan: Plan;
  /** Paddle subscription status (active, trialing, past_due, paused, canceled), null if never subscribed. */
  planStatus: string | null;
  seats: number;
  renewsAt: string | null;
  /** Set when the plan ends at this time (cancelled, running to the end of the period). */
  cancelAt: string | null;
  /** End of the seven-day Pro trial every account starts with. */
  trialEndsAt: string | null;
  /** What the account gets today: `plan`, or "pro" while the trial runs. */
  access: Plan;
  /** Two-step sign-in with an authenticator app is on. */
  twoStep: boolean;
};
/** Pro-only things the UI locks for Free and signed-out viewers ("open" is opening a block at all). */
// "mcp": the MCP server at /api/mcp with an API key (SEC-31). Pro and Team (owner decision, 18 Nov 2026).
export type Feature = "open" | "brief" | "history" | "boards" | "filters" | "copy-image" | "source-link" | "full-images" | "mcp";
/**
 * `gates` is false while PLAN_GATES is off (everything open). `features` is
 * what this viewer may use, signed out included.
 */
export type AccountResponse = { account: Account | null; views?: { used: number; limit: number | null }; gates?: boolean; features?: Feature[] };
/**
 * POST /api/views · `{ blockId }` when the detail view opens a block. The Free
 * plan's daily cap: `allowed: false` means show the upgrade prompt instead of
 * the block. `limit` is null when the viewer has no cap.
 */
export type ViewCheck = { allowed: boolean; used: number; limit: number | null; plan: Plan | null;
  /** Why not: signed out (opening a block needs an account) or today's cap is used up. */
  reason?: "SIGN_IN_REQUIRED" | "LIMIT" };

/**
 * Design data (additive, SEC-31 brief section 8). The same readers as the MCP
 * server, so both serve the same numbers. Measurements only, never source:
 * no HTML, CSS, class names or element ids. Missing data is null, never guessed.
 */

/**
 * GET /api/blocks/[id] · one Block plus its tagger output and, for captures
 * made with design metadata, its measured style and outline. The tagger
 * fields are null (and the lists empty) until the block is tagged; `style` and
 * `outline` are null for captures made before design metadata was collected.
 */
export type BlockDetail = Block & {
  capturedAt: string | null;
  blockType: string | null;
  pageRole: string | null;
  styleTags: string[];
  patterns: string[];
  /** The tagger's 200-character description. */
  description: string | null;
  /** The tagger version that wrote the fields above, null when untagged. */
  taggerVersion: string | null;
  style: BlockStyle | null;
  outline: OutlineNode[] | null;
};

/**
 * GET /api/sites/[host]/design · the store design profile (L3) and its
 * `summary`. `design` is null, with `note`, until a capture made with design
 * metadata is imported. The store's own accessibility signals go to signed-in
 * accounts only: signed out, `design.accessibility` is null and
 * `accessibilityNote` says why (benchmarks across stores stay public).
 */
export type SiteDesign = {
  host: string;
  brand: string;
  industry: string | null;
  design: (Omit<StoreDesignProfile, "accessibility"> & { accessibility: StoreDesignProfile["accessibility"] | null }) | null;
  builtAt: string | null;
  note?: string;
  accessibilityNote?: string;
};

/**
 * GET /api/benchmarks?industry=&page=&vp=&metric= · what is typical (L4).
 * `industry` and `page` default to "all", `vp` to desktop; `metric` is
 * comma-separated, every published metric when left out. Only rows measured
 * over at least `minN` stores exist, each with its `n`. `stores` is how many
 * stores have that page captured, so an empty `items` can say why.
 */
export type BenchmarksQuery = { industry?: string; page?: string; vp?: Viewport; metric?: string };
export type BenchmarksResponse = { industry: string; pageType: string; viewport: Viewport; stores: number; minN: number; items: Benchmark[] };

/** GET /api/taxonomy · the closed lists behind the filters, with what each value means, and how much of the library is tagged. */
export type Taxonomy = {
  blockTypes: { value: string; group: "global" | "ecommerce"; meaning: string }[];
  pageRoles: { value: string; meaning: string }[];
  styleTags: string[];
  industries: string[];
  pageTypes: { value: string; pages: number }[];
  platforms: { value: string; stores: number }[];
  viewports: Viewport[];
  tagging: { blocks: number; tagged: number; taggerVersion: string };
};

/** Every error response, any endpoint. */
export type ApiError = { error: string; code?: string };
