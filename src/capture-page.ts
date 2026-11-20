// Capturing one page: both viewports, full-page and per-block screenshots,
// the manifest. Used by the one-off CLI (capture.ts) and by the crawl worker
// (crawl.ts). The manifest it writes is a cross-lane contract:
// web/src/contracts/manifest.ts, guarded by src/contract-check.ts.
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectBlocks, collectLinks, detectSite, detectWall, hidePinned, pageMeta, restorePinned, type BlockInfo, type SiteInfo, type PageMeta } from './page-script.js';
import { measureStyles, STYLE_THRESHOLDS, type BlockStyleC, type OutlineNodeC, type PageStylesC, type StyleResult } from './style-script.js';
import { Politeness, botUserAgent, DESKTOP_BASE_UA, MOBILE_BASE_UA, type Lane } from './polite.js';
import { isEmptyCartBlock } from './empty-cart.js';
import type { ManifestClip, MomentKind, MotionKind } from '../web/src/contracts/manifest.js';
import { CLIP_THRESHOLDS, SLIDER_THRESHOLDS, recordClips, recordSliderClips, type RawClip } from './clips.js';
import { encodeClip } from './clip-encode.js';
import { TIME_WARP_SCRIPT, setPageRate } from './time-warp.js';
import { PRODUCT_THRESHOLDS, recordProductClips } from './product-clips.js';
import { PLAY_THRESHOLDS, recordPlayClips } from './play-clips.js';
import { INTERACT_THRESHOLDS, recordInteractClips } from './interact-clips.js';
import { finalizeMoments, runMoments, runPopupWatch, type CrawlerMoment, type MomentContext, type MomentResult } from './moments.js';
import { cartsStopped, clearPending, emptyCart, hasPending, installGuards, loadLines, noteFailed, notePending, noteTry, waitingCarts, CART_ALL_ENV, CART_ALL_VALUE, MAX_WAITING, type CartScope, type HeldCart } from './cart-session.js';

export type ViewportName = 'desktop' | 'mobile';

// The real browser UA plus our bot token, so site owners can see who we are.
export const VIEWPORTS: Record<ViewportName, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; userAgent: string }> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false, userAgent: botUserAgent(DESKTOP_BASE_UA) },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: botUserAgent(MOBILE_BASE_UA) },
};

export type CaptureOptions = {
  out: string;
  only: ViewportName | null;
  maxBlocks: number;
  minHeight: number;
  quality: number;
  /** Hard ceiling for one viewport of one page; a hung site must not stall a night's run. */
  viewportTimeoutMs: number;
  /** Also return the page's same-origin links (from the first successful viewport). */
  wantLinks: boolean;
  /** The store this page belongs to. A store that redirects to a regional host (us.brand.com) still files under its own name. Default: the URL's host without www. */
  host?: string;
  /** Platform lane for the robots.txt request (Shopify throttles per IP across stores). */
  lane?: Lane;
  /** Moments to capture (src/moments.ts). Empty, the default, changes nothing about a capture. */
  moments: MomentKind[];
  /**
   * Who may have a product put in a cart by add-to-cart (src/cart-session.ts). own = config/own-sites.txt;
   * optin = also config/moments-optin.txt (stores that said yes); all = any store whose robots.txt allows the
   * cart, and only with MOMENTS_CART_ALL=I_HAVE_SIGN_OFF (why it stays locked: CART_ALL_ENV in cart-session.ts).
   */
  momentsCartScope: CartScope;
  /** On a store's cart page: the cookies of the cart a product page filled, per viewport, so it shows its line item. */
  cartStates?: Partial<Record<ViewportName, HeldCart>>;
  /** Measure design metadata (SEC-31): pageStyles per viewport, style and outline per block. Off by default while it is proven. */
  styles?: boolean;
  /**
   * Record short silent clips of blocks that move by themselves (video-sections brief; src/clips.ts): motion stays on
   * until they are recorded, then the stills are taken exactly as without clips. Off by default.
   */
  clips?: boolean;
  /**
   * With clips: sliders that only move when pressed get a clip too. After every still and moment, each slider's
   * own "next" arrow (or dots, or track) is pressed a few times while recording (src/clips.ts recordSliderClips).
   * Off by default.
   */
  sliders?: boolean;
  /**
   * With clips, on product pages (stage 2): the photo gallery's thumbnails, the product options and the size
   * guide are recorded (src/product-clips.ts); options and size guide become new blocks. Off by default.
   */
  product?: boolean;
  /**
   * With clips (stage 3): videos that wait for a press get their own play button pressed while they are
   * recorded, then paused again (src/play-clips.ts); a video that opens in a popup becomes a new block. Off by default.
   */
  play?: boolean;
  /**
   * With clips (stage 4): an FAQ question opened, product cards hovered (desktop), a quick view and the filters
   * opened (src/interact-clips.ts), each closed again; quick views and filter panels become new blocks. Off by default.
   */
  interact?: boolean;
};

export const DEFAULT_CAPTURE: CaptureOptions = { out: 'data', only: null, maxBlocks: 40, minHeight: 80, quality: 88, viewportTimeoutMs: 150_000, wantLinks: false, moments: [], momentsCartScope: 'own', styles: false, clips: false, sliders: false, product: false, play: false, interact: false };

/** At most this many clips per page and viewport (the clips test: 4). */
const CLIPS_PER_PAGE = 4;
/** Motion switched off for the stills: CSS animations and transitions end at once. */
const ZERO_MOTION_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}';

let analyticsHosts: string[] | null = null;
const ANALYTICS_HOSTS = () => (analyticsHosts ??= loadLines('config/analytics-hosts.txt'));
let optinHosts: string[] | null = null;
const OPTIN_HOSTS = () => (optinHosts ??= loadLines('config/moments-optin.txt'));

