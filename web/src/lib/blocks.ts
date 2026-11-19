// The Block shape is a cross-lane contract: it lives in src/contracts.
import type { Block } from "@/contracts/block";
export type { Block, BlockSet } from "@/contracts/block";

export const PAGE_TYPE_LABEL: Record<string, string> = {
  home: "Home",
  collection: "Collection",
  product: "Product",
  cart: "Cart",
  checkout: "Checkout",
  page: "Page",
  blog: "Blog",
  article: "Article",
  other: "Other",
};

/**
 * What makes two blocks the same section of a store: a product grid is
 * captured as a block per product card and a header once per page, so one
 * store would otherwise show the same section many times. Same store,
 * viewport and type, a "-part" slice counting as its section. The API
 * applies the same rule in SQL (SHOWN in server/blocks.ts).
 */
export function sectionKey(block: Block): string {
  return [block.host, block.viewport, block.typeHint.replace(/-part$/, "")].join("\u0000");
}

/** Pages in the order a visitor meets them: of a repeated section, the copy from the earliest is the one kept. */
const PAGE_RANK = ["home", "collection", "product"];
const pageRank = (b: Block) => (PAGE_RANK.indexOf(b.pageType) + PAGE_RANK.length + 1) % (PAGE_RANK.length + 1);
const isPart = (b: Block) => b.typeHint.endsWith("-part");

/** Which of two copies of a section to keep: earlier page, then a whole section over a slice, then page URL. */
function keepsOver(b: Block, kept: Block): boolean {
  if (pageRank(b) !== pageRank(kept)) return pageRank(b) < pageRank(kept);
  if (isPart(b) !== isPart(kept)) return !isPart(b);
  return b.pageUrl < kept.pageUrl;
}

/**
 * `blocks` with one block per section of each store, in their original order.
 * The first on its page wins a tie. The scale fixture's blocks (`mock`, see
 * lib/mock-blocks.ts) all stay: they are the sample re-hosted on purpose, and
 * the wall preview is meant to hold all 30,000 of them.
 */
export function shownBlocks(blocks: Block[]): Block[] {
  const keep = new Map<string, Block>();
  for (const b of blocks) {
    if ((b as Block & { mock?: boolean }).mock) continue;
    const key = sectionKey(b), kept = keep.get(key);
    if (!kept || keepsOver(b, kept)) keep.set(key, b);
  }
  const shown = new Set(keep.values());
  return blocks.filter((b) => shown.has(b) || (b as Block & { mock?: boolean }).mock);
}

/**
 * "unknown" is what capture writes when a section carries no name at all
 * (src/page-script.ts). It is a gap in our labelling, not a kind of block, so
 * it is never offered as a filter, a category or a search result. The AI
 * tagger (platform/src/tagger.ts) replaces it with a real type once it runs.
 */
export const isUnnamed = (typeHint: string) => typeHint === "unknown" || typeHint === "unknown-part";

/** A block-type facet without the unnamed bucket, for anything a person chooses from. */
export function namedOnly<T extends { value: string }>(options: T[]): T[] {
  return options.filter((o) => !isUnnamed(o.value));
}

