// Public API answers kept in the server's memory.
//
// On Vercel the CDN kept /api/blocks and /api/sites for ten minutes
// (PUBLIC_CACHE's s-maxage), so a visitor almost never waited on the database.
// On AWS (ECS Express Mode, docs/AWS.md) nothing sits in front of the app:
// the load balancer caches nothing, so every wall page ran the full query,
// about two seconds warm and over ten cold. An ECS task is a long-running
// server, unlike a Vercel function, so it can keep answers itself.
//
// The same rule as the CDN had: fresh for ten minutes, then the old answer is
// served at once while a new one is built behind it, for up to a day. Identical
// requests that arrive while an answer is being built share it. Only answers
// every visitor gets alike go in here (no session, no personal filters).
//
// Held on globalThis: Next.js may load this module more than once (each route
// bundle, instrumentation), and they must all share one cache.
//
// Answers go out compressed. The Next.js server gzips pages but not what a
// route handler returns, so /api/sites and /api/blocks went to every browser
// as plain JSON: the Sites list was 2.2 MB over the wire, where gzip makes it
// 290 KB. An answer is compressed once, the first time a browser asks for it
// that way (Brotli, or gzip), and the compressed copy is kept with it, so no
// request pays for it again.

import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const FRESH_MS = 10 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
/** Roughly what the cached bodies may take, in characters; the least recently used go first. */
const BUDGET = 150_000_000;

type Encoding = "br" | "gzip";
type Entry = { at: number; body: string; headers: Record<string, string>; status: number; size: number; packed?: Partial<Record<Encoding, Buffer>> };

/** Shorter answers go as they are: compressing them saves nothing worth the header. */
const PACK_FROM = 1024;

/**
 * What the request's Accept-Encoding allows, Brotli first: it is a fifth
 * smaller than gzip on this JSON. Null for a client that takes neither, or
 * refuses one ("br;q=0").
 */
export function encodingFor(accept: string | null | undefined): Encoding | null {
  if (!accept) return null;
  const takes = (name: string) =>
    accept.split(",").some((part) => {
      const [coding, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((x) => x.trim()).find((x) => x.startsWith("q="));
      return coding.trim() === name && (!q || Number(q.slice(2)) > 0);
    });
  return takes("br") ? "br" : takes("gzip") ? "gzip" : null;
}

/** The entry's body in this encoding: made on first use, then kept with the entry and counted against the budget. */
function packed(s: Store, key: string, entry: Entry, encoding: Encoding): Buffer {
  const have = entry.packed?.[encoding];
  if (have) return have;
  const made =
    encoding === "br"
      ? // Quality 5: about gzip's speed (a few milliseconds for the largest answers) and still well under its size.
        brotliCompressSync(entry.body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(entry.body) } })
      : gzipSync(entry.body, { level: 6 });
  entry.packed = { ...entry.packed, [encoding]: made };
  entry.size += made.length;
  // Only an entry still in the cache counts: one replaced while this request waited is on its way out.
  if (s.entries.get(key) === entry) s.size += made.length;
  return made;
}

type Store = { entries: Map<string, Entry>; pending: Map<string, Promise<Entry>>; size: number };

declare global {
  var sectionaryResponses: Store | undefined;
}

const store = (): Store => (globalThis.sectionaryResponses ??= { entries: new Map(), pending: new Map(), size: 0 });

/** A cache key for a request: its path and its query, in a fixed order so `?a=1&b=2` and `?b=2&a=1` share an entry. */
export function keyOf(url: URL): string {
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `${url.pathname}?${new URLSearchParams(params)}`;
}

function remember(s: Store, key: string, entry: Entry) {
  const old = s.entries.get(key);
  if (old) {
    s.size -= old.size;
    s.entries.delete(key);
  }
  s.entries.set(key, entry);
  s.size += entry.size;
  // A Map keeps insertion order, and every hit re-inserts, so the first key is the least recently used.
  for (const [k, e] of s.entries) {
    if (s.size <= BUDGET) break;
    s.entries.delete(k);
    s.size -= e.size;
  }
}

function build(s: Store, key: string, make: () => Promise<{ body: unknown; headers?: Record<string, string>; status?: number }>): Promise<Entry> {
  let pending = s.pending.get(key);
  if (!pending) {
    pending = make().then(({ body, headers = {}, status = 200 }) => {
      const text = JSON.stringify(body);
      const entry = { at: Date.now(), body: text, headers, status, size: text.length };
      remember(s, key, entry);
      return entry;
    });
    const settle = () => s.pending.delete(key);
    pending.then(settle, settle);
    s.pending.set(key, pending);
  }
  return pending;
}

/**
 * A JSON response from the cache, or built by `make` and kept. `headers` go
 * on every response (the Cache-Control); `make` may add its own, which are
 * kept with the body. `x-cache` says which it was: hit, stale or miss.
 * A failed build is not kept, and its error reaches the caller.
 *
 * `request` is the request being answered: with it the body goes out in the
 * best encoding its Accept-Encoding allows (see `packed`). Without it, plain.
 */
export async function cachedJson(
  key: string,
  headers: Record<string, string>,
  make: () => Promise<{ body: unknown; headers?: Record<string, string>; status?: number }>,
  request?: Request,
): Promise<Response> {
  const s = store();
  const hit = s.entries.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  let entry: Entry;
  let state: "hit" | "stale" | "miss";
  if (hit && age < FRESH_MS + STALE_MS) {
    // Used: to the back of the queue, so it is the last to go.
    s.entries.delete(key);
    s.entries.set(key, hit);
    entry = hit;
    state = age < FRESH_MS ? "hit" : "stale";
    if (state === "stale") build(s, key, make).catch((error) => console.error("cache refresh failed", key, error));
  } else {
    entry = await build(s, key, make);
    state = "miss";
  }
  const base = { "content-type": "application/json", ...headers, ...entry.headers, "x-cache": state };
  if (!request || entry.body.length < PACK_FROM) return new Response(entry.body, { status: entry.status, headers: base });
  // The same address answers differently by encoding: anything that keeps responses (a CDN) must know.
  const encoding = encodingFor(request.headers.get("accept-encoding"));
  if (!encoding) return new Response(entry.body, { status: entry.status, headers: { ...base, vary: "Accept-Encoding" } });
  const body = packed(s, key, entry, encoding);
  return new Response(new Uint8Array(body), {
    status: entry.status,
    headers: { ...base, "content-encoding": encoding, "content-length": String(body.length), vary: "Accept-Encoding" },
  });
}
