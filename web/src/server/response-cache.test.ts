// npm test (web): cached answers go out compressed to a browser that takes it, and plain otherwise. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { cachedJson, encodingFor } from "./response-cache.ts";

const HEADERS = { "Cache-Control": "public, max-age=120" };
/** A body the size of a real answer: repetitive JSON, as a page of sites is. */
const big = { items: Array.from({ length: 400 }, (_, n) => ({ host: `store-${n}.example`, pages: ["home", "collection", "product", "cart"] })) };
const asking = (accept?: string) => new Request("http://localhost/api/sites?limit=200", accept ? { headers: { "accept-encoding": accept } } : undefined);
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

test("a browser that takes Brotli gets Brotli, and the same JSON inside", async () => {
  let builds = 0;
  const make = async () => ({ body: (builds += 1) && big });
  const response = await cachedJson("test:br", HEADERS, make, asking("gzip, deflate, br, zstd"));
  assert.equal(response.headers.get("content-encoding"), "br");
  assert.equal(response.headers.get("vary"), "Accept-Encoding");
  assert.equal(response.headers.get("x-cache"), "miss");
  assert.equal(response.headers.get("cache-control"), HEADERS["Cache-Control"]);
  const sent = await bytes(response);
  assert.equal(response.headers.get("content-length"), String(sent.length));
  assert.deepEqual(JSON.parse(brotliDecompressSync(sent).toString()), big);
  assert.ok(sent.length < JSON.stringify(big).length / 4, "a quarter of the plain size at most");

  // Asked again: from the cache, not built again, byte for byte the same.
  const again = await cachedJson("test:br", HEADERS, make, asking("br"));
  assert.equal(again.headers.get("x-cache"), "hit");
  assert.equal(builds, 1);
  assert.deepEqual(await bytes(again), sent);
});

test("gzip for a client without Brotli, plain for one that takes neither", async () => {
  const make = async () => ({ body: big });
  const gzip = await cachedJson("test:gzip", HEADERS, make, asking("gzip, deflate"));
  assert.equal(gzip.headers.get("content-encoding"), "gzip");
  assert.deepEqual(JSON.parse(gunzipSync(await bytes(gzip)).toString()), big);

  const plain = await cachedJson("test:gzip", HEADERS, make, asking());
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(plain.headers.get("vary"), "Accept-Encoding");
  assert.deepEqual(await plain.json(), big);
});

test("without the request, and for a short answer, the body is plain", async () => {
  const noRequest = await cachedJson("test:plain", HEADERS, async () => ({ body: big }));
  assert.equal(noRequest.headers.get("content-encoding"), null);
  assert.deepEqual(await noRequest.json(), big);

  const short = await cachedJson("test:short", HEADERS, async () => ({ body: { error: "Site not found" }, status: 404 }), asking("br, gzip"));
  assert.equal(short.status, 404);
  assert.equal(short.headers.get("content-encoding"), null);
  assert.deepEqual(await short.json(), { error: "Site not found" });
});

test("Accept-Encoding is read as the browser means it", () => {
  assert.equal(encodingFor("gzip, deflate, br, zstd"), "br");
  assert.equal(encodingFor("gzip, deflate"), "gzip");
  assert.equal(encodingFor("br;q=0, gzip;q=0.5"), "gzip");
  assert.equal(encodingFor("GZIP"), "gzip");
  assert.equal(encodingFor("identity"), null);
  assert.equal(encodingFor(null), null);
});