/** "featured-collection" -> "Featured collection" */
export function labelFor(typeHint: string): string {
  // Capture found no name for it. Nobody should read "Unknown" on a card: it
  // is a section like any other, just one without a label yet.
  if (isUnnamed(typeHint)) return "Section";
  const s = typeHint.replace(/-part$/, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Block";
}

/**
 * The low-quality placeholder for a block, if there is one.
 *
 * Contract v1 gives the wall one colour signal, `bg`, which is what the card
 * paints while the screenshot loads. SEC-9 (Lane A) is due to put real blur
 * placeholders in object storage alongside the WebP and the thumbnails; when
 * `Block` gains that field this reads it and the cards need no change. Until
 * then it returns undefined and the background colour does the job.
 */
export function blurOf(block: Block): string | undefined {
  return (block as Block & { blur?: string }).blur;
}

/**
 * The block's 600px thumbnail, when it shows the whole block. The wall's
 * cards are at most a few hundred pixels wide, and the full screenshot is
 * 2,880 pixels wide on desktop, often ten times the bytes, so the wall loads
 * this and the detail view the full one.
 *
 * /api/blocks sends `thumb` ahead of the contract, the way `blur` is meant to
 * arrive. The image pipeline (src/images.ts) crops a thumbnail at 1,200 pixels
 * tall, so a block more than twice as tall as it is wide gets the full image:
 * its thumbnail would stop partway down. The sample has no thumbnails.
 */
export function thumbOf(block: Block): string | undefined {
  const thumb = (block as Block & { thumb?: string }).thumb;
  return thumb && block.h <= block.w * 2 ? thumb : undefined;
}

/**
 * One file of a block's screenshot. `w` and `h` give its shape: the file's
 * pixels for a slice, the block's CSS size for a whole screenshot.
 */
export type Shot = { src: string; w: number; h: number };

/** Rows in one slice of a tall screenshot: DEFAULT_SLICE_HEIGHT in the image pipeline (src/images.ts). */
const SLICE_ROWS = 8192;

/** Screenshots are captured at two image pixels per CSS pixel. */
const CAPTURE_SCALE = 2;

/**
 * The files that make up the block's screenshot, top to bottom. WebP stops at
 * 16,383 rows, so the image pipeline cuts a taller screenshot into slices
 * ("…_s000.webp", "…_s001.webp") and `src` is only the first of them: drawn
 * alone over the block's whole height it is stretched and blurred. Draw each
 * shot at full width and its own height, one under the other.
 *
 * /api/blocks sends `slices` ahead of the contract, the way `thumb` arrives.
 * Without it the slices are worked out from the first one's name and the
 * block's height, which is how the pipeline cut them.
 */
export function shotsOf(block: Block): Shot[] {
  const sent = (block as Block & { slices?: Shot[] }).slices;
  if (sent && sent.length > 0) return sent;
  const first = /^(.*)_s000(\.webp(?:\?.*)?)$/.exec(block.src);
  if (!first) return [{ src: block.src, w: block.w, h: block.h }];
  const w = block.w * CAPTURE_SCALE;
  const rows = Math.max(1, Math.round(block.h * CAPTURE_SCALE));
  const shots: Shot[] = [];
  for (let top = 0; top < rows; top += SLICE_ROWS) {
    shots.push({ src: `${first[1]}_s${String(shots.length).padStart(3, "0")}${first[2]}`, w, h: Math.min(SLICE_ROWS, rows - top) });
  }
  return shots;
}

/**
 * Where a page's full-size screenshot is, worked out from its thumbnail's
 * address. The image pipeline stores "…/desktop_thumb.webp" beside
 * "…/desktop.webp", or beside "…/desktop_s000.webp", "…/desktop_s001.webp"
 * and so on when the page is taller than WebP allows; which of the two, and
 * how many slices, only loading them tells. Null when the address is not a
 * thumbnail's.
 */
export function captureFiles(thumb: string): { whole: string; slice: (n: number) => string } | null {
  const found = /^(.*)_thumb(\.webp(?:\?.*)?)$/.exec(thumb);
  if (!found) return null;
  return { whole: `${found[1]}${found[2]}`, slice: (n) => `${found[1]}_s${String(n).padStart(3, "0")}${found[2]}` };
}

/** How far down its page a block starts, in CSS pixels, when the source says (/api/sites/[host]/page does, ahead of the contract). */
function topOf(block: Block): number | undefined {
  const top = (block as Block & { top?: number }).top;
  return typeof top === "number" && Number.isFinite(top) ? top : undefined;
}

/**
 * Where each block starts on a page `pageHeight` CSS pixels tall: where the
 * capture measured it, when every block says. Otherwise an estimate: the
 * blocks one after another, scaled to the page's height, which is right for
 * a page of full-width sections and near enough for the rest.
 */
function blockTops(blocks: Block[], pageHeight: number): number[] {
  const measured = blocks.map(topOf);
  if (measured.every((top) => top !== undefined)) return measured as number[];
  const total = blocks.reduce((sum, b) => sum + b.h, 0) || 1;
  let above = 0;
  return blocks.map((b) => {
    const top = (above / total) * pageHeight;
    above += b.h;
    return top;
  });
}

/** How far down a page (`pageHeight` CSS pixels tall) block `at` of `blocks` starts. */
export function blockTop(blocks: Block[], at: number, pageHeight: number): number {
  return blockTops(blocks, pageHeight)[at] ?? 0;
}

/**
 * The block at height `y` on a page, both in CSS pixels: the one that spans
 * it (the first of them, where blocks sit side by side), else the nearest.
 * -1 for a page with no blocks.
 */
export function blockAt(blocks: Block[], y: number, pageHeight: number): number {
  const tops = blockTops(blocks, pageHeight);
  const scale = blocks.every((b) => topOf(b) !== undefined) ? 1 : pageHeight / (blocks.reduce((sum, b) => sum + b.h, 0) || 1);
  let nearest = -1;
  let gap = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const top = tops[i];
    const bottom = top + blocks[i].h * scale;
    if (y >= top && y < bottom) return i;
    const away = y < top ? top - y : y - bottom;
    if (away < gap) {
      gap = away;
      nearest = i;
    }
  }
  return nearest;
}
