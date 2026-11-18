// Filling a cart to photograph it (moments brief 7.6; cart brief option B, chosen by Ben on 17 Nov 2026).
// Everything that touches a store's cart lives here: which stores may be asked, the request guards, how
// many items a cart holds, and emptying it again. Shopify only: its /cart.js and /cart/clear.js are the
// only way to be sure a cart is empty again.
//
// The rules: one product, quantity one, once per store and viewport per run; never past the cart (the
// checkout guard aborts any checkout or payment request and fails the moment); the store's analytics and
// ad pixels are blocked from the click on, so we are not counted as a shopper; every filled cart is
// written down (pending file) and emptied after the cart page is captured, or at the end of the store,
// or at the start of the next run after a crash; one cart that will not empty stops cart moments for the run.
import type { Browser, BrowserContext, Page, Route } from 'playwright';
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type CartScope = 'own' | 'optin' | 'all';
/**
 * `all` (any store whose robots.txt allows the cart actions) also needs this in the environment, a deliberate
 * switch per run. Ben chose carts on every such store on 17 Nov 2026, after the legal read (his
 * Downloads/cart-legal-read.md): the risk he accepted is Shopify's API terms (7 Oct 2026, "API Restrictions"
 * 8 and 14), which forbid automated collection through its APIs, the cart API included, without its written OK.
 * The bot page says "on stores whose robots.txt allows it"; low-stock products are skipped (moment-logic.ts).
 */
export const CART_ALL_ENV = 'MOMENTS_CART_ALL';
export const CART_ALL_VALUE = 'I_HAVE_SIGN_OFF';

/** A filled cart the crawler owes an empty one: the cookies that point at it, and where. */
export type HeldCart = { origin: string; state: Awaited<ReturnType<BrowserContext['storageState']>> };

const CHECKOUT_PATH = /\/checkouts?(\/|$|\?)|\/cart\/checkout|\/wallets\/|\/payments?\//i;
const CHECKOUT_HOSTS = new Set(['shop.app', 'pay.shopify.com', 'checkout.shopify.com', 'www.paypal.com', 'pay.google.com', 'applepay.cdn-apple.com']);

export function loadLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean);
}

/** Analytics and ad hosts (config/analytics-hosts.txt). An entry with a path ("facebook.com/tr") matches that path. */
export function isAnalytics(u: URL, hosts: string[]): boolean {
  const target = u.hostname + u.pathname;
  return hosts.some((h) => (h.includes('/') ? target === h || target.startsWith(h) || target.startsWith('www.' + h) : u.hostname === h || u.hostname.endsWith('.' + h)));
}

export function isCheckout(u: URL): boolean {
  return CHECKOUT_HOSTS.has(u.hostname) || CHECKOUT_PATH.test(u.pathname);
}

export type Guards = { checkoutAborts: string[]; analyticsAborts: number };

