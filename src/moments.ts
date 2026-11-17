// Moments (moments brief, phase 1): what a store does when a shopper uses it, captured inside the page
// load the crawler already makes, so each page is still visited once. Off unless asked for (--moments).
//   first-visit-popup  home    the newsletter or offer popup a new visitor gets   Hook A, before overlays are closed
//   menu-open          home    the navigation's open state                        Hook B, after the block shots
//   sticky-atc         product the buy bar that appears after scrolling            Hook B
// A moment never fails a page: each runs in its own try/catch and time limit, and Hook B runs only once
// every block picture is on disk. Nothing here types, submits a form or follows a link.
import type { BrowserContext, Page } from 'playwright';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MomentKind } from '../web/src/contracts/manifest.js';
import type { CapturedBlock } from './capture-page.js';
import { hidePinned, restorePinned } from './page-script.js';
import { cartBadge, describePanel, findAddToCart, findCartDrawerToggle, findMenuTrigger, findStickyBars, forceHide, overlayShowing, pinnedAtTop, snapshotOverlays, type Overlay } from './moment-script.js';
import { classOf, classifyResponse, diffOverlays, lowStock, popupVerdict, MOMENT_THRESHOLDS } from './moment-logic.js';
import { addByApi, cartCount, installGuards, type Guards } from './cart-session.js';

/** What the crawler writes for one moment. src/contract-check.ts holds it to the contract's ManifestMoment. */
export type CrawlerMoment = {
  id: string;
  kind: MomentKind;
  viewport: 'desktop' | 'mobile';
  trigger: { action: 'none' | 'scroll' | 'hover' | 'click' | 'select'; label: string | null; via: string | null };
  response?: 'drawer' | 'modal' | 'toast' | 'redirect' | 'inline' | 'none';
  frames: { role: 'before' | 'after' | 'panel'; file: string; width: number; height: number }[];
  panelRef?: string | null;
  confidence: 'high' | 'low';
  ms: number;
  error?: string;
};

export type MomentContext = {
  vp: 'desktop' | 'mobile';
  pageDir: string;
  quality: number;
  pageType: string;
  kinds: MomentKind[];
  /**
   * Closes popups the way the capture does before its blocks (capture-page.ts dismissOverlays). Run before a
   * frame, because our own scrolling can open one (sisterlylab.com's sign-up form opens on scroll depth).
   * Never during the first-visit popup watch.
   */
  dismiss?: (page: Page) => Promise<void>;
  /** The platform detectSite found ("shopify"): filling a cart is Shopify only. */
  platform?: string;
  /**
   * Set only when this store and viewport may have a product put in its cart (scope, robots.txt and
   * "not filled yet this run" are checked by capture-page.ts). Without it add-to-cart does not run.
   */
  cart?: {
    context: BrowserContext;
    analyticsHosts: string[];
    /** polite.waitFor: the click makes the store's server do work. */
    pace: () => Promise<void>;
    /** Called right before the click, so the caller saves the cookies even if this moment never returns. */
    onFill: (origin: string) => void;
  };
};

/**
 * Panel blocks carry a temporary ref and file until finalizeMoments numbers them after the page's own blocks.
 * `cart` is set the moment a product may have gone into the cart: the caller must save the cookies and empty it.
 */
export type MomentResult = { moments: CrawlerMoment[]; panels: CapturedBlock[]; notes: string[]; cart?: { origin: string; guards: Guards } };

const LIMIT_MS = 10_000;
/** Adding to cart waits up to 4 s for the store's answer, then may open the cart drawer: it gets longer. */
const CART_LIMIT_MS = 20_000;
const BUDGET_MS = 35_000;
const POPUP_WATCH_MS = 6_000;
const MAX_PANELS = 6;

const empty = (): MomentResult => ({ moments: [], panels: [], notes: [] });
const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

function race<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('moment-timeout')), ms);
  });
  return Promise.race([work, limit]).finally(() => timer && clearTimeout(timer));
}

