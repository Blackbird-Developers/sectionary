// Emptying carts under Shopify's rate limit (cart-session.ts), against a small local fake store: no real shop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { cartsStopped, drainPending, emptyCart, emptyPending, waitingCarts, MAX_TRIES } from './cart-session.js';

/** What the fake store answers to /cart/clear.js and /cart.js: empty, rate limited, or a cart that stays full. */
let mode: 'ok' | '429' | 'full' = 'ok';
/** After this many requests the store answers 'ok' (a rate limit that passes). */
let okAfter = Infinity;
let requests = 0;
let server: Server;
let origin = '';
let browser: Browser;
let out = '';

before(async () => {
  server = createServer((req, res) => {
    requests++;
    const m = requests > okAfter ? 'ok' : mode;
    if (m === '429') {
      res.writeHead(429, { 'content-type': 'text/html' });
      return res.end('<!DOCTYPE html><html><body>Too many requests</body></html>');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ item_count: m === 'full' ? 1 : 0, items: [] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  browser = await chromium.launch();
  out = await mkdtemp(path.join(tmpdir(), 'cart-session-test-'));
});

after(async () => {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(out, { recursive: true, force: true });
});

const fresh = (m: typeof mode, after = Infinity) => {
  mode = m;
  okAfter = after;
  requests = 0;
};

async function writePending(host: string, vp: string, extra: Record<string, unknown> = {}): Promise<string> {
  await mkdir(path.join(out, '_carts'), { recursive: true });
  const file = path.join(out, '_carts', `${host}-${vp}.json`);
  await writeFile(file, JSON.stringify({ host, vp, at: new Date().toISOString(), origin, state: { cookies: [], origins: [] }, ...extra }), 'utf8');
  return file;
}
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as { tries?: number; lastTry?: string };

test('a 429 is "no answer yet": one request, no /cart.js check straight after', async () => {
  fresh('429');
  const context = await browser.newContext();
  const r = await emptyCart(context, origin);
  await context.close();
  assert.deepEqual(r, { ok: false, count: null, rateLimited: true });
  assert.equal(requests, 1);
});

test('a rate-limited cart waits: file kept, try noted, left alone until quiet, then emptied', async () => {
  fresh('429');
  const file = await writePending('a.test', 'mobile');
  const first = await emptyPending(browser, out);
  assert.deepEqual(first, { emptied: [], waiting: ['a.test mobile'], failed: [] });
  assert.ok(existsSync(file));
  const noted = await readJson(file);
  assert.equal(noted.tries, 1);
  assert.ok(noted.lastTry);
  assert.equal(cartsStopped(), null, 'a 429 alone never stops the run');

  // Sweeps leave it alone while it is quiet: no request at all.
  fresh('ok');
  const early = await emptyPending(browser, out);
  assert.deepEqual(early, { emptied: [], waiting: ['a.test mobile'], failed: [] });
  assert.equal(requests, 0);

  // Once quiet long enough it is tried, and emptied.
  const late = await emptyPending(browser, out, { quietMs: 0 });
  assert.deepEqual(late, { emptied: ['a.test mobile'], waiting: [], failed: [] });
  assert.ok(!existsSync(file));
  assert.deepEqual(waitingCarts(out), []);
});

test('two sweeps at once never try the same cart twice', async () => {
  fresh('429');
  await writePending('b.test', 'desktop');
  const [x, y] = await Promise.all([emptyPending(browser, out), emptyPending(browser, out)]);
  assert.equal(requests, 1);
  assert.deepEqual([...x.waiting, ...y.waiting], ['b.test desktop', 'b.test desktop']);
  // Leave nothing for the next test.
  fresh('ok');
  await emptyPending(browser, out, { quietMs: 0 });
  assert.deepEqual(waitingCarts(out), []);
});

test('a mid-run sweep never touches a cart nobody has tried: its cart page may still be on the way', async () => {
  fresh('ok');
  const file = await writePending('g.test', 'desktop');
  const mid = await emptyPending(browser, out, { skipUntried: true });
  assert.deepEqual(mid, { emptied: [], waiting: ['g.test desktop'], failed: [] });
  assert.equal(requests, 0);
  assert.ok(existsSync(file));
  // The store's own end (or the run's) does try it.
  const end = await emptyPending(browser, out, { host: 'g.test' });
  assert.deepEqual(end, { emptied: ['g.test desktop'], waiting: [], failed: [] });
});

test('the end of a run keeps trying as carts fall due, until empty', async () => {
  fresh('429', 1); // the first request is refused, the next answers
  await writePending('c.test', 'mobile');
  const r = await drainPending(browser, out, { quietMs: 300, maxWaitMs: 5_000 });
  assert.deepEqual(r.emptied, ['c.test mobile']);
  assert.deepEqual(r.failed, []);
  assert.equal(requests, 2);
  assert.deepEqual(waitingCarts(out), []);
});

test('the end of a run gives up after maxWaitMs and keeps the cart written down for the next run', async () => {
  fresh('429');
  const file = await writePending('d.test', 'desktop');
  const r = await drainPending(browser, out, { quietMs: 60_000, maxWaitMs: 1_000 });
  assert.deepEqual(r.emptied, []);
  assert.deepEqual(r.waiting, ['d.test desktop']);
  assert.ok(existsSync(file));
  assert.equal(cartsStopped(), null);
  fresh('ok');
  await emptyPending(browser, out, { quietMs: 0 });
});

// These two stop cart filling for the process (a sticky switch), so they come last.
test('still rate limited after MAX_TRIES: failed, and cart filling stops', async () => {
  fresh('429');
  const file = await writePending('e.test', 'mobile', { tries: MAX_TRIES - 1, lastTry: new Date(0).toISOString() });
  const r = await emptyPending(browser, out);
  assert.deepEqual(r, { emptied: [], waiting: [], failed: ['e.test mobile'] });
  assert.ok(existsSync(file), 'kept for the next run');
  assert.equal(cartsStopped(), 'e.test');
  fresh('ok');
  await emptyPending(browser, out, { quietMs: 0 });
});

test('a cart that answers but stays full is a failure, not a wait', async () => {
  fresh('full');
  await writePending('f.test', 'desktop');
  const r = await emptyPending(browser, out);
  assert.deepEqual(r, { emptied: [], waiting: [], failed: ['f.test desktop'] });
  assert.equal(requests, 2, 'clear.js, then the /cart.js check');
});