/** The two request guards, on the whole context, from now until it closes. */
export async function installGuards(context: BrowserContext, analyticsHosts: string[]): Promise<Guards> {
  const g: Guards = { checkoutAborts: [], analyticsAborts: 0 };
  // fallback, not continue: anything else goes on to the next handler, or to the network when there is none.
  await context.route('**/*', (route: Route) => {
    let u: URL;
    try {
      u = new URL(route.request().url());
    } catch {
      return route.fallback();
    }
    if (isCheckout(u)) {
      g.checkoutAborts.push(`${u.hostname}${u.pathname}`.slice(0, 100));
      return route.abort('blockedbyclient');
    }
    if (isAnalytics(u, analyticsHosts)) {
      g.analyticsAborts++;
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  return g;
}

/** How many items the cart behind this page's cookies holds (Shopify /cart.js), or null when it cannot tell. */
export async function cartCount(page: Page): Promise<number | null> {
  return page
    .evaluate(async () => {
      try {
        const r = await fetch('/cart.js', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = (await r.json()) as { item_count?: unknown };
        return typeof j.item_count === 'number' ? j.item_count : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

/** When the click did not add anything: one unit of the variant in the page's product form, by Shopify's own endpoint. */
export async function addByApi(page: Page): Promise<boolean> {
  return page
    .evaluate(async () => {
      const input = document.querySelector('form[action*="/cart/add"] [name="id"]') as HTMLInputElement | HTMLSelectElement | null;
      const id = input && Number(input.value);
      if (!id) return false;
      try {
        const r = await fetch('/cart/add.js', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ items: [{ id, quantity: 1 }] }) });
        return r.ok;
      } catch {
        return false;
      }
    })
    .catch(() => false);
}

/**
 * Shopify rate-limits cart requests per cart: after the burst of a product page, an add to cart and the cart
 * page, about one cart in two answered 429 to its first emptying (myzoobox.com and sisterlylab.com, 17 Nov
 * 2026), and every request in that state seems to keep it there (myzoobox.com: still 429 after four tries in
 * 3.5 minutes; emptied at the first try after 10 minutes without a request). So a cart gets ONE try right after
 * its cart page (EMPTY_WAITS_MS); one that answers 429 stays written down and is tried again only after
 * QUIET_MS without a request, up to MAX_TRIES tries (emptyPending, drainPending). A 429 is "no
 * answer yet", never "empty" or "full", and never stops the run on its own.
 */
export const EMPTY_WAITS_MS = [0];
export const QUIET_MS = 10 * 60_000;
export const MAX_TRIES = 5;
/**
 * At most this many filled carts may wait to be emptied at once; past it no new cart is filled until one is
 * emptied (capture.ts and crawl.ts wait for a free place before the next product page). 6, not 3, since carts
 * go to every store whose robots.txt allows them (Ben, 17 Nov 2026): about 3 carts in 4 wait 10 minutes or more.
 */
export const MAX_WAITING = 6;

/**
 * Empty the cart behind the context's cookies and check it holds nothing. Not through a page: no scripts, no
 * tracking. Shopify answers /cart/clear.js with the cart itself, so an item_count of 0 in that answer is the
 * check; /cart.js is asked only when clear.js gave some other answer (never straight after a 429).
 */
export async function emptyCart(context: BrowserContext, origin: string, waits = EMPTY_WAITS_MS): Promise<{ ok: boolean; count: number | null; rateLimited: boolean }> {
  let rateLimited = false;
  type Res = Awaited<ReturnType<BrowserContext['request']['get']>>;
  const itemCount = async (r: Res | null): Promise<number | null> => {
    if (!r || !r.ok()) return null;
    const j = (await r.json().catch(() => null)) as { item_count?: unknown } | null;
    return j && typeof j.item_count === 'number' ? j.item_count : null;
  };
  const headers = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
  let last: number | null = null;
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await context.request.post(`${origin}/cart/clear.js`, { headers, timeout: 15_000 }).catch(() => null);
    if (res?.status() === 429) {
      rateLimited = true;
      continue;
    }
    const cleared = await itemCount(res);
    if (cleared === 0) return { ok: true, count: 0, rateLimited };
    const check = await context.request.get(`${origin}/cart.js`, { headers, timeout: 15_000 }).catch(() => null);
    if (check?.status() === 429) {
      rateLimited = true;
      continue;
    }
    last = await itemCount(check);
    if (last === 0) return { ok: true, count: 0, rateLimited };
  }
  return { ok: false, count: last, rateLimited };
}

// ---- Who holds a filled cart, across pages, runs and crashes ----------------------------------------

let stoppedFor: string | null = null;
/**
 * A cart that answers but will not empty, gives no answer at all, or is still rate limited after MAX_TRIES
 * stops cart filling for the rest of the run: a systematic failure must not repeat. A 429 alone does not.
 */
export function stopCarts(host: string): void {
  stoppedFor = stoppedFor ?? host;
  console.error(`CART NOT EMPTIED ${host}: no more carts are filled in this run.`);
}
export const cartsStopped = (): string | null => stoppedFor;

const pendingDir = (out: string) => path.join(out, '_carts');
const pendingFile = (out: string, host: string, vp: string) => path.join(pendingDir(out), `${host}-${vp}.json`);

/**
 * Every cart event, one JSON line each, in <out>/carts-log.jsonl: filled, waiting (Shopify answered 429), emptied
 * (and checked) or failed. The record that each cart a store got from us was emptied again, and when.
 */
export async function logCart(out: string, host: string, vp: string, event: 'filled' | 'waiting' | 'emptied' | 'failed', extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(out, { recursive: true }).catch(() => {});
  await appendFile(path.join(out, 'carts-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), host, vp, event, ...extra }) + '\n', 'utf8').catch(() => {});
}

/** A cart that answered but would not empty, or gave no answer: logged, and cart filling stops for the run. */
export async function noteFailed(out: string, host: string, vp: string): Promise<void> {
  await logCart(out, host, vp, 'failed');
  stopCarts(host);
}

/** A written-down cart: the cookies that point at it, when it was filled, and the tries Shopify did not answer. */
type Pending = HeldCart & { host: string; vp: string; at: string; tries?: number; lastTry?: string };

/** Written the moment a product may have gone into a cart, removed once it is emptied. */
export async function notePending(out: string, host: string, vp: string, cart: HeldCart): Promise<void> {
  await mkdir(pendingDir(out), { recursive: true });
  await writeFile(pendingFile(out, host, vp), JSON.stringify({ host, vp, at: new Date().toISOString(), ...cart }), 'utf8');
  await logCart(out, host, vp, 'filled', { origin: cart.origin });
}

/** This store already holds a filled cart at this viewport: never a second product. */
export function hasPending(out: string, host: string, vp: string): boolean {
  return existsSync(pendingFile(out, host, vp));
}

/** The carts still written down (file names), for the MAX_WAITING cap and the run's last word. */
export function waitingCarts(out: string): string[] {
  const dir = pendingDir(out);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
}

/** The cart was emptied and checked: no longer written down. */
export async function clearPending(out: string, host: string, vp: string): Promise<void> {
  await unlink(pendingFile(out, host, vp)).catch(() => {});
  await logCart(out, host, vp, 'emptied');
}

/** One more try Shopify did not answer (429): when, and how many so far. */
export async function noteTry(out: string, host: string, vp: string): Promise<number> {
  const file = pendingFile(out, host, vp);
  const p = JSON.parse(await readFile(file, 'utf8')) as Pending;
  p.tries = (p.tries ?? 0) + 1;
  p.lastTry = new Date().toISOString();
  await writeFile(file, JSON.stringify(p), 'utf8');
  await logCart(out, host, vp, 'waiting', { tries: p.tries });
  return p.tries;
}

async function readPending(out: string): Promise<Pending[]> {
  const list: Pending[] = [];
  for (const name of waitingCarts(out)) {
    const p = await readFile(path.join(pendingDir(out), name), 'utf8').then((t) => JSON.parse(t) as Pending, () => null);
    if (p) list.push(p);
  }
  return list;
}

/** When a cart that had a try may be tried again: after quietMs without a request. */
const dueAt = (p: Pending, quietMs: number): number => (p.lastTry ? Date.parse(p.lastTry) + quietMs : 0);

export type SweepResult = {
  /** Emptied and checked: the file is gone. */
  emptied: string[];
  /** Shopify answered 429, or the cart is not due yet: the file stays and a later sweep tries again. */
  waiting: string[];
  /** Answered but not empty, no answer at all, or MAX_TRIES used up: the file stays and cart filling stops. */
  failed: string[];
};

/** host: one store's carts only. skipUntried: see emptyPending. quietMs: tests only (QUIET_MS). */
export type SweepOptions = { host?: string; skipUntried?: boolean; quietMs?: number };

/**
 * Try to empty the carts still written down (all of them, or one store's). A cart that already had a try is
 * left alone until it has been quiet for quietMs, so a rate-limited cart is not kept limited by our own
 * requests. skipUntried also leaves carts nobody has tried yet alone: sweeps in the middle of a run use it,
 * because such a cart belongs to a store whose cart page may still be on its way (it is emptied right after
 * that page, or by the store's own end). Runs without it: the start of a run (leftovers), a store's end, the
 * end of a run.
 */
export function emptyPending(browser: Browser, out: string, opts: SweepOptions = {}): Promise<SweepResult> {
  // One sweep at a time in a process: parallel crawl workers must never try the same cart at once.
  const run = sweepQueue.then(() => sweepNow(browser, out, opts));
  sweepQueue = run.catch(() => {});
  return run;
}
let sweepQueue: Promise<unknown> = Promise.resolve();

async function sweepNow(browser: Browser, out: string, opts: SweepOptions): Promise<SweepResult> {
  const res: SweepResult = { emptied: [], waiting: [], failed: [] };
  const quietMs = opts.quietMs ?? QUIET_MS;
  for (const p of await readPending(out)) {
    if (opts.host && p.host !== opts.host) continue;
    const label = `${p.host} ${p.vp}`;
    if (p.lastTry ? dueAt(p, quietMs) > Date.now() : opts.skipUntried) {
      res.waiting.push(label);
      continue;
    }
    const context = await browser.newContext({ storageState: p.state, ignoreHTTPSErrors: true });
    try {
      const r = await emptyCart(context, p.origin);
      if (r.ok) {
        await clearPending(out, p.host, p.vp);
        res.emptied.push(label);
      } else if (r.rateLimited && (await noteTry(out, p.host, p.vp)) < MAX_TRIES) res.waiting.push(label);
      else {
        res.failed.push(label);
        await noteFailed(out, p.host, p.vp);
      }
    } finally {
      await context.close().catch(() => {});
    }
  }
  return res;
}

/**
 * The end of a run: keep trying the written-down carts as each falls due, until none waits or maxWaitMs has
 * gone by. What still waits then is tried first by the next run. untilBelow: stop as soon as fewer than that
 * many wait (a run waiting for a free place under MAX_WAITING); skipUntried as in emptyPending.
 */
export async function drainPending(browser: Browser, out: string, opts: { maxWaitMs?: number; quietMs?: number; untilBelow?: number; skipUntried?: boolean } = {}): Promise<SweepResult> {
  const quietMs = opts.quietMs ?? QUIET_MS;
  const until = Date.now() + (opts.maxWaitMs ?? 25 * 60_000);
  const all: SweepResult = { emptied: [], waiting: [], failed: [] };
  for (;;) {
    const r = await emptyPending(browser, out, { quietMs, skipUntried: opts.skipUntried });
    all.emptied.push(...r.emptied);
    all.failed.push(...r.failed);
    all.waiting = r.waiting;
    const left = (await readPending(out)).filter((p) => !all.failed.includes(`${p.host} ${p.vp}`));
    if (!left.length || (opts.untilBelow !== undefined && left.length < opts.untilBelow)) return all;
    // Only carts this loop will try decide when it looks again; with skipUntried an untried cart never falls due here.
    const triable = opts.skipUntried ? left.filter((p) => p.lastTry) : left;
    if (!triable.length) return all;
    const next = Math.min(...triable.map((p) => dueAt(p, quietMs)));
    if (next > until) return all;
    const wait = Math.max(1_000, next - Date.now());
    console.log(`cart: ${left.length} cart(s) waiting for Shopify's rate limit to pass; next try in ${wait < 60_000 ? `${Math.ceil(wait / 1000)} s` : `${Math.ceil(wait / 60_000)} min`}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
