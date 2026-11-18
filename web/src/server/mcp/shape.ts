// Pure helpers for the MCP server's responses (SEC-31, brief section 9.3).
// No imports, so node --test can load it as is (src/server/mcp-shape.test.ts).

/** Never more than this many items in one response. */
export const MAX_ITEMS = 20;
/** Page types the crawler assigns (pageType in src/capture-page.ts), for checking filters. */
export const PAGE_TYPES = ["home", "collection", "collection-list", "product", "cart", "checkout", "search", "account", "article", "blog", "page", "other"];
/** Characters of a block's visible text an agent gets, the same as the API. */
export const MAX_TEXT = 400;

/** An opaque cursor for an offset. Opaque so we can change what it holds later. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, "utf8").toString("base64url");
}

/** The offset in a cursor, 0 for none, null when the cursor is not one of ours. */
export function decodeCursor(cursor: string | undefined | null): number | null {
  if (!cursor) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return m ? Number(m[1]) : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

/**
 * The closest valid values to what an agent sent, best first: values that
 * contain it or share a word with it, then by edit distance. "reviews" finds
 * "product-reviews"; "testimonial" finds "testimonials".
 */
export function closest(input: string, valid: readonly string[], n = 3): string[] {
  const want = input.trim().toLowerCase();
  const words = want.split(/[\s_-]+/).filter(Boolean);
  const score = (v: string) => {
    const parts = v.split("-");
    if (v.includes(want) || want.includes(v)) return 0;
    if (words.some((w) => parts.some((p) => p.startsWith(w) || w.startsWith(p)))) return 1;
    return 2 + distance(want, v) / Math.max(want.length, v.length);
  };
  return [...valid]
    .map((v) => ({ v, s: score(v) }))
    .filter(({ s }) => s < 2.5)
    .sort((a, b) => a.s - b.s || a.v.localeCompare(b.v))
    .slice(0, n)
    .map(({ v }) => v);
}

/** The error an agent can act on: what was wrong, what is close, where the full list is. */
export function unknownValue(field: string, value: string, valid: readonly string[]): string {
  const near = closest(value, valid);
  const hint = near.length ? ` Closest: ${near.map((v) => `'${v}'`).join(", ")}.` : "";
  return `Unknown ${field} '${value}'.${hint} Call blimp_list_taxonomy for the full list.`;
}

/**
 * Keys that would carry a store's source rather than our measurements
 * (docs/bot-page.md: we never copy a store's code). The manifest keeps a
 * block element's tag, id and classes for the importer; none of it is served.
 */
const SOURCE_KEYS = new Set(["tag", "classes", "class", "className", "html", "css", "style_attr", "inlineStyle", "selector", "elementId"]);

/** `value` with every source-like key removed, at any depth. A guard, not the main defence: queries never select those columns. */
export function withoutSource<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutSource) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([k]) => !SOURCE_KEYS.has(k)).map(([k, v]) => [k, withoutSource(v)]),
    ) as T;
  }
  return value;
}

/** Text cut to `max` characters on a word boundary where one is near. */
export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.7 ? cut.slice(0, space) : cut}…`;
}
