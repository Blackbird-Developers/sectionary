// One-off capture CLI: a few pages, right now, no queue.
//
//   npm run capture -- myzoobox.com --discover
//   npm run capture -- https://sisterlylab.com/products/some-product --only mobile
//   npm run capture -- --seeds seeds/phase0.txt --discover
//
// For a list of stores that should survive crashes and run overnight, use the
// crawl worker instead (npm run crawl, src/crawl.ts). Both share
// src/capture-page.ts, so a page is captured the same way either way.

import { chromium } from 'playwright';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverShopify } from './discover.js';
import { buildIndex } from './build-index.js';
import { Politeness, PoliteError, hostOf } from './polite.js';
import { capturePage, pageType, DEFAULT_CAPTURE, type CaptureOptions, type ViewportName } from './capture-page.js';
import { parseMomentKinds } from './moment-logic.js';
import { drainPending, emptyPending, waitingCarts, MAX_WAITING, type HeldCart } from './cart-session.js';

export { pageType } from './capture-page.js';

type Options = CaptureOptions & { urls: string[]; discover: boolean; seeds: string | null; headed: boolean };

function usage(): never {
  console.log(`Usage: npm run capture -- <url|host> [...] [--discover] [--seeds file] [--only desktop|mobile]
                          [--out data] [--max-blocks 40] [--min-height 80] [--quality 88] [--headed] [--styles] [--clips] [--sliders] [--product] [--play]
                          [--moments first-visit-popup,menu-open,sticky-atc | safe | all] [--moments-cart-scope own|optin|all]

  --clips        record short clips (slow motion, sped back up) of blocks that move by themselves
  --sliders      with --clips: press sliders that only move when pressed, and record them
  --product      with --clips: on product pages, record the photo gallery, the product options and the size guide
  --play         with --clips: press play on videos that wait for it, record them playing, pause them again

  --discover     for a bare host, enumerate Shopify pages via /products.json and /collections.json
  --moments      also capture what the store does when used (src/moments.ts); own sites only for now
  --moments-cart-scope  who may have one product put in a cart (default own; all also needs MOMENTS_CART_ALL=I_HAVE_SIGN_OFF)
  --seeds file   read hosts/urls from a text file (one per line, # comments)
  --only         capture a single viewport instead of both
  --headed       show the browser window while capturing
  --styles       also measure design metadata (fonts, colours, headings, outline; SEC-31)`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const o: Options = { ...DEFAULT_CAPTURE, urls: [], discover: false, seeds: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--discover') o.discover = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--styles') o.styles = true;
    else if (a === '--clips') o.clips = true;
    else if (a === '--sliders') o.sliders = true;
    else if (a === '--product') o.product = true;
    else if (a === '--play') o.play = true;
    else if (a === '--seeds') o.seeds = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--only') o.only = argv[++i] as ViewportName;
    else if (a === '--max-blocks') o.maxBlocks = Number(argv[++i]);
    else if (a === '--min-height') o.minHeight = Number(argv[++i]);
    else if (a === '--quality') o.quality = Number(argv[++i]);
    else if (a === '--moments-cart-scope') {
      const v = argv[++i];
      if (v !== 'own' && v !== 'optin' && v !== 'all') {
        console.error('--moments-cart-scope must be own, optin or all');
        usage();
      }
      o.momentsCartScope = v;
    } else if (a === '--moments') {
      try {
        o.moments = parseMomentKinds(argv[++i] || '');
      } catch (e) {
        console.error((e as Error).message);
        usage();
      }
    }
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('--')) { console.error(`Unknown flag ${a}`); usage(); }
    else o.urls.push(a);
  }
  if (o.only && o.only !== 'desktop' && o.only !== 'mobile') { console.error('--only must be desktop or mobile'); usage(); }
  return o;
}

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return new URL(u).toString();
}