/** Whether this store may have a product put in its cart: scope first, then robots.txt for every cart path we use. */
async function cartGate(polite: Politeness, url: string, host: string, opts: CaptureOptions): Promise<{ ok: boolean; reason: string }> {
  if (cartsStopped()) return { ok: false, reason: `stopped, a cart would not empty (${cartsStopped()})` };
  if (polite.isOwn(host)) return { ok: true, reason: 'own site' };
  if (opts.momentsCartScope === 'own') return { ok: false, reason: 'scope own' };
  if (opts.momentsCartScope === 'optin' && !OPTIN_HOSTS().includes(host)) return { ok: false, reason: 'scope optin' };
  if (opts.momentsCartScope === 'all' && process.env[CART_ALL_ENV] !== CART_ALL_VALUE) return { ok: false, reason: `scope all needs ${CART_ALL_ENV}=${CART_ALL_VALUE}` };
  const origin = new URL(url).origin;
  for (const p of ['/cart', '/cart/add.js', '/cart/clear.js', '/cart.js']) {
    const v = await polite.allowed(origin + p, opts.lane);
    if (!v.ok) return { ok: false, reason: `robots.txt: ${p}` };
  }
  return { ok: true, reason: 'robots.txt allows the cart' };
}

/** What one viewport does with a cart: fill it on a product page, or open a filled one on the cart page and empty it after. */
type CartJob = { fill: boolean; held?: HeldCart };

/** `moment` is set on the panel a moment revealed (a popup, an open menu), written after the page's own blocks. */
export type CapturedBlock = BlockInfo & { viewport: ViewportName; file: string | null; error?: string; moment?: MomentKind; style?: BlockStyleC; outline?: OutlineNodeC[]; motionHint?: MotionKind; clip?: ManifestClip };

/** Hard contract budget for pageStyles plus block style/outline at one viewport. */
export const STYLE_METADATA_BUDGET = 20 * 1024;

/**
 * Keep design metadata within the manifest contract's 20 KB/viewport budget.
 * The richest measurements stay first; on unusually long pages we reduce
 * secondary styles and outline detail, then omit detail from the last blocks.
 * `partial` makes every such trim explicit rather than pretending it is a full
 * measurement. The block fields are optional by contract for this reason.
 */
export function fitStyleMetadata(page: PageStylesC, blocks: CapturedBlock[], budget = STYLE_METADATA_BUDGET): number {
  const bytes = () => Buffer.byteLength(JSON.stringify({ pageStyles: page, blocks: blocks.map(({ style, outline }) => ({ style, outline })) }));
  if (bytes() <= budget) return bytes();
  page.partial = true;

  for (const b of blocks) if (b.style) {
    b.style.type = b.style.type.slice(0, 4);
    b.style.textColours = b.style.textColours.slice(0, 2);
  }
  const trimNodes = (nodes: OutlineNodeC[], max: number, depth = 1): OutlineNodeC[] => nodes.slice(0, max).map((node) => ({
    ...node,
    ...(node.children ? { children: depth >= 2 ? undefined : trimNodes(node.children, Math.max(2, Math.floor(max / 2)), depth + 1) } : {}),
  }));
  for (const b of blocks) if (b.outline) b.outline = trimNodes(b.outline, 20);
  if (bytes() <= budget) return bytes();
  for (const b of blocks) if (b.outline) b.outline = trimNodes(b.outline, 10);

  // Later sections lose outline before style: the style still lets an agent
  // search and compare them, and a screenshot remains available for detail.
  for (let i = blocks.length - 1; i >= 0 && bytes() > budget; i--) delete blocks[i].outline;
  for (let i = blocks.length - 1; i >= 0 && bytes() > budget; i--) delete blocks[i].style;
  return bytes();
}

type ViewportResult =
  | { ok: true; status: number | null; site: SiteInfo; meta: PageMeta; strategy: string; fullFile: string; fullHeight: number; blocks: CapturedBlock[]; links: string[]; finalUrl: string; emptyText: string | null; moments: CrawlerMoment[]; momentNotes: string[]; ms: number; pageStyles: PageStylesC | null; stylesError: string | null; clips?: RawClip[]; productNotes?: string[]; playNotes?: string[]; interactNotes?: string[] }
  | { ok: false; status: number | null; error: string; ms: number };

export type PageResult = {
  url: string;
  host: string;
  slug: string;
  type: string;
  /** captured = every requested viewport worked; partial = some did; failed = none; skipped = never requested. */
  status: 'captured' | 'partial' | 'failed' | 'skipped';
  reason: string | null;
  blocks: number;
  ms: Partial<Record<ViewportName, number>>;
  site: SiteInfo | null;
  links: string[];
  /** Where the browser ended up (brand.com often lands on www.brand.com or a regional host). */
  finalUrl: string | null;
  /** When no block was found at all: what the page says instead ("Restricted Access. Sorry, you cannot visit our store from your current location."). */
  emptyText: string | null;
  lines: string[];
  /** A product page that filled the store's cart: its cookies per viewport, for the cart page (also kept in <out>/_carts until emptied). */
  cart?: Partial<Record<ViewportName, HeldCart>>;
  /** A cart page opened with a filled cart: the viewports whose cart was emptied again and checked. */
  emptied?: ViewportName[];
};

// A leading language or region segment: /gl, /en-us, /us/en, /en_GB.
const LOCALE_PREFIX = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?)(?:\/(?:[a-z]{2}(?:[-_][a-z]{2})?))?(?=\/|$)/i;

export function pageType(url: URL): string {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const t = typeOfPath(p);
  // International stores put the region first (/gl/product/P006524). Only when
  // the path means nothing as it stands, so /dp/B00X stays a product.
  if (t === 'other' && LOCALE_PREFIX.test(p)) return typeOfPath(p.replace(LOCALE_PREFIX, '') || '/');
  return t;
}