/** A screen-sized frame: moments/<d|m>-<kind>-<role>.jpg. */
async function frame(page: Page, ctx: MomentContext, kind: MomentKind, role: 'before' | 'after'): Promise<CrawlerMoment['frames'][number]> {
  const file = `moments/${ctx.vp[0]}-${kind}-${role}.jpg`;
  await mkdir(path.join(ctx.pageDir, 'moments'), { recursive: true });
  await page.screenshot({ path: path.join(ctx.pageDir, file), type: 'jpeg', quality: ctx.quality, animations: 'disabled', timeout: 15_000 });
  const size = page.viewportSize() || { width: 0, height: 0 };
  return { role, file, width: size.width, height: size.height };
}

/** Pictures inside the panel finish loading (at most 2 s), with the block loop's rule: images under 40px do not count. */
async function imagesLoaded(page: Page, key: string): Promise<void> {
  await page
    .waitForFunction(
      (k) => {
        const el = document.querySelector(`[data-secmoment="${k}"]`);
        if (!el) return true;
        return Array.from(el.querySelectorAll('img')).every((img) => {
          const r = img.getBoundingClientRect();
          return r.width < 40 || r.height < 40 || img.complete;
        });
      },
      key,
      { timeout: 2000 },
    )
    .catch(() => {});
}

/** The panel alone, written as a block: its picture, with everything else pinned made transparent as for block shots. */
async function panelBlock(page: Page, ctx: MomentContext, out: MomentResult, key: string, typeHint: string, kind: MomentKind): Promise<{ ref: string; frame: CrawlerMoment['frames'][number] } | null> {
  if (out.panels.length >= MAX_PANELS) return null;
  // Temporary until finalizeMoments; a kind happens once per page and viewport.
  const ref = `p-${ctx.vp[0]}-${kind}`;
  const d = await page.evaluate(describePanel, { key, ref });
  if (!d) return null;
  const file = `moments/${ctx.vp[0]}-${kind}-panel.jpg`;
  await mkdir(path.join(ctx.pageDir, 'moments'), { recursive: true });
  await page.evaluate(hidePinned, { ref, rescan: true }).catch(() => 0);
  try {
    await page.locator(`[data-secref="${ref}"]`).first().screenshot({ path: path.join(ctx.pageDir, file), type: 'jpeg', quality: ctx.quality, animations: 'disabled', timeout: 15_000 });
  } catch {
    return null;
  } finally {
    await page.evaluate(restorePinned).catch(() => {});
  }
  if (!((await stat(path.join(ctx.pageDir, file)).catch(() => null))?.size || 0)) return null;
  out.panels.push({ ref, index: 0, typeHint, parentType: null, ...d, viewport: ctx.vp, file, moment: kind });
  return { ref, frame: { role: 'panel', file, width: d.width, height: d.height } };
}

function giveUp(out: MomentResult, ctx: MomentContext, kind: MomentKind, t0: number, error: string, frames: CrawlerMoment['frames'] = [], trigger?: CrawlerMoment['trigger']): void {
  out.moments.push({ id: `${ctx.vp[0]}-${kind}`, kind, viewport: ctx.vp, trigger: trigger ?? { action: 'none', label: null, via: null }, frames, panelRef: null, confidence: 'low', ms: Date.now() - t0, error });
}

/** Area of a box on screen, as a share of the screen. */
function screenShare(o: Overlay, vw: number, vh: number): number {
  const ix = Math.max(0, Math.min(o.x + o.w, vw) - Math.max(o.x, 0));
  const iy = Math.max(0, Math.min(o.y + o.h, vh) - Math.max(o.y, 0));
  return (ix * iy) / (vw * vh);
}

// ---- Hook A: first-visit popup -----------------------------------------------------------------