function isBareHost(input: string): boolean {
  const u = new URL(normalizeUrl(input));
  return (u.pathname === '/' || u.pathname === '') && !u.search;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const inputs = [...opts.urls];
  if (opts.seeds) {
    const txt = await readFile(opts.seeds, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#')) inputs.push(l);
    }
  }
  if (!inputs.length) usage();

  const polite = await Politeness.fromConfig();
  await mkdir(opts.out, { recursive: true });
  const crawlLog = path.join(opts.out, 'crawl-log.jsonl');
  const log = (entry: Record<string, unknown>) => appendFile(crawlLog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');

  const targets: string[] = [];
  for (const input of inputs) {
    const url = normalizeUrl(input);
    if (polite.isBlocked(hostOf(url))) {
      console.log(`${url}: on the block list, skipped`);
      await log({ url, action: 'skipped', reason: 'blocklist' });
      continue;
    }
    if (opts.discover && isBareHost(input)) {
      const origin = new URL(url).origin;
      try {
        const d = await discoverShopify(polite, origin);
        console.log(`${origin}: ${d.shopify ? 'Shopify store, discovered' : 'not Shopify, using'} ${d.urls.length} page(s)` +
          (d.skipped.length ? `, skipped ${d.skipped.map((s) => new URL(s.url).pathname + ' (' + s.reason + ')').join(', ')}` : ''));
        for (const s of d.skipped) await log({ url: s.url, action: 'skipped', reason: s.reason });
        targets.push(...d.urls);
      } catch (e) {
        const reason = e instanceof PoliteError ? e.reason : String(e);
        console.log(`${origin}: discovery refused (${reason})`);
        await log({ url: origin, action: 'skipped', reason });
      }
    } else {
      targets.push(url);
    }
  }
  const uniq = [...new Set(targets)];
  console.log(`Capturing ${uniq.length} page(s) x ${opts.only ? 1 : 2} viewport(s) -> ${opts.out}/`);

  const browser = await chromium.launch({ headless: !opts.headed });
  // A filled cart travels from its product page to the same store's cart page, then is emptied (src/cart-session.ts).
  const held = new Map<string, Partial<Record<ViewportName, HeldCart>>>();
  try {
    // Carts a crash left behind are emptied first.
    if (opts.moments.includes('add-to-cart')) await emptyPending(browser, opts.out);
    for (const url of uniq) {
      // Only carts that already had a try and have been quiet: a fresh cart waits for its own cart page.
      if (waitingCarts(opts.out).length) await emptyPending(browser, opts.out, { skipUntried: true }).catch(() => null);
      // Too many carts waiting for Shopify's rate limit: wait for a free place before a product page fills another.
      if (opts.moments.includes('add-to-cart') && pageType(new URL(url)) === 'product' && waitingCarts(opts.out).length >= MAX_WAITING) {
        console.log(`cart: ${waitingCarts(opts.out).length} carts wait to be emptied; waiting for a free place before the next product page`);
        await drainPending(browser, opts.out, { untilBelow: MAX_WAITING, skipUntried: true, maxWaitMs: 60 * 60_000 }).catch(() => null);
      }
      console.log(`\n${url}  [${pageType(new URL(url))}]`);
      const host = new URL(url).hostname.replace(/^www\./, '');
      const carts = held.get(host);
      const toCart = pageType(new URL(url)) === 'cart' && carts && Object.keys(carts).length > 0;
      const r = await capturePage(browser, url, toCart ? { ...opts, cartStates: { ...carts } } : opts, polite);
      if (r.cart) held.set(host, { ...carts, ...r.cart });
      for (const vp of r.emptied ?? []) delete held.get(host)?.[vp];
      if (r.status === 'skipped') console.log(`  skipped (${r.reason})`);
      for (const line of r.lines) console.log(line);
      await log({ url, host: r.host, action: r.status, reason: r.reason, blocks: r.blocks, ms: r.ms });
    }
  } finally {
    // Whatever cart is still held (no cart page in the list, a failure): empty it now, and check.
    if (opts.moments.includes('add-to-cart')) {
      const end = await drainPending(browser, opts.out).catch(() => null);
      if (end?.emptied.length) console.log(`cart: emptied ${end.emptied.join(', ')} after Shopify's rate limit passed`);
      const left = waitingCarts(opts.out);
      if (left.length) console.error(`CART NOT EMPTIED: ${left.join(', ')} (kept in ${opts.out}/_carts; the next run tries again)`);
    }
    await browser.close();
  }

  const n = await buildIndex(opts.out);
  console.log(`\nIndex rebuilt: ${n} page(s). Open viewer/index.html to browse.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