function typeOfPath(p: string): string {
  if (p === '/') return 'home';
  if (/^\/collections\/[^/]+\/products\/[^/]+/.test(p)) return 'product';
  if (/^\/products?\/[^/]+/.test(p)) return 'product';
  if (/^\/(p|item|shop\/p|dp)\/[^/]+/.test(p)) return 'product';
  if (/^\/collections\/[^/]+/.test(p) || /^\/(product-category|category|categories|shop|collection|c)(\/[^/]+)+$/.test(p)) return 'collection';
  if (p === '/collections' || p === '/shop' || p === '/store') return 'collection-list';
  if (/^\/cart/.test(p) || /^\/(basket|bag)(\/|$)/.test(p) || /(^|\/)checkout\/cart(\/|$)/.test(p)) return 'cart'; // /checkout/cart is Magento's cart
  if (/checkout/.test(p)) return 'checkout';
  if (/^\/search/.test(p)) return 'search';
  if (/^\/(account|login|signin|register)/.test(p)) return 'account';
  if (/^\/blogs\/[^/]+\/[^/]+/.test(p) || /^\/blog\/[^/]+/.test(p)) return 'article';
  if (/^\/blogs?(\/|$)/.test(p) || /^\/news(\/|$)/.test(p)) return 'blog';
  if (/^\/pages\//.test(p)) return 'page';
  return 'other';
}

export function pageSlug(url: URL): string {
  const p = url.pathname.replace(/^\/+|\/+$/g, '');
  let slug = p ? p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : 'home';
  if (url.search) slug += '-' + createHash('sha1').update(url.search).digest('hex').slice(0, 6);
  return slug.slice(0, 80) || 'home';
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'block';
}

// Consent dialogs are hidden, never clicked. A bot cannot give consent, and
// "decline" is a different button on every tool (some offer none on the first
// screen). Hiding leaves no consent on record, keeps the dialog out of every
// screenshot, and as a style rule it also covers dialogs that show up late.
const HIDE_CONSENT_CSS = `
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
#usercentrics-root, #usercentrics-cmp-ui, #uc-center-container,
#didomi-host, #didomi-notice, .didomi-popup-backdrop,
#truste-consent-track, .truste_overlay, .truste_box_overlay, #consent_blackbar, #teconsent,
#trustarc-banner-overlay, .truste-consent-content-wrapper, #truste-consent-content,
#shopify-pc__banner, .shopify-pc__banner__dialog,
#iubenda-cs-banner,
.cky-consent-container, .cky-overlay,
#cmplz-cookiebanner-container, .cmplz-cookiebanner,
#termly-code-snippet-support,
#qc-cmp2-container, .qc-cmp2-container,
[id^="sp_message_container"],
#cookiescript_injected, #cookiescript_injected_wrapper,
#BorlabsCookieBox,
#axeptio_overlay, .axeptio_mount,
.osano-cm-window, .osano-cm-dialog,
#klaro, .klaro,
#cookie-law-info-bar, .cli-modal-backdrop,
#hs-eu-cookie-confirmation,
#pandectes-banner, .pandectes-cookie-banner,
#cookie-notice, #cookieConsent, #cookie-consent, #cookie-banner, #cookiebanner, #cookie-bar,
.cookie-banner, .cookie-consent, .cookie-notice, .cookie-bar, .cc-window, .cc-banner,
#gdpr-cookie-message, .gdpr-cookie-notice
{ display: none !important; visibility: hidden !important; }
`;

// `escape: false` for moments: a store can answer the key itself. myzoobox.com shows a small fallback list
// instead of its mega menu when the menu is hovered just after Escape.
async function dismissOverlays(page: Page, escape = true): Promise<void> {
  // A hidden consent dialog can leave the page scroll-locked; without scrolling nothing lazy-loads.
  await page
    .evaluate(() => {
      for (const el of [document.documentElement, document.body]) {
        if (el && getComputedStyle(el).overflowY === 'hidden' && el.scrollHeight > window.innerHeight * 1.5) el.style.setProperty('overflow-y', 'auto', 'important');
      }
      // Home-made cookie bars that no vendor list can know: something pinned to
      // the screen, short, that talks about cookies and offers an accept-style
      // button. Hidden like the vendor dialogs, never clicked. A pinned header
      // that happens to mention cookies has many links and is left alone.
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 1200 || el.querySelectorAll('a').length > 6) continue;
        if (/cookie|gdpr|consent/i.test(text) && /\b(accept|agree|ok|okay|got it|allow|decline|reject|understood|dismiss)\b/i.test(text)) el.style.setProperty('display', 'none', 'important');
      }
    })
    .catch(() => {});
  if (escape) await page.keyboard.press('Escape').catch(() => {});
  await page
    .evaluate(() => {
      // Close (never accept) newsletter popups, modals and cookie banners.
      const sels = [
        '[role="dialog"] button[aria-label*="close" i]',
        '[role="dialog"] [class*="close" i]',
        '.klaviyo-close-form',
        '[class*="klaviyo"] [aria-label*="close" i]',
        '[class*="popup" i] [class*="close" i]',
        '[class*="modal" i] [class*="close" i]',
        '[id*="popup" i] [class*="close" i]',
        '[class*="newsletter" i] [class*="close" i]',
        'button[aria-label="Close"]',
        'button[aria-label="Close dialog"]',
        '[data-testid="close"]',
        '#onetrust-reject-all-handler',
        '#CybotCookiebotDialogBodyButtonDecline',
        '.cc-btn.cc-dismiss',
        '[class*="cookie" i] button[class*="decline" i]',
        '[class*="cookie" i] button[class*="reject" i]',
      ];
      let clicked = 0;
      for (const s of sels) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(s))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && clicked < 4) {
            el.click();
            clicked++;
          }
        }
      }
      return clicked;
    })
    .catch(() => 0);
}

async function autoScroll(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const limit = Math.min(document.documentElement.scrollHeight, 60000);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 160));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