/** Before dismissOverlays closes everything: does the store greet a new visitor with a popup? */
export async function runPopupWatch(page: Page, ctx: MomentContext): Promise<MomentResult> {
  const out = empty();
  if (!ctx.kinds.includes('first-visit-popup') || ctx.pageType !== 'home') return out;
  const t0 = Date.now();
  try {
    await race(popupInner(page, ctx, out, t0), POPUP_WATCH_MS + LIMIT_MS);
  } catch (e) {
    out.notes.push(`first-visit-popup: ${(e as Error).message.split('\n')[0]}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return out;
}

async function popupInner(page: Page, ctx: MomentContext, out: MomentResult, t0: number): Promise<void> {
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const phone = ctx.vp === 'mobile';
  const pick = (list: Overlay[], backdrop: boolean) =>
    list
      .filter((o) => {
        const cls = classOf(o, size.width, size.height, phone, backdrop);
        return (cls === 'modal' || (phone && cls === 'drawer')) && popupVerdict(o).ok;
      })
      .sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;

  const base = await page.evaluate(snapshotOverlays);
  // A popup can already be up when the page has settled; then there is no picture without it.
  let popup = pick(base, base.some((o) => o.w >= size.width * 0.9 && o.h >= size.height * 0.8 && o.textLength < 20));
  let before: CrawlerMoment['frames'][number] | null = null;
  if (!popup) {
    before = await frame(page, ctx, 'first-visit-popup', 'before');
    // Many popups wait for a little scroll or a mouse move. Never towards the edge (no exit-intent).
    await page.evaluate(() => window.scrollBy(0, 200)).catch(() => {});
    await page.mouse.move(size.width / 2, size.height / 2).catch(() => {});
    await page.mouse.move(size.width / 2 + 40, size.height / 2 + 30, { steps: 4 }).catch(() => {});
    const until = Date.now() + POPUP_WATCH_MS;
    while (!popup && Date.now() < until) {
      await sleep(page, 300);
      const now = await page.evaluate(snapshotOverlays);
      const { found, backdrop } = diffOverlays(base, now, size.width, size.height);
      popup = pick(found, backdrop);
    }
  }
  // Most stores have no popup: then there is no moment at all, not even a "low" one.
  if (!popup) return;
  await imagesLoaded(page, popup.key);
  const after = await frame(page, ctx, 'first-visit-popup', 'after');
  const panel = await panelBlock(page, ctx, out, popup.key, 'popup', 'first-visit-popup');
  const why = popupVerdict(popup).reason;
  out.moments.push({
    id: `${ctx.vp[0]}-first-visit-popup`,
    kind: 'first-visit-popup',
    viewport: ctx.vp,
    trigger: { action: 'none', label: null, via: `${before ? 'appeared within 6 s' : 'already showing'}; ${why}` },
    frames: [...(before ? [before] : []), after, ...(panel ? [panel.frame] : [])],
    panelRef: panel ? panel.ref : null,
    confidence: panel ? 'high' : 'low',
    ms: Date.now() - t0,
    ...(panel ? {} : { error: 'panel-shot-failed' }),
  });
}

// ---- Hook B: after the block shots ---------------------------------------------------------------

/** The kinds that change the page, run after every block picture is on disk. */
export async function runMoments(page: Page, ctx: MomentContext): Promise<MomentResult> {
  const out = empty();
  const plan: [MomentKind, (page: Page, ctx: MomentContext, out: MomentResult, t0: number, stop: { now: boolean }) => Promise<void>][] = [];
  if (ctx.pageType === 'home' && ctx.kinds.includes('menu-open')) plan.push(['menu-open', menuOpen]);
  if (ctx.pageType === 'product' && ctx.kinds.includes('sticky-atc')) plan.push(['sticky-atc', stickyAtc]);
  // Last: it changes what the store's server holds.
  if (ctx.pageType === 'product' && ctx.kinds.includes('add-to-cart') && ctx.cart) plan.push(['add-to-cart', addToCart]);
  if (!plan.length) return out;
  await page.evaluate(restorePinned).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(page, 300);
  const deadline = Date.now() + BUDGET_MS;
  const stop = { now: false };
  for (const [kind, run] of plan) {
    const t0 = Date.now();
    if (stop.now) break;
    if (Date.now() >= deadline) {
      giveUp(out, ctx, kind, t0, 'budget');
      continue;
    }
    if (ctx.dismiss) await ctx.dismiss(page).catch(() => {});
    try {
      await race(run(page, ctx, out, t0, stop), Math.min(kind === 'add-to-cart' ? CART_LIMIT_MS : LIMIT_MS, deadline - Date.now() + (kind === 'add-to-cart' ? 10_000 : 0)));
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      // A hung moment may still be acting on the page: start nothing else on it.
      if (msg === 'moment-timeout') stop.now = true;
      giveUp(out, ctx, kind, t0, msg === 'moment-timeout' ? 'moment-timeout' : `error: ${msg.slice(0, 120)}`);
    }
  }
  return out;
}

/** Poll until a panel that `accept` takes has stopped moving (two equal polls), or `ms` have passed. */
async function waitForPanel(page: Page, base: Overlay[], accept: (found: Overlay[], backdrop: boolean) => Overlay | null, ms: number): Promise<Overlay | null> {
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const until = Date.now() + ms;
  let last: Overlay | null = null;
  while (Date.now() < until) {
    await sleep(page, 150);
    const now = await page.evaluate(snapshotOverlays);
    const { found, backdrop } = diffOverlays(base, now, size.width, size.height);
    const hit = accept(found, backdrop);
    if (hit && last && hit.key === last.key && Math.abs(hit.x - last.x) <= 2 && Math.abs(hit.y - last.y) <= 2 && Math.abs(hit.w - last.w) <= 2 && Math.abs(hit.h - last.h) <= 2) return hit;
    last = hit;
  }
  return last;
}

const samePath = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
};

async function menuOpen(page: Page, ctx: MomentContext, out: MomentResult, t0: number, stop: { now: boolean }): Promise<void> {
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const phone = ctx.vp === 'mobile';
  const T = MOMENT_THRESHOLDS;
  const trig = await page.evaluate(findMenuTrigger, phone);
  if (!trig) return giveUp(out, ctx, 'menu-open', t0, 'no-trigger');
  // Never click a link that goes somewhere.
  const clickable = trig.tag === 'button' || trig.tag === 'summary' || (trig.tag === 'a' && (!trig.href || trig.href === '#' || /^javascript:/i.test(trig.href)));
  const trigger: CrawlerMoment['trigger'] = { action: phone ? 'click' : 'hover', label: trig.label || null, via: trig.via };
  if (phone && !clickable) return giveUp(out, ctx, 'menu-open', t0, 'trigger-navigates', [], trigger);
  const before = await frame(page, ctx, 'menu-open', 'before');
  const base = await page.evaluate(snapshotOverlays);
  const atRest = new Map(base.map((o) => [o.key, o]));
  const url0 = page.url();
  // New, or grown well past its size at rest. A header whose words changed because a small dropdown opened
  // inside it is not the menu (myirelandbox.com on desktop).
  const grewOrNew = (o: Overlay) => {
    const b = atRest.get(o.key);
    return !b || o.w > b.w * T.menuGrow || o.h > b.h * T.menuGrow;
  };
  const phoneMenu = (o: Overlay, backdrop: boolean) =>
    classOf(o, size.width, size.height, true, backdrop) === 'drawer' || (o.w >= size.width * T.phoneMenuInFlow.minW && Math.min(o.h, size.height) >= size.height * T.phoneMenuInFlow.minH);
  const accept = (found: Overlay[], backdrop: boolean) =>
    found
      .filter((o) => grewOrNew(o) && o.links >= T.menuMinLinks && (phone ? phoneMenu(o, backdrop) : screenShare(o, size.width, size.height) >= T.menuMinArea))
      .sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  const loc = page.locator('[data-secmoment-trigger="1"]').first();
  if (phone) await loc.click({ timeout: 3000 });
  else await loc.hover({ timeout: 3000 });
  let panel = await waitForPanel(page, base, accept, phone ? 2500 : 800);
  if (!panel && !phone && clickable) {
    // Some menus open on a click rather than a hover.
    trigger.action = 'click';
    await loc.click({ timeout: 3000 });
    panel = await waitForPanel(page, base, accept, 2500);
  }
  if (!samePath(url0, page.url())) {
    stop.now = true;
    return giveUp(out, ctx, 'menu-open', t0, 'navigated', [before], trigger);
  }
  if (!panel) {
    await closeMenu(page, null, undefined, clickable, loc);
    return giveUp(out, ctx, 'menu-open', t0, 'no-response', [before], trigger);
  }
  await imagesLoaded(page, panel.key);
  const after = await frame(page, ctx, 'menu-open', 'after');
  const shot = await panelBlock(page, ctx, out, panel.key, 'menu', 'menu-open');
  const closed = await closeMenu(page, panel, atRest.get(panel.key), clickable, loc);
  out.moments.push({
    id: `${ctx.vp[0]}-menu-open`,
    kind: 'menu-open',
    viewport: ctx.vp,
    trigger,
    frames: [before, after, ...(shot ? [shot.frame] : [])],
    panelRef: shot ? shot.ref : null,
    confidence: shot ? 'high' : 'low',
    ms: Date.now() - t0,
    ...(!shot ? { error: 'panel-shot-failed' } : closed !== 'closed' ? { error: `restored: ${closed}` } : {}),
  });
}

/** A point on screen outside the panel, for the pointer to rest on so a hover menu closes. */
function awayFrom(panel: Overlay | null, size: { width: number; height: number }): { x: number; y: number } {
  const points = [
    { x: 1, y: panel ? panel.y + panel.h + 20 : size.height - 2 },
    { x: 1, y: size.height - 2 },
    { x: size.width - 2, y: size.height - 2 },
    { x: size.width / 2, y: size.height - 2 },
  ];
  const inside = (p: { x: number; y: number }) => !!panel && p.x >= panel.x && p.x <= panel.x + panel.w && p.y >= panel.y && p.y <= panel.y + panel.h;
  return points.find((p) => p.y < size.height && !inside(p)) || points[1];
}

/**
 * Escape, move the pointer away, the trigger again, and only then hide it by force. A panel that was on the
 * page at rest (a header that grew to hold the menu) is never hidden: it counts as closed once back near its
 * size at rest, and is otherwise left as it is ("not closed").
 */
async function closeMenu(page: Page, panel: Overlay | null, atRest: Overlay | undefined, clickable: boolean, loc: ReturnType<Page['locator']>): Promise<'closed' | 'forced' | 'not closed'> {
  const away = awayFrom(panel, page.viewportSize() || { width: 1440, height: 900 });
  const open = async () => {
    if (!panel) return false;
    if (!atRest) return page.evaluate(overlayShowing, panel.key).catch(() => false);
    const h = await page.evaluate((k) => document.querySelector(`[data-secmoment="${k}"]`)?.getBoundingClientRect().height ?? 0, panel.key).catch(() => 0);
    return h > atRest.h * MOMENT_THRESHOLDS.menuGrow;
  };
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.move(away.x, away.y).catch(() => {});
  await sleep(page, 500);
  if (!(await open())) return 'closed';
  if (clickable) {
    await loc.click({ timeout: 3000 }).catch(() => {});
    await page.mouse.move(away.x, away.y).catch(() => {});
    await sleep(page, 500);
    if (!(await open())) return 'closed';
  }
  if (atRest) return 'not closed';
  await page.evaluate(forceHide, panel!.key).catch(() => {});
  return 'forced';
}

async function stickyAtc(page: Page, ctx: MomentContext, out: MomentResult, t0: number): Promise<void> {
  const atc = await page.evaluate(findAddToCart);
  if (!atc) return giveUp(out, ctx, 'sticky-atc', t0, 'no-atc');
  // The main button in view, as a shopper first sees it.
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2)), atc.top).catch(() => {});
  await sleep(page, 400);
  if (ctx.dismiss) await ctx.dismiss(page).catch(() => {});
  const before = await frame(page, ctx, 'sticky-atc', 'before');
  await page.evaluate(hidePinned, { ref: null, rescan: true }).catch(() => 0);
  await page.evaluate(restorePinned).catch(() => {});
  const atRest = await page.evaluate(pinnedAtTop);
  const base = await page.evaluate(snapshotOverlays);
  // Past the main button by 400px, as far as the page goes.
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight))), atc.bottom + 400).catch(() => {});
  await sleep(page, 600);
  if (ctx.dismiss) await ctx.dismiss(page).catch(() => {});
  // Bars that only become pinned after scrolling: scan again, then put everything back.
  await page.evaluate(hidePinned, { ref: null, rescan: true }).catch(() => 0);
  await page.evaluate(restorePinned).catch(() => {});
  const bars = await page.evaluate(findStickyBars, [...atRest, ...base.map((o) => o.key)]);
  // Most stores have no sticky bar: then no moment.
  if (!bars.length) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    return;
  }
  const bar = bars[0];
  await imagesLoaded(page, bar.key);
  const after = await frame(page, ctx, 'sticky-atc', 'after');
  const shot = await panelBlock(page, ctx, out, bar.key, 'sticky-add-to-cart', 'sticky-atc');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  out.moments.push({
    id: `${ctx.vp[0]}-sticky-atc`,
    kind: 'sticky-atc',
    viewport: ctx.vp,
    trigger: { action: 'scroll', label: bar.label || atc.label || null, via: `pinned bar after scrolling 400px past the main button (${atc.via})` },
    frames: [before, after, ...(shot ? [shot.frame] : [])],
    panelRef: shot ? shot.ref : null,
    confidence: shot ? 'high' : 'low',
    ms: Date.now() - t0,
    ...(shot ? {} : { error: 'panel-shot-failed' }),
  });
}

// ---- add-to-cart and cart-drawer (src/cart-session.ts holds the rules) --------------------------------

/** A price that is not zero: "$40.00", "€15", "1.299 kr". */
const MONEY = /[$€£¥₹]\s?(?!0[.,]00\b)\d|\d[\d.,]*\s?(?:USD|EUR|GBP|kr|zł)\b/;
const CART_PATH = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?cart\/?$/i;

/** A drawer that shows a line item: a price, and a quantity control or the product's own name. */
export function hasLineItem(text: string, title: string | null): boolean {
  if (!MONEY.test(text)) return false;
  if (/\b(qty|quantity|remove|delete)\b|[−–-]\s*1\s*\+|\b1\s*[×x]\s/i.test(text)) return true;
  const words = (title || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
  const t = text.toLowerCase();
  return words.length > 0 && words.filter((w) => t.includes(w)).length >= Math.min(2, words.length);
}

async function addToCart(page: Page, ctx: MomentContext, out: MomentResult, t0: number, stop: { now: boolean }): Promise<void> {
  const cart = ctx.cart!;
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const phone = ctx.vp === 'mobile';
  if (ctx.platform !== 'shopify') return giveUp(out, ctx, 'add-to-cart', t0, 'not-shopify');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  // The main button by the brief's rules: never buy-now, a payment button, subscribe, pre-order or sold out.
  const atc = await page.evaluate(findAddToCart);
  if (!atc) return giveUp(out, ctx, 'add-to-cart', t0, 'no-atc');
  // Never a product with low stock: read around the product form, not the whole page (a site-wide banner may shout).
  const near = await page
    .evaluate(() => {
      const button = document.querySelector('[data-secmoment-atc="1"]');
      const area = button?.closest('form')?.closest('section, [class*="product" i], main') || button?.closest('section, main');
      return ((area as HTMLElement | null)?.innerText || '').slice(0, 4000);
    })
    .catch(() => '');
  if (lowStock(near)) return giveUp(out, ctx, 'add-to-cart', t0, 'low-stock');
  // No "is the cart empty" request first: the context is fresh, so its cart can hold nothing, and every extra
  // cart request brings Shopify's rate limit closer (cart-session.ts EMPTY_WAITS_MS).

  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2)), atc.top).catch(() => {});
  await sleep(page, 400);
  if (ctx.dismiss) await ctx.dismiss(page).catch(() => {});
  const title = await page.evaluate(() => (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)).catch(() => '');
  const before = await frame(page, ctx, 'add-to-cart', 'before');
  const base = await page.evaluate(snapshotOverlays);
  const badge0 = await page.evaluate(cartBadge).catch(() => null);
  const guards = await installGuards(cart.context, cart.analyticsHosts);
  // From here on the cart may hold something: whatever happens next, the caller saves the cookies and empties it.
  out.cart = { origin: new URL(page.url()).origin, guards };
  cart.onFill(out.cart.origin);
  await cart.pace();
  const url0 = page.url();
  const trigger: CrawlerMoment['trigger'] = { action: 'click', label: atc.label || null, via: atc.via };
  await page.locator('[data-secmoment-atc="1"]').first().click({ timeout: 3000 });

  // The store answers: settle for up to 4 s.
  let response: NonNullable<CrawlerMoment['response']> = 'none';
  let panel: Overlay | null = null;
  let last: Overlay | null = null;
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    await sleep(page, 200);
    if (!samePath(url0, page.url())) {
      if (CART_PATH.test(new URL(page.url()).pathname)) response = 'redirect';
      break;
    }
    const now = await page.evaluate(snapshotOverlays).catch(() => [] as Overlay[]);
    const { found, backdrop } = diffOverlays(base, now, size.width, size.height);
    const hit = classifyResponse(found, size.width, size.height, phone, backdrop);
    if (hit) {
      panel = hit.overlay;
      response = hit.cls;
      if (last && last.key === hit.overlay.key && Math.abs(last.w - hit.overlay.w) <= 2 && Math.abs(last.h - hit.overlay.h) <= 2) break;
    }
    last = hit ? hit.overlay : null;
  }
  if (response !== 'redirect' && !samePath(url0, page.url())) {
    stop.now = true;
    return giveUp(out, ctx, 'add-to-cart', t0, guards.checkoutAborts.length ? 'checkout-attempt' : 'navigated', [before], trigger);
  }
  if (response === 'none' && (await page.evaluate(cartBadge).catch(() => null)) !== badge0) response = 'inline';

  // Did a product really go in? Shopify's own count says. When it will not answer (rate limited), the store's
  // visible answer decides, as the brief allows for other platforms; the cart is emptied either way.
  const counted = await cartCount(page);
  const unread = counted === null;
  let added = unread ? response !== 'none' : counted >= 1;
  let error: string | undefined;
  if (guards.checkoutAborts.length) {
    error = 'checkout-attempt';
    console.warn(`checkout guard: blocked ${guards.checkoutAborts.join(', ')} on ${url0}`);
  }
  if (!added) {
    error = error ?? (unread ? 'not-added (count unreadable)' : 'not-added');
    // Fill it another way so the cart page still shows a line item. No moment for that: there is no answer to show.
    // Never when the count could not be read: the click may have added it already, and one product is the rule.
    if (!unread && !guards.checkoutAborts.length && samePath(url0, page.url()) && (await addByApi(page))) added = ((await cartCount(page)) ?? 0) >= 1;
    out.moments.push({ id: `${ctx.vp[0]}-add-to-cart`, kind: 'add-to-cart', viewport: ctx.vp, trigger, response: 'none', frames: [before], panelRef: null, confidence: 'low', ms: Date.now() - t0, error });
    return;
  }

  const shown = panel && (response === 'drawer' || response === 'modal' || response === 'toast') ? panel : null;
  if (shown) await imagesLoaded(page, shown.key);
  const after = await frame(page, ctx, 'add-to-cart', 'after');
  // A drawer with the line item in it is the cart drawer itself: one block, two moments.
  const drawerItem = !!shown && response === 'drawer' && hasLineItem(shown.text, title);
  const shot = shown ? await panelBlock(page, ctx, out, shown.key, drawerItem ? 'cart-drawer' : `add-to-cart-${response}`, 'add-to-cart') : null;
  const good = !error;
  out.moments.push({
    id: `${ctx.vp[0]}-add-to-cart`,
    kind: 'add-to-cart',
    viewport: ctx.vp,
    trigger,
    response,
    frames: [before, after, ...(shot ? [shot.frame] : [])],
    panelRef: shot ? shot.ref : null,
    confidence: good ? 'high' : 'low',
    ms: Date.now() - t0,
    ...(error ? { error } : shown && !shot ? { error: 'panel-shot-failed' } : {}),
  });
  if (shot && drawerItem && ctx.kinds.includes('cart-drawer')) {
    out.moments.push({ id: `${ctx.vp[0]}-cart-drawer`, kind: 'cart-drawer', viewport: ctx.vp, trigger: { action: 'click', label: atc.label || null, via: 'the drawer the add to cart opened' }, frames: [shot.frame], panelRef: shot.ref, confidence: good ? 'high' : 'low', ms: 0 });
    return;
  }
  // The store answered some other way: open its cart drawer from the header, if it has one. Never a link to /cart.
  if (response === 'redirect' || !ctx.kinds.includes('cart-drawer')) return;
  const t1 = Date.now();
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(page, 300);
  const toggle = await page.evaluate(findCartDrawerToggle).catch(() => null);
  if (!toggle) return;
  const base2 = await page.evaluate(snapshotOverlays);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.locator('[data-secmoment-cartdrawer="1"]').first().click({ timeout: 3000 }).catch(() => {});
  const drawer = await waitForPanel(
    page,
    base2,
    (found, backdrop) => found.filter((o) => classOf(o, size.width, size.height, phone, backdrop) === 'drawer' && hasLineItem(o.text, title)).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null,
    2500,
  );
  if (!drawer || !samePath(url0, page.url())) return;
  await imagesLoaded(page, drawer.key);
  const drawerFrame = await frame(page, ctx, 'cart-drawer', 'after');
  const drawerShot = await panelBlock(page, ctx, out, drawer.key, 'cart-drawer', 'cart-drawer');
  if (drawerShot) out.moments.push({ id: `${ctx.vp[0]}-cart-drawer`, kind: 'cart-drawer', viewport: ctx.vp, trigger: { action: 'click', label: toggle.label || null, via: 'header control for the cart drawer' }, frames: [drawerFrame, drawerShot.frame], panelRef: drawerShot.ref, confidence: 'high', ms: Date.now() - t1 });
}

// ---- After both hooks -------------------------------------------------------------------------------

/**
 * Number the panel blocks after the page's own blocks (index, ref b<index>), move each picture to
 * blocks/<d|m>-<index>-<type>.jpg, and point the moments' panelRef and panel frame at it.
 */
export async function finalizeMoments(results: MomentResult[], pageDir: string, vp: 'desktop' | 'mobile', firstIndex: number): Promise<{ moments: CrawlerMoment[]; panels: CapturedBlock[]; notes: string[] }> {
  const moments = results.flatMap((r) => r.moments);
  const panels: CapturedBlock[] = [];
  let index = firstIndex;
  await mkdir(path.join(pageDir, 'blocks'), { recursive: true });
  for (const p of results.flatMap((r) => r.panels)) {
    const ref = `b${index}`;
    const file = `blocks/${vp[0]}-${String(index).padStart(2, '0')}-${p.typeHint}.jpg`;
    const moved = await rename(path.join(pageDir, p.file as string), path.join(pageDir, file)).then(() => true, () => false);
    for (const m of moments) {
      if (m.panelRef !== p.ref) continue;
      m.panelRef = moved ? ref : null;
      m.frames = m.frames.map((f) => (f.role === 'panel' && f.file === p.file ? { ...f, file } : f)).filter((f) => moved || f.role !== 'panel');
      if (!moved) {
        m.confidence = 'low';
        m.error = 'panel-move-failed';
      }
    }
    if (!moved) continue;
    panels.push({ ...p, ref, index, file });
    index++;
  }
  return { moments, panels, notes: results.flatMap((r) => r.notes) };
}