async function captureViewportInner(context: BrowserContext, url: string, vp: ViewportName, pageDir: string, opts: CaptureOptions, polite: Politeness, fill: { origin: string | null } | null = null): Promise<ViewportResult> {
  // tsx/esbuild wraps inner functions in a __name() helper that only exists in
  // Node. Functions we ship into the page via page.evaluate still contain the
  // call, so define a no-op shim in the page before any script runs.
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  // Clips are recorded in slow motion (src/time-warp.ts): a page clock whose speed can change, in every frame
  // before the page's own scripts. At normal speed, which is always except while a clip records, nothing changes.
  if (opts.clips) await context.addInitScript(TIME_WARP_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const t0 = Date.now();
  let status: number | null = null;
  try {
    // One navigation per second per host (or the site's Crawl-delay).
    await polite.waitFor(url, opts.lane);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    status = resp ? resp.status() : null;
    // A bot wall or a dead page is not a capture. 404 and friends fail fast.
    if (status !== null && status >= 400) return { ok: false, status, error: `http-${status}`, ms: Date.now() - t0 };
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // With clips, motion stays on until they are recorded (after the blocks are found); otherwise it goes now.
    await page.addStyleTag({ content: (opts.clips ? '' : ZERO_MOTION_CSS) + HIDE_CONSENT_CSS }).catch(() => {});
    await page.waitForTimeout(1200);
    // A wall instead of the store (human check, access denied, geo-block),
    // usually served as 200 OK. Some browser checks clear by themselves within
    // seconds, so look twice. We never interact with one: a wall is a "no".
    let wall = await page.evaluate(detectWall).catch(() => null);
    if (wall) {
      await page.waitForTimeout(8000);
      wall = await page.evaluate(detectWall).catch(() => null);
    }
    if (wall) return { ok: false, status, error: `wall:${wall.kind}: "${wall.text}"`, ms: Date.now() - t0 };
    const kind = pageType(new URL(url));
    // Hook A: the first-visit popup can only be caught before dismissOverlays closes it.
    const mctx: MomentContext = { vp, pageDir, quality: opts.quality, pageType: kind, kinds: opts.moments, dismiss: (p: Page) => dismissOverlays(p, false) };
    // add-to-cart runs only when capturePage cleared this store and viewport for it (cartGate, one cart per run).
    if (fill) mctx.cart = { context, analyticsHosts: ANALYTICS_HOSTS(), pace: () => polite.waitFor(url, opts.lane), onFill: (origin) => (fill.origin = origin) };
    const popup: MomentResult | null = opts.moments.length ? await runPopupWatch(page, mctx) : null;
    await dismissOverlays(page);
    await autoScroll(page);
    await page.waitForTimeout(600);
    await dismissOverlays(page);
    // A video the browser cannot decode shows an error message where the hero
    // should be. Show its poster picture instead, or nothing.
    await page
      .evaluate(() => {
        for (const v of Array.from(document.querySelectorAll('video'))) {
          if (!v.error) continue;
          if (v.poster) {
            const img = document.createElement('img');
            img.src = v.poster;
            img.alt = '';
            const cs = getComputedStyle(v);
            img.style.cssText = `display:block;width:${cs.width};height:${cs.height};object-fit:cover;object-position:${cs.objectPosition || 'center'}`;
            v.replaceWith(img);
          } else {
            v.style.setProperty('visibility', 'hidden', 'important');
          }
        }
      })
      .catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const site = await page.evaluate(detectSite);
    mctx.platform = site.platform;
    const meta = await page.evaluate(pageMeta);
    const links = opts.wantLinks ? await page.evaluate(collectLinks, 400).catch(() => [] as string[]) : [];
    const collected = await page.evaluate(collectBlocks, { minHeight: opts.minHeight, maxBlocks: opts.maxBlocks });
    // "Your cart is empty" is a state, not a cart design (src/empty-cart.ts). Before the block files are named.
    for (const b of collected.blocks) if (isEmptyCartBlock(kind, b.typeHint, b.text)) b.typeHint = 'empty-cart';
    // Design metadata, while every block still carries its data-secref and nothing is hidden yet.
    // A measuring failure never fails the page: the capture carries on without the new fields.
    let styled: StyleResult | null = null;
    let stylesError: string | null = null;
    if (opts.styles && collected.blocks.length) {
      styled = await page
        .evaluate(measureStyles, { t: STYLE_THRESHOLDS, viewport: vp, pageType: pageType(new URL(page.url())) })
        .catch((e: Error) => {
          stylesError = e.message.split('\n')[0];
          return null;
        });
    }
    // A page with nothing to cut up is a geo-block, a bot wall answering 200, or an empty shell. Keep what it says for the failure report.
    const emptyText = collected.blocks.length
      ? null
      : await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)).catch(() => '');

    // Clips: blocks that move by themselves (hero videos, slideshows) are recorded now, while motion is on; the
    // frames wait on disk and are encoded after the page (captureViewport). Then motion goes off and the recorded
    // videos are rewound, so every still below is taken exactly as without clips. A failure never fails the page.
    let rawClips: RawClip[] = [];
    let zeroMotion: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
    if (opts.clips && collected.blocks.length) {
      rawClips = await recordClips(page, { context, framesRoot: path.join(pageDir, '_frames', vp), maxClips: CLIPS_PER_PAGE, log: () => {} }).catch(() => [] as RawClip[]);
      // Normal speed again, even if a recording was cut off before it could put the speed back.
      await setPageRate(page, null, 1);
      await page.emulateMedia({ reducedMotion: 'reduce' }).catch(() => {});
      zeroMotion = await page.addStyleTag({ content: ZERO_MOTION_CSS }).catch(() => null);
      await page
        .evaluate((refs) => {
          for (const ref of refs) {
            for (const v of Array.from(document.querySelectorAll(`[data-secref="${ref}"] video`))) {
              try {
                (v as HTMLVideoElement).currentTime = 0;
              } catch {
                /* not seekable */
              }
            }
          }
        }, rawClips.filter((c) => c.verdict === 'recorded').map((c) => c.ref))
        .catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(800);
    }

    const fullFile = `${vp}.jpg`;
    const fullPath = path.join(pageDir, fullFile);
    // A JPEG cannot be taller than 65,535 pixels. An endless listing at phone
    // sharpness (2x) gets there at about 32,000 CSS pixels and used to come out
    // as an empty file. Cut such pages off at the limit instead.
    const maxCssHeight = Math.floor(65_000 / VIEWPORTS[vp].deviceScaleFactor);
    let fullHeight = Math.min(collected.docHeight, maxCssHeight);
    const written = async () => (await stat(fullPath).catch(() => null))?.size || 0;
    // The full-page picture without what floats over it (chat bubbles, discount
    // tabs, dialogs and their backdrops). A header pinned to the top stays.
    await page.evaluate(hidePinned, { ref: null, rescan: true }).catch(() => 0);
    try {
      await page.screenshot({
        path: fullPath,
        fullPage: true,
        type: 'jpeg',
        quality: opts.quality,
        ...(collected.docHeight > maxCssHeight ? { clip: { x: 0, y: 0, width: VIEWPORTS[vp].width, height: maxCssHeight } } : {}),
      });
      if (!(await written())) throw new Error('empty screenshot');
    } catch {
      await page.screenshot({ path: fullPath, type: 'jpeg', quality: opts.quality }).catch(() => {});
      fullHeight = VIEWPORTS[vp].height;
    }
    await page.evaluate(restorePinned).catch(() => {});
    if (!(await written())) return { ok: false, status, error: 'screenshot-failed', ms: Date.now() - t0 };

    await mkdir(path.join(pageDir, 'blocks'), { recursive: true });
    const blocks: CapturedBlock[] = [];
    // Many headers only become pinned once the page has scrolled, so look for
    // pinned elements a second time from further down before the block shots.
    await page.evaluate(() => window.scrollTo(0, Math.min(document.documentElement.scrollHeight / 2, 3000))).catch(() => {});
    await page.waitForTimeout(250);
    let rescan = true;
    for (const b of collected.blocks) {
      const file = `blocks/${vp[0]}-${String(b.index).padStart(2, '0')}-${slugify(b.typeHint)}.jpg`;
      const loc = page.locator(`[data-secref="${b.ref}"]`).first();
      try {
        // A block's picture shows the block and nothing pinned on top of it. A sticky header still gets its own shot.
        await page.evaluate(hidePinned, { ref: b.ref, rescan }).catch(() => 0);
        rescan = false;
        await loc.scrollIntoViewIfNeeded({ timeout: 10_000 });
        // Lazy pictures start loading only now that the block is on screen. Give them a moment, otherwise
        // the shot shows empty frames and spinners (shop.swatch.com: six of nine blocks were blank).
        await page
          .waitForFunction(
            (ref) => {
              const el = document.querySelector(`[data-secref="${ref}"]`);
              if (!el) return true;
              return Array.from(el.querySelectorAll('img')).every((img) => {
                const r = img.getBoundingClientRect();
                return r.width < 40 || r.height < 40 || img.complete;
              });
            },
            b.ref,
            { timeout: 3000 },
          )
          .catch(() => {});
        await page.waitForTimeout(120);
        await loc.screenshot({ path: path.join(pageDir, file), type: 'jpeg', quality: opts.quality, animations: 'disabled', timeout: 30_000 });
        // Too tall for a JPEG comes out as an empty file rather than an error.
        if (!((await stat(path.join(pageDir, file)).catch(() => null))?.size || 0)) throw new Error('empty screenshot (block too tall for a JPEG?)');
        blocks.push({ ...b, viewport: vp, file, ...styled?.blocks[b.ref] });
      } catch (e) {
        blocks.push({ ...b, viewport: vp, file: null, error: (e as Error).message.split('\n')[0], ...styled?.blocks[b.ref] });
      }
    }
    // Hook B: moments that change the page (open a menu, scroll to a sticky bar), now that every block is on disk.
    let moments: CrawlerMoment[] = [];
    let momentNotes: string[] = [];
    if (opts.moments.length) {
      // A popup that opened while the blocks were being shot would cover every frame (sisterlylab.com's
      // sign-up form on a product page), so close late popups first, by their close buttons only.
      await dismissOverlays(page, false);
      const later = await runMoments(page, mctx);
      const done = await finalizeMoments(popup ? [popup, later] : [later], pageDir, vp, collected.blocks.length + 1);
      blocks.push(...done.panels);
      moments = done.moments;
      momentNotes = done.notes;
    }
    // Sliders that only move when pressed (Ben, 18 Nov 2026), last of all: every still and moment is on disk, so
    // pressing them changes nothing already captured. Motion comes back on for them. The bot page says the
    // crawler moves slideshows to their next slide (released together, BOT_VERSION 0.5).
    if (opts.clips && opts.sliders && collected.blocks.length) {
      await dismissOverlays(page, false);
      await zeroMotion?.evaluate((s) => (s as Element).remove()).catch(() => {});
      await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
      await page.waitForTimeout(300);
      const skip = new Set(rawClips.filter((c) => c.verdict === 'recorded').map((c) => c.ref));
      const env = { context, framesRoot: path.join(pageDir, '_frames', vp), maxClips: SLIDER_THRESHOLDS.maxPerPage, touch: vp === 'mobile', log: () => {} };
      rawClips = [...rawClips, ...(await recordSliderClips(page, env, skip).catch(() => [] as RawClip[]))];
    }
    // Stage 2 (Ben, 18 Nov 2026), product pages only, after the sliders: the photo gallery's thumbnails, the
    // product options and the size guide (src/product-clips.ts). New blocks continue the viewport's indexes.
    // The bot page says the crawler moves product photos, picks options and opens size guides (released
    // together, BOT_VERSION 0.6).
    let productNotes: string[] = [];
    if (opts.clips && opts.product && kind === 'product' && collected.blocks.length) {
      await dismissOverlays(page, false);
      await zeroMotion?.evaluate((s) => (s as Element).remove()).catch(() => {});
      await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
      await page.waitForTimeout(300);
      const skip = new Set(rawClips.filter((c) => c.verdict === 'recorded').map((c) => c.ref));
      const env = { context, framesRoot: path.join(pageDir, '_frames', vp), maxClips: 3, touch: vp === 'mobile', log: () => {} };
      const firstIndex = blocks.reduce((m, b) => Math.max(m, b.index), 0) + 1;
      const pr = await recordProductClips(page, env, { pageDir, vp, quality: opts.quality, firstIndex, skip }).catch((e: Error) => ({ clips: [] as RawClip[], blocks: [], notes: [`product step failed: ${e.message.split('\n')[0]}`] }));
      blocks.push(...pr.blocks);
      rawClips = [...rawClips, ...pr.clips];
      productNotes = pr.notes;
    }
    // Stage 3 (Ben, 20 Nov 2026), last of all: videos that wait for a press get their own play button pressed
    // while they are recorded, then are paused again (src/play-clips.ts); one that opens in a popup becomes a new
    // block. The bot page says the crawler presses play on videos (released together, BOT_VERSION 0.7).
    let playNotes: string[] = [];
    if (opts.clips && opts.play && collected.blocks.length) {
      await dismissOverlays(page, false);
      await zeroMotion?.evaluate((s) => (s as Element).remove()).catch(() => {});
      await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
      await page.waitForTimeout(300);
      const skip = new Set(rawClips.filter((c) => c.verdict === 'recorded').map((c) => c.ref));
      const env = { context, framesRoot: path.join(pageDir, '_frames', vp), maxClips: PLAY_THRESHOLDS.maxPerPage, touch: vp === 'mobile', log: () => {} };
      const firstIndex = blocks.reduce((m, b) => Math.max(m, b.index), 0) + 1;
      const pl = await recordPlayClips(page, env, { pageDir, vp, quality: opts.quality, firstIndex, skip }).catch((e: Error) => ({ clips: [] as RawClip[], blocks: [], notes: [`play step failed: ${e.message.split('\n')[0]}`] }));
      blocks.push(...pl.blocks);
      rawClips = [...rawClips, ...pl.clips];
      playNotes = pl.notes;
    }
    // Stage 4 (Ben, 20 Nov 2026), last of all: an FAQ question opened, product cards hovered (desktop), a quick
    // view and the filters opened, each closed again (src/interact-clips.ts); quick views and filter panels become
    // new blocks. The bot page says the crawler opens questions, quick views and filters and hovers over products.
    let interactNotes: string[] = [];
    if (opts.clips && opts.interact && collected.blocks.length) {
      await dismissOverlays(page, false);
      await zeroMotion?.evaluate((s) => (s as Element).remove()).catch(() => {});
      await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
      await page.waitForTimeout(300);
      const skip = new Set(rawClips.filter((c) => c.verdict === 'recorded').map((c) => c.ref));
      const env = { context, framesRoot: path.join(pageDir, '_frames', vp), maxClips: INTERACT_THRESHOLDS.maxPerPage, touch: vp === 'mobile', log: () => {} };
      const firstIndex = blocks.reduce((m, b) => Math.max(m, b.index), 0) + 1;
      const ir = await recordInteractClips(page, env, { pageDir, vp, quality: opts.quality, firstIndex, skip, pageType: kind, tidy: () => dismissOverlays(page, false) }).catch((e: Error) => ({ clips: [] as RawClip[], blocks: [], notes: [`interaction step failed: ${e.message.split('\n')[0]}`] }));
      blocks.push(...ir.blocks);
      rawClips = [...rawClips, ...ir.clips];
      interactNotes = ir.notes;
    }
    return { ok: true, status, site, meta, strategy: collected.strategy, fullFile, fullHeight, blocks, links, finalUrl: page.url(), emptyText, moments, momentNotes, ms: Date.now() - t0, pageStyles: styled?.page ?? null, stylesError, clips: rawClips, productNotes, playNotes, interactNotes };
  } catch (e) {
    return { ok: false, status, error: (e as Error).message.split('\n')[0], ms: Date.now() - t0 };
  }
}

/**
 * One viewport with a hard ceiling: when time runs out the context is closed, which unblocks anything still
 * waiting on the page. Before it closes: the cookies of a cart add-to-cart filled (even when the page timed
 * out mid-moment), and on a cart page opened with a filled cart's cookies, the cart is emptied and checked.
 */
async function captureViewport(browser: Browser, url: string, vp: ViewportName, pageDir: string, opts: CaptureOptions, polite: Politeness, job: CartJob = { fill: false }): Promise<ViewportResult & { cart?: HeldCart; empty?: { ok: boolean; rateLimited: boolean } }> {
  const v = VIEWPORTS[vp];
  const t0 = Date.now();
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.deviceScaleFactor,
      isMobile: v.isMobile,
      hasTouch: v.hasTouch,
      userAgent: v.userAgent,
      locale: 'en-US',
      colorScheme: 'light',
      // With clips the page moves until they are recorded; captureViewportInner turns reduced motion on after.
      reducedMotion: opts.clips ? 'no-preference' : 'reduce',
      ignoreHTTPSErrors: true,
      ...(job.held ? { storageState: job.held.state } : {}),
    });
    // A filled cart's page never reaches a checkout, and its "viewed cart" never reaches the store's analytics.
    if (job.held) await installGuards(context, ANALYTICS_HOSTS());
  } catch (e) {
    return { ok: false, status: null, error: `browser: ${(e as Error).message.split('\n')[0]}`, ms: Date.now() - t0 };
  }
  const fill = job.fill ? { origin: null as string | null } : null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ViewportResult>((resolve) => {
    // Moments add up to 6 s before the blocks and 35 s after them; filling a cart up to 20 s more.
    // Clips: the clip step's own budget plus one candidate that started just before it ran out; sliders the same.
    const extra =
      (opts.moments.length ? (job.fill ? 55_000 : 40_000) : 0) +
      (opts.clips ? CLIP_THRESHOLDS.pageMs + CLIP_THRESHOLDS.candidateMs + 10_000 : 0) +
      (opts.clips && opts.sliders ? SLIDER_THRESHOLDS.pageMs + SLIDER_THRESHOLDS.candidateMs : 0) +
      (opts.clips && opts.product ? PRODUCT_THRESHOLDS.pageMs + PRODUCT_THRESHOLDS.candidateMs : 0) +
      (opts.clips && opts.play ? PLAY_THRESHOLDS.pageMs + PLAY_THRESHOLDS.candidateMs : 0) +
      (opts.clips && opts.interact ? INTERACT_THRESHOLDS.pageMs + INTERACT_THRESHOLDS.candidateMs : 0);
    timer = setTimeout(() => resolve({ ok: false, status: null, error: 'page-timeout', ms: Date.now() - t0 }), opts.viewportTimeoutMs + extra);
  });
  let r: ViewportResult;
  try {
    r = await Promise.race([captureViewportInner(context, url, vp, pageDir, opts, polite, fill), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let cart: HeldCart | undefined;
  let empty: { ok: boolean; rateLimited: boolean } | undefined;
  try {
    if (fill?.origin) cart = { origin: fill.origin, state: await context.storageState() };
    if (job.held) empty = await emptyCart(context, job.held.origin);
  } catch {
    if (job.held) empty = { ok: false, rateLimited: false };
  } finally {
    await context.close().catch(() => {});
  }
  // Clips are encoded after the page, so encoding never counts against it; the frames go once encoded.
  if (opts.clips) {
    if (r.ok && r.clips?.length) await attachClips(r, pageDir, vp);
    await rm(path.join(pageDir, '_frames', vp), { recursive: true, force: true }).catch(() => {});
  }
  return { ...r, ...(cart ? { cart } : {}), ...(empty ? { empty } : {}) };
}

/**
 * Encode one viewport's recorded clips into blocks/<d|m>-<NN>-<type>.mp4, next to the block's still (its poster),
 * and put them on the blocks: clip (ManifestClip) and motionHint. A clip that will not encode keeps file null and
 * its error, as the contract says. A candidate that turned out not to move only gets its motionHint.
 */
async function attachClips(r: Extract<ViewportResult, { ok: true }>, pageDir: string, vp: ViewportName): Promise<void> {
  const byRef = new Map(r.blocks.map((b) => [b.ref, b]));
  for (const raw of r.clips ?? []) {
    const block = byRef.get(raw.ref);
    if (!block) continue;
    block.motionHint = raw.motionHint;
    if (raw.verdict !== 'recorded' || !raw.frames || !raw.framesDir || !raw.rect || !raw.block || !raw.viewportWidth) continue;
    const stem = block.file ? block.file.replace(/\.jpe?g$/i, '') : `blocks/${vp[0]}-${String(block.index).padStart(2, '0')}-${block.typeHint}`;
    const file = `${stem}.mp4`;
    const rect = { x: Math.round(raw.rect.x - raw.block.x), y: Math.round(raw.rect.y - raw.block.y), width: Math.round(raw.rect.width), height: Math.round(raw.rect.height) };
    const res = await encodeClip({ framesDir: raw.framesDir, frames: raw.frames, rect: raw.rect, viewportWidth: raw.viewportWidth, frameRegion: raw.frameRegion, recordedMs: raw.recordedMs || 5000, slowdown: raw.slowdown, outFile: path.join(pageDir, file) }).catch(
      (e: Error) => ({ ok: false as const, error: e.message.split('\n')[0] }),
    );
    block.clip = res.ok
      ? { kind: raw.motionHint, file, width: res.width, height: res.height, durationMs: res.durationMs, bytes: res.bytes, rect }
      : { kind: raw.motionHint, file: null, width: 0, height: 0, durationMs: 0, bytes: 0, rect, error: res.error };
  }
}

/** Capture one page at the requested viewports and write its manifest. Never throws. */
export async function capturePage(browser: Browser, url: string, opts: CaptureOptions, polite: Politeness): Promise<PageResult> {
  const u = new URL(url);
  const host = opts.host || u.hostname.replace(/^www\./, '');
  const slug = pageSlug(u);
  const type = pageType(u);
  const result: PageResult = { url, host, slug, type, status: 'failed', reason: null, blocks: 0, ms: {}, site: null, links: [], finalUrl: null, emptyText: null, lines: [] };

  const verdict = await polite.allowed(url, opts.lane);
  if (!verdict.ok) {
    result.status = 'skipped';
    result.reason = verdict.reason;
    return result;
  }

  // Moments reach other people's stores only in the release that adds the bot page sentence saying the
  // crawler interacts (moments brief, section 11, approved 17 Nov 2026). Until then: our own stores.
  // MOMENTS_THIRD_PARTY=yes lets the 50-store pilot through.
  if (opts.moments.length && !polite.isOwn(host) && process.env.MOMENTS_THIRD_PARTY !== 'yes') {
    opts = { ...opts, moments: [] };
    result.lines.push('  moments: skipped, own sites only until the bot page says the crawler interacts');
  }

  const pageDir = path.join(opts.out, host, slug);
  await mkdir(pageDir, { recursive: true });
  const manifest: {
    site: { host: string; origin: string } & Partial<SiteInfo>;
    page: { url: string; type: string; slug: string; capturedAt: string } & Partial<PageMeta>;
    viewports: Record<string, unknown>;
    blocks: CapturedBlock[];
    moments?: CrawlerMoment[];
    pageStyles?: Partial<Record<ViewportName, PageStylesC>>;
  } = { site: { host, origin: u.origin }, page: { url, type, slug, capturedAt: new Date().toISOString() }, viewports: {}, blocks: [] };
  // Present whenever moments were asked for, even if the store did nothing; absent otherwise, as before.
  if (opts.moments.length) manifest.moments = [];
  // Filling a cart (src/cart-session.ts): decided once per product page.
  let cartOk = false;
  if (opts.moments.includes('add-to-cart') && type === 'product') {
    const gate = await cartGate(polite, url, host, opts);
    cartOk = gate.ok;
    result.lines.push(`  cart: ${gate.ok ? 'may be filled' : 'not filled'} (${gate.reason})`);
  }

  const vps: ViewportName[] = opts.only ? [opts.only] : ['desktop', 'mobile'];
  let okCount = 0;
  const errors: string[] = [];
  for (const vp of vps) {
    // One cart per store and viewport per run: never when this viewport already holds one, and never while
    // MAX_WAITING carts wait for Shopify's rate limit to let us empty them.
    const waiting = cartOk ? waitingCarts(opts.out).length : 0;
    const fill = cartOk && !hasPending(opts.out, host, vp) && !cartsStopped() && waiting < MAX_WAITING;
    if (cartOk && !fill) result.lines.push(`  ${vp}: cart not filled (${cartsStopped() ? 'stopped, a cart would not empty' : hasPending(opts.out, host, vp) ? 'this store already holds one' : `${waiting} carts wait to be emptied`})`);
    const held = opts.cartStates?.[vp];
    const r = await captureViewport(browser, url, vp, pageDir, opts, polite, { fill, held });
    if (r.cart) {
      await notePending(opts.out, host, vp, r.cart);
      result.cart = { ...result.cart, [vp]: r.cart };
    }
    if (held) {
      if (r.empty?.ok) {
        await clearPending(opts.out, host, vp);
        result.emptied = [...(result.emptied ?? []), vp];
        result.lines.push(`  ${vp}: cart emptied and checked`);
      } else if (r.empty?.rateLimited) {
        // Shopify's rate limit (429), not a refusal: written down, tried again after a quiet spell (cart-session.ts).
        if (!hasPending(opts.out, host, vp)) await notePending(opts.out, host, vp, held);
        await noteTry(opts.out, host, vp);
        result.lines.push(`  ${vp}: cart not emptied yet (Shopify rate limit); kept in ${path.join(opts.out, '_carts')}, tried again after 10 quiet minutes`);
      } else {
        await noteFailed(opts.out, host, vp);
        result.lines.push(`  ${vp}: CART NOT EMPTIED, kept in ${path.join(opts.out, '_carts')} to try again`);
      }
    }
    result.ms[vp] = r.ms;
    if (!r.ok) {
      manifest.viewports[vp] = { error: r.error, status: r.status };
      errors.push(`${vp}: ${r.error}`);
      result.lines.push(`  ${vp}: FAILED ${r.error}`);
      // A 4xx/5xx, a wall or a dead page will not improve at another width.
      if (/^http-|^wall:|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(r.error)) break;
      continue;
    }
    okCount++;
    const okBlocks = r.blocks.filter((b) => b.file).length;
    const themeName = r.site.theme && (r.site.theme as { name?: string }).name;
    const stylesNote = r.pageStyles ? ` · styles ${r.pageStyles.ms}ms${r.pageStyles.partial ? ' (partial)' : ''}` : r.stylesError ? ` · styles failed: ${r.stylesError}` : '';
    result.lines.push(`  ${vp}: ${r.site.platform}${themeName ? ' / ' + themeName : ''} · ${okBlocks}/${r.blocks.length} blocks (${r.strategy}) · ${(r.ms / 1000).toFixed(1)}s${stylesNote}`);
    if (r.pageStyles) {
      const styleBytes = fitStyleMetadata(r.pageStyles, r.blocks);
      (manifest.pageStyles ||= {})[vp] = r.pageStyles;
      if (r.pageStyles.partial) result.lines.push(`  ${vp}: design metadata partial, ${styleBytes} bytes after budget trimming`);
    }
    manifest.viewports[vp] = { file: r.fullFile, width: VIEWPORTS[vp].width, fullHeight: r.fullHeight, strategy: r.strategy, status: r.status, ms: r.ms };
    if (!manifest.site.platform) Object.assign(manifest.site, r.site);
    if (!manifest.page.title) Object.assign(manifest.page, r.meta);
    if (!result.site) result.site = r.site;
    if (!result.links.length) result.links = r.links;
    if (!result.finalUrl) result.finalUrl = r.finalUrl;
    if (result.emptyText === null && r.emptyText !== null) result.emptyText = r.emptyText;
    manifest.blocks.push(...r.blocks);
    result.blocks += okBlocks;
    if (manifest.moments) {
      manifest.moments.push(...r.moments);
      const said = r.moments.map((m) => `${m.kind} ${m.confidence === 'high' ? (m.response ?? 'ok') : m.error}`);
      result.lines.push(`  ${vp} moments: ${said.length ? said.join(', ') : 'none'}${r.momentNotes.length ? ' · ' + r.momentNotes.join('; ') : ''}`);
    }
    if (opts.clips) {
      const raws = new Map((r.clips ?? []).filter((c) => c.verdict === 'recorded').map((c) => [c.ref, c]));
      const clipped = r.blocks
        .filter((b) => b.clip?.file)
        .map((b) => {
          const raw = raws.get(b.ref);
          const how = raw ? `${raw.pressed ? ` pressed (${raw.why.replace(/^slider /, '').split(':')[0]})` : ''} x${raw.slowdown ?? 1}${raw.captureFps ? ` (${raw.captureFps} shots/s)` : ''}` : '';
          return `${b.typeHint} ${b.clip!.kind} ${(b.clip!.durationMs / 1000).toFixed(1)}s ${Math.round(b.clip!.bytes / 1024)}KB${how}`;
        });
      const tried = (r.clips ?? [])
        .filter((c) => c.verdict !== 'recorded')
        .map((c) => `${c.pressed ? `slider ${c.ref}` : `${c.motionHint} ${c.ref}`} ${c.verdict}${c.error ? ` (${c.error})` : ''}${c.pressed && c.error === 'navigated' ? ` after pressing "${c.why.split(': ').slice(1).join(': ')}"` : ''}`);
      result.lines.push(`  ${vp} clips: ${clipped.length ? clipped.join(', ') : 'none'}${tried.length ? ` · not recorded: ${tried.join(', ')}` : ''}`);
      if (r.productNotes?.length) result.lines.push(`  ${vp} product: ${r.productNotes.join(', ')}`);
      if (r.playNotes?.length) result.lines.push(`  ${vp} play: ${r.playNotes.join(', ')}`);
      if (r.interactNotes?.length) result.lines.push(`  ${vp} interact: ${r.interactNotes.join(', ')}`);
    }
  }

  if (okCount > 0) await writeFile(path.join(pageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  // The clip frames are gone once encoded (captureViewport); their now empty folder goes too.
  if (opts.clips) await rm(path.join(pageDir, '_frames'), { recursive: true, force: true }).catch(() => {});
  // Kept so page discovery can be improved and re-run later without visiting the store again.
  if (opts.wantLinks && result.links.length) await writeFile(path.join(pageDir, 'links.json'), JSON.stringify(result.links, null, 1), 'utf8');
  result.status = okCount === vps.length ? 'captured' : okCount > 0 ? 'partial' : 'failed';
  result.reason = errors.length ? errors.join('; ') : null;
  return result;
}
