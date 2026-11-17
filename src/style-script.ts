// Design metadata (SEC-31): measured from the rendered page, inside the page.
//
// THE RULE: store MEASUREMENTS and DESCRIPTIONS, never SOURCE.
//   "Heading, 48px, weight 700, Poppins" is a measurement and may be stored.
//   The store's HTML, CSS, class names, ids, inline styles, scripts, font files
//   and URLs to any of them are source and must never be written by this file.
//   Class names and attributes may be READ to recognise a thing (a carousel, a
//   product link); they are never EMITTED. Font family names are facts; font
//   files are not ours. Copy stays short (headings 80, labels 40 characters).
//   The bot page promises the crawler "never copies your code, images or files"
//   (docs/bot-page.md). Do not add "let's also keep the raw HTML" here.
//
// Like page-script.ts, everything below runs INSIDE the page through
// page.evaluate: measureStyles must be self-contained (no imports, no closures
// over module scope). The thresholds travel in as an argument.
//
// The shapes mirror web/src/contracts/manifest.ts; src/contract-check.ts fails
// the type-check if they drift.

type Hex = string;
export type TextRoleC = 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5' | 'heading-6' | 'body' | 'button' | 'link' | 'price' | 'label';
export type TextCaseC = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
export type TextStyleC = { role: TextRoleC; family: string; size: number; weight: number; lineHeight: number | null; letterSpacing: number; case: TextCaseC; colour: Hex; share: number };
export type OutlineNodeC = {
  type: 'heading' | 'text' | 'image' | 'video' | 'button' | 'link-list' | 'price' | 'rating' | 'form' | 'badge' | 'icon-row' | 'product-card' | 'accordion' | 'carousel' | 'table' | 'group';
  level?: number;
  text?: string;
  words?: number;
  ratio?: string;
  alt?: boolean;
  variant?: number | null;
  compareAt?: boolean;
  rating?: { value: number | null; count: number | null };
  count?: number;
  columns?: number;
  rows?: number;
  fields?: string[];
  children?: OutlineNodeC[];
};
export type BlockStyleC = {
  type: TextStyleC[];
  background: { kind: 'colour' | 'image' | 'video' | 'gradient'; colour: Hex | null };
  textColours: { colour: Hex; share: number }[];
  accent: Hex | null;
  border: Hex | null;
  contrastPass: number | null;
  layout: { columns: number; mediaSide: 'left' | 'right' | 'top' | 'background' | 'none'; width: 'full' | 'contained'; contentWidth: number; padTop: number; padBottom: number; align: 'left' | 'center' | 'right' };
  radius: { button: number | null; image: number | null; card: number | null };
  shadows: boolean;
  imagery: { count: number; areaShare: number; ratio: string | null };
  commerce: {
    price: boolean;
    compareAt: boolean;
    discount: string | null;
    rating: { value: number | null; count: number | null } | null;
    freeShipping: string | null;
    subscription: boolean;
    urgency: boolean;
    paymentBadges: boolean;
    products: number;
    gridColumns: number | null;
  };
};
export type PaletteRoleC = 'background' | 'surface' | 'text' | 'text-muted' | 'accent' | 'accent-text' | 'border' | 'link';
export type ButtonVariantC = { background: Hex | null; text: Hex; border: Hex | null; radius: number; height: number; paddingX: number; fontSize: number; weight: number; case: TextCaseC; count: number };
export type HeadingLevelC = { level: 1 | 2 | 3 | 4 | 5 | 6; count: number; size: number | null; weight: number | null; family: string | null; uppercaseShare: number | null; length: number | null };
export type PageStylesC = {
  version: 1;
  partial: boolean;
  ms: number;
  chars: number;
  typography: {
    families: { family: string; share: number; roles: ('heading' | 'body' | 'button')[] }[];
    scale: { size: number; share: number }[];
    bodySize: number | null;
    bodyLineHeight: number | null;
    headingRatios: number[];
    weights: number[];
    headingUppercaseShare: number | null;
  };
  headings: { levels: HeadingLevelC[]; h1Count: number; skips: number; styledNotMarked: number; share: number; perScreen: number };
  colour: { palette: { role: PaletteRoleC; colour: Hex; share: number; bucket?: string }[]; hues: number; contrastPass: number | null };
  buttons: { variants: ButtonVariantC[]; primary: number | null; labels: string[] };
  shape: { radius: { button: number | null; image: number | null; card: number | null; input: number | null }; label: 'sharp' | 'soft' | 'rounded' | 'pill' | null; shadows: boolean };
  spacing: { contentWidth: number | null; gutter: number | null; blockPadding: number | null; baseUnit: 4 | 8 | null };
  layout: { screens: number; blocks: number; wordsPerScreen: number; imagesPerScreen: number; imageryShare: number; gridColumns: number | null };
  components: { forms: number; inputs: number; accordions: number; carousels: number; tabs: number; tables: number; videos: number; sticky: number };
  accessibility: { altShare: number | null; headingOrderValid: boolean; contrastPass: number | null; lang: boolean; labelledInputs: number | null; tapTargets: number | null };
};
export type StyleResult = { page: PageStylesC; blocks: Record<string, { style: BlockStyleC; outline?: OutlineNodeC[] }> };

/**
 * Every tunable number in one place (brief section 10: "keep thresholds in one
 * exported constant, with a comment naming the stores that drove each change").
 * Change log:
 *   First version, tuned against src/styles-check.ts and one real page:
 *   myzoobox.com product page (16 Nov 2026): skip links are not buttons; minStyleShare added for the size budget.
 */
export const STYLE_THRESHOLDS = {
  /** Time budget per viewport; past it, readings stop early and partial is set. */
  budgetMs: 1500,
  /** Text runs read at most. */
  maxRuns: 4000,
  /** Buttons, images and inputs inspected at most, each. */
  maxElements: 600,
  /** Elements visited per block when building its outline. */
  outlineMaxVisit: 1500,
  outlineDepth: 3,
  outlineMaxNodes: 40,
  /** A run needs at least this many non-space characters. */
  minRunChars: 2,
  /** OKLCH chroma below this is neutral. */
  neutralChroma: 0.03,
  /** Colours closer than this (OKLab distance x 100, roughly CIELAB ΔE) merge. */
  mergeDeltaE: 3,
  contrastNormal: 4.5,
  contrastLarge: 3,
  largeSize: 24,
  largeBoldSize: 18.66,
  /** Text under this size is a label. */
  labelMaxSize: 12,
  /** Styled-but-not-marked headings: size at least this times the body size, this weight, under this length. */
  styledHeadingRatio: 1.5,
  styledHeadingWeight: 600,
  styledHeadingMaxChars: 80,
  minButtonHeight: 24,
  maxButtonHeight: 120,
  minImage: 40,
  /** Images at least this big count for corner radius. */
  radiusImage: 80,
  iconMax: 64,
  iconRowMaxText: 60,
  buttonRadiusTolerance: 2,
  maxTypeStyles: 8,
  /** Text styles carrying less of a block's characters than this are left out (size budget: 20 KB per viewport; myzoobox.com product page). */
  minStyleShare: 0.02,
  maxTextColours: 4,
  maxVariants: 3,
  fullWidthShare: 0.95,
  tapTarget: 44,
  /** Background images smaller than this (CSS px) are decoration (select arrows, bullets), not a backdrop. */
  backdropMinW: 120,
  backdropMinH: 60,
};
export type StyleThresholds = typeof STYLE_THRESHOLDS;

/** Measure the page's design (L2) and every [data-secref] block's style and outline (L1). Run after collectBlocks. */
export function measureStyles(arg: { t: StyleThresholds; viewport: 'desktop' | 'mobile'; pageType: string }): StyleResult {
  const T = arg.t;
  const t0 = performance.now();
  let partial = false;
  const over = () => {
    if (performance.now() - t0 > T.budgetMs) partial = true;
    return partial;
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const docH = Math.max(document.documentElement.scrollHeight, vh);
  const screens = docH / vh;
  const BUTTON_SEL = 'a.button, a.btn, button, [class*="button"], [class*="btn"], input[type="submit"]';
  const INTERACTIVE = 'a, button, input, [role="button"]';
  const PRICE = /(?:[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|CAD|NZD|CHF|SEK|DKK|NOK|JPY|INR|kr|zł)\b)\s?\d|\d[\d.,]*\s?(?:[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|CAD|NZD|CHF|SEK|DKK|NOK|kr|zł|Kč)\b)/;
  /** A short run that is mostly a price ("$24.00", "From 29,99 €", "Sale price$24"), not a sentence that mentions one. */
  const isPrice = (t: string, max: number) => t.length <= max && PRICE.test(t) && t.replace(/[\d\s.,:$€£¥₹%()+-]/g, '').length <= 14;
  const PRODUCT_PATH = /\/(?:collections\/[^/]+\/)?products?\/[^/?#]+|\/(?:p|item|shop\/p|dp)\/[^/?#]+/i;
  const VIDEO_SRC = /youtube|vimeo|videopress|wistia|vidyard|loom/i;
  const CAROUSEL = /carousel|slider|slideshow|swiper|splide|slick|flickity|glide|embla|keen-slider/i;
  const SLIDE = /(?:^|\s)(?:\S*[_-])?slide(?:\s|$)|swiper-slide|slick-slide|splide__slide|carousel-item|carousel__slide|flickity-cell|glide__slide|keen-slider__slide/i;
  const PAYMENT = /visa|mastercard|master card|amex|american express|paypal|apple ?pay|google ?pay|g ?pay|shop ?pay|klarna|afterpay|clearpay|discover|maestro|diners|jcb|union ?pay|venmo|affirm|sezzle|ideal|bancontact/i;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'META', 'LINK', 'IFRAME_SKIP']);

  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  type Rect = { top: number; left: number; bottom: number; right: number };

  const round = (n: number, step = 1) => Math.round(n / step) * step;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mode = <K>(xs: K[]): K | null => {
    const c = new Map<K, number>();
    for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
    let best: K | null = null;
    let n = 0;
    for (const [k, v] of c) if (v > n) { best = k; n = v; }
    return best;
  };
  const docRect = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { top: r.top + sy, left: r.left + sx, bottom: r.bottom + sy, right: r.right + sx };
  };
  const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const union = (rs: Rect[]): Rect | null =>
    rs.length ? rs.reduce((a, b) => ({ top: Math.min(a.top, b.top), left: Math.min(a.left, b.left), bottom: Math.max(a.bottom, b.bottom), right: Math.max(a.right, b.right) })) : null;
  const clipArea = (r: Rect, to: Rect) => area({ top: Math.max(r.top, to.top), left: Math.max(r.left, to.left), bottom: Math.min(r.bottom, to.bottom), right: Math.min(r.right, to.right) });
  const visible = (el: Element): boolean => {
    const e = el as Element & { checkVisibility?: (o: Record<string, boolean>) => boolean };
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.right > 0 && r.left < vw;
  };
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const textOf = (el: Element) => clean((el as HTMLElement).innerText ?? el.textContent ?? '');
  const classOf = (el: Element) => (typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : el.getAttribute('class') || '');

  // ---- colour --------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colourMemo = new Map<string, RGBA | null>();
  function parse(css: string): RGBA | null {
    if (!css) return null;
    const hit = colourMemo.get(css);
    if (hit !== undefined) return hit;
    let out: RGBA | null = null;
    const m = css.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i);
    if (m) out = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4])];
    else if (css === 'transparent') out = [0, 0, 0, 0];
    else if (ctx) {
      // color(srgb ...), oklch(...), named colours: let the canvas normalise them.
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    colourMemo.set(css, out);
    return out;
  }
  const blend = (fg: RGBA, bg: RGB): RGB => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as RGB;
  const hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const contrast = (a: RGB, b: RGB) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const okMemo = new Map<string, [number, number, number]>();
  function oklab(h: string): [number, number, number] {
    const hit = okMemo.get(h);
    if (hit) return hit;
    const [r, g, b] = fromHex(h).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const out: [number, number, number] = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    okMemo.set(h, out);
    return out;
  }
  const chroma = (h: string) => {
    const [, a, b] = oklab(h);
    return Math.hypot(a, b);
  };
  const neutral = (h: string) => chroma(h) < T.neutralChroma;
  const hueBin = (h: string) => {
    const [, a, b] = oklab(h);
    return Math.floor((((Math.atan2(b, a) * 180) / Math.PI + 360) % 360) / 30);
  };
  const deltaE = (x: string, y: string) => {
    const a = oklab(x);
    const b = oklab(y);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
  };
  /** Merge near-identical colours (heaviest wins as the representative), heaviest first. */
  function merge(items: { colour: string; weight: number }[]): { colour: string; weight: number }[] {
    const out: { colour: string; weight: number }[] = [];
    const byColour = new Map<string, number>();
    for (const it of items) byColour.set(it.colour, (byColour.get(it.colour) || 0) + it.weight);
    for (const [colour, weight] of [...byColour].sort((a, b) => b[1] - a[1])) {
      const near = out.find((o) => deltaE(o.colour, colour) < T.mergeDeltaE);
      if (near) near.weight += weight;
      else out.push({ colour, weight });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The colour painted behind an element, and whether imagery is involved.
  type Bg = { image: boolean; gradient: boolean; rgb: RGB };
  const bgMemo = new Map<Element, Bg>();
  function bgOf(el: Element | null): Bg {
    if (!el) return { image: false, gradient: false, rgb: [255, 255, 255] };
    const hit = bgMemo.get(el);
    if (hit) return hit;
    const under = bgOf(el.parentElement);
    const cs = getComputedStyle(el);
    const own = parse(cs.backgroundColor);
    const rgb = own && own[3] > 0 ? blend(own, under.rgb) : under.rgb;
    let image = own && own[3] >= 0.99 ? false : under.image;
    let gradient = own && own[3] >= 0.99 ? false : under.gradient;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const r = el.getBoundingClientRect();
      if (r.width >= T.backdropMinW && r.height >= T.backdropMinH) {
        image = true;
        gradient = !/url\(/.test(cs.backgroundImage);
      }
    }
    const res = { image, gradient, rgb };
    bgMemo.set(el, res);
    return res;
  }

  // ---- fonts -----------------------------------------------------------------
  const GENERIC: Record<string, string> = {
    serif: 'serif', 'sans-serif': 'sans-serif', monospace: 'monospace', cursive: 'cursive', fantasy: 'fantasy',
    'system-ui': 'system', '-apple-system': 'system', blinkmacsystemfont: 'system', 'ui-sans-serif': 'system',
    'ui-serif': 'serif', 'ui-monospace': 'monospace', 'ui-rounded': 'system',
  };
  const installedMemo = new Map<string, boolean>();
  // A family renders only if it is installed or its web font has loaded. document.fonts.check() alone
  // cannot tell: it answers true for a family it knows nothing about. Measuring a sample against
  // three fallbacks can: a missing family falls back and measures the same as each of them.
  function installed(fam: string): boolean {
    const hit = installedMemo.get(fam);
    if (hit !== undefined) return hit;
    let ok = false;
    if (ctx) {
      const sample = 'mmmmmmmmmmlliWWQ@#0';
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        ctx.font = `72px ${base}`;
        const w0 = ctx.measureText(sample).width;
        ctx.font = `72px "${fam}", ${base}`;
        if (Math.abs(ctx.measureText(sample).width - w0) > 0.5) { ok = true; break; }
      }
    }
    if (ok && document.fonts && typeof document.fonts.check === 'function') {
      try { ok = document.fonts.check(`16px "${fam}"`); } catch { /* keep the measurement */ }
    }
    installedMemo.set(fam, ok);
    return ok;
  }
  const familyMemo = new Map<string, string>();
  function renderedFamily(stack: string): string {
    const hit = familyMemo.get(stack);
    if (hit) return hit;
    let out = 'serif';
    for (const raw of stack.split(',')) {
      const fam = raw.trim().replace(/^["']|["']$/g, '').trim();
      if (!fam) continue;
      const g = GENERIC[fam.toLowerCase()];
      if (g) { out = g; break; }
      if (installed(fam)) { out = fam; break; }
    }
    familyMemo.set(stack, out);
    return out;
  }
  const caseOf = (transform: string, text: string): TextCaseC => {
    if (transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize') return transform;
    const letters = text.replace(/[^\p{L}]/gu, '');
    return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() ? 'uppercase' : 'none';
  };

  // ---- blocks ---------------------------------------------------------------
  const blockEls = Array.from(document.querySelectorAll('[data-secref]'));
  const blockRect = new Map<string, Rect>();
  for (const b of blockEls) blockRect.set(b.getAttribute('data-secref')!, docRect(b));
  const blockOf = (el: Element): string | null => el.closest('[data-secref]')?.getAttribute('data-secref') ?? null;

  // ---- media (images, videos) ----------------------------------------------
  type Media = { el: Element; rect: Rect; kind: 'image' | 'video'; ratio: string; alt: boolean; altAttr: boolean; block: string | null };
  const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['3:2', 1.5], ['4:3', 4 / 3], ['16:9', 16 / 9], ['21:9', 21 / 9]];
  const snap = (w: number, h: number) => {
    if (!w || !h) return null;
    const r = Math.log(w / h);
    let best = RATIOS[0];
    for (const x of RATIOS) if (Math.abs(Math.log(x[1]) - r) < Math.abs(Math.log(best[1]) - r)) best = x;
    return best[0];
  };
  const media: Media[] = [];
  const mediaOf = new Map<Element, Media>();
  {
    const els = Array.from(document.querySelectorAll('img, video, iframe'));
    let n = 0;
    for (const el of els) {
      if (n >= T.maxElements) { partial = true; break; }
      if (el.tagName === 'IFRAME' && !VIDEO_SRC.test(el.getAttribute('src') || '')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < T.minImage || r.height < T.minImage || !visible(el)) continue;
      n++;
      const img = el as HTMLImageElement;
      const vid = el as HTMLVideoElement;
      const nw = el.tagName === 'IMG' ? img.naturalWidth : el.tagName === 'VIDEO' ? vid.videoWidth : 0;
      const nh = el.tagName === 'IMG' ? img.naturalHeight : el.tagName === 'VIDEO' ? vid.videoHeight : 0;
      // The picture as laid out: object-fit: cover crops to the box, so the box is what a visitor sees.
      const fit = el.tagName === 'IMG' ? getComputedStyle(el).objectFit : 'fill';
      const ratio = (fit === 'cover' || !nw ? snap(r.width, r.height) : snap(nw, nh)) || '1:1';
      const m: Media = { el, rect: docRect(el), kind: el.tagName === 'IMG' ? 'image' : 'video', ratio, alt: el.tagName === 'IMG' ? !!(img.getAttribute('alt') || '').trim() : false, altAttr: el.tagName === 'IMG' ? img.hasAttribute('alt') : true, block: blockOf(el) };
      media.push(m);
      mediaOf.set(el, m);
    }
  }

  // ---- buttons (6.6) --------------------------------------------------------
  type Btn = { el: Element; bg: string | null; text: string; border: string | null; radius: number; height: number; paddingX: number; fontSize: number; weight: number; case: TextCaseC; label: string; shadow: boolean; block: string | null; addToCart: boolean };
  const buttons: Btn[] = [];
  const buttonSet = new Set<Element>();
  const effRadius = (cs: CSSStyleDeclaration, r: DOMRect) => {
    const raw = cs.borderTopLeftRadius || '0';
    const n = parseFloat(raw) || 0;
    const px = raw.includes('%') ? (n / 100) * Math.min(r.width, r.height) : n;
    return round(Math.min(px, Math.min(r.width, r.height) / 2), 0.5);
  };
  {
    const all = Array.from(document.querySelectorAll(BUTTON_SEL));
    const matched = new Set(all);
    let n = 0;
    for (const el of all) {
      if (n >= T.maxElements) { partial = true; break; }
      const interactive = el.matches(INTERACTIVE);
      if (!interactive) {
        // A wrapper (div.product-form__buttons) or a label inside a button (span.btn__text) is not the button.
        if (el.closest(INTERACTIVE)) continue;
        if (Array.from(el.querySelectorAll(INTERACTIVE)).some((x) => matched.has(x) || x.tagName === 'BUTTON')) continue;
      }
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'submit') continue;
      const r = el.getBoundingClientRect();
      if (r.height < T.minButtonHeight || r.height > T.maxButtonHeight || r.width > vw * 0.95 || !visible(el)) continue;
      const label = clean(el.tagName === 'INPUT' ? (el as HTMLInputElement).value : textOf(el)).slice(0, 40);
      if (label.length < 2) continue; // icon buttons (close, menu, arrows) say nothing about the button style
      if (/^skip to\b/i.test(label)) continue; // an accessibility skip link, not a button (myzoobox.com)
      n++;
      const cs = getComputedStyle(el);
      const bgc = parse(cs.backgroundColor);
      const under = bgOf(el.parentElement);
      const bg = bgc && bgc[3] > 0.1 ? hex(blend(bgc, under.rgb)) : null;
      const tc = parse(cs.color) || [0, 0, 0, 1];
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const bc = parse(cs.borderTopColor);
      const border = bw >= 1 && cs.borderTopStyle !== 'none' && bc && bc[3] > 0.1 ? hex(blend(bc, under.rgb)) : null;
      const form = el.closest('form');
      const addToCart = !!(form && /\/cart\/add/.test(form.getAttribute('action') || '')) || /add to (cart|bag|basket)|in den warenkorb|ajouter au panier/i.test(label);
      buttons.push({
        el, bg, text: hex(blend(tc as RGBA, bg ? fromHex(bg) : under.rgb)), border, radius: effRadius(cs, r), height: Math.round(r.height),
        paddingX: Math.round(parseFloat(cs.paddingLeft) || 0), fontSize: round(parseFloat(cs.fontSize) || 16, 0.5), weight: Number(cs.fontWeight) || 400,
        case: caseOf(cs.textTransform, label), label, shadow: cs.boxShadow !== 'none', block: blockOf(el), addToCart,
      });
      buttonSet.add(el);
    }
  }
  // Cluster by (background, text colour, radius within 2px).
  type Cluster = { bg: string | null; text: string; radius: number; members: Btn[] };
  const clusters: Cluster[] = [];
  for (const b of buttons) {
    const c = clusters.find((k) => k.bg === b.bg && k.text === b.text && Math.abs(k.radius - b.radius) <= T.buttonRadiusTolerance);
    if (c) c.members.push(b);
    else clusters.push({ bg: b.bg, text: b.text, radius: b.radius, members: [b] });
  }
  clusters.sort((a, b) => b.members.length - a.members.length);
  let primaryCluster: Cluster | null = null;
  if (arg.pageType === 'product') primaryCluster = clusters.find((c) => c.members.some((m) => m.addToCart)) || null;
  if (!primaryCluster) primaryCluster = clusters.find((c) => c.bg !== null) || null;
  const kept = clusters.slice(0, T.maxVariants);
  if (primaryCluster && !kept.includes(primaryCluster)) kept[kept.length - 1] = primaryCluster;
  const variantOf = new Map<Element, number>();
  kept.forEach((c, i) => c.members.forEach((m) => variantOf.set(m.el, i)));
  const variants: ButtonVariantC[] = kept.map((c) => ({
    background: c.bg,
    text: c.text,
    border: mode(c.members.map((m) => m.border)),
    radius: median(c.members.map((m) => m.radius)) ?? 0,
    height: Math.round(median(c.members.map((m) => m.height)) ?? 0),
    paddingX: Math.round(median(c.members.map((m) => m.paddingX)) ?? 0),
    fontSize: median(c.members.map((m) => m.fontSize)) ?? 0,
    weight: Math.round(median(c.members.map((m) => m.weight)) ?? 400),
    case: mode(c.members.map((m) => m.case)) || 'none',
    count: c.members.length,
  }));
  const primary = primaryCluster ? kept.indexOf(primaryCluster) : null;

  // ---- product cards ----------------------------------------------------------
  const cardSet = new Set<Element>();
  const cardsByBlock = new Map<string, Element[]>();
  for (const block of blockEls) {
    if (over()) break;
    // pathname, or the raw href when the page has no usable base (a document written in place).
    const pathOf = (a: HTMLAnchorElement) => a.pathname || (a.getAttribute('href') || '').replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0];
    const anchors = (Array.from(block.querySelectorAll('a[href]')) as HTMLAnchorElement[]).filter((a) => PRODUCT_PATH.test(pathOf(a))).slice(0, 200);
    if (anchors.length < 2) continue;
    const cards = new Set<Element>();
    for (const a of anchors) {
      let c: Element = a;
      while (c.parentElement && c.parentElement !== block) {
        const p = c.parentElement;
        if (anchors.some((x) => pathOf(x) !== pathOf(a) && p.contains(x))) break;
        c = p;
      }
      cards.add(c);
    }
    const good = [...cards].filter((c) => (c.matches('img, picture') || c.querySelector('img, picture')) && PRICE.test(c.textContent || '') && visible(c));
    if (good.length < 2) continue;
    good.forEach((c) => cardSet.add(c));
    cardsByBlock.set(block.getAttribute('data-secref')!, good);
  }
  const columnsOf = (rs: Rect[]) => {
    if (!rs.length) return 0;
    const top = Math.min(...rs.map((r) => r.top));
    return rs.filter((r) => Math.abs(r.top - top) < 10).length;
  };

  // ---- text runs (6.1, 6.2) -----------------------------------------------
  type PInfo = {
    baseRole: 'heading' | 'button' | 'link' | 'other';
    level: number;
    hEl: Element | null;
    family: string;
    size: number;
    weight: number;
    lh: number | null;
    ls: number;
    transform: string;
    colour: RGBA;
    bg: Bg;
    rect: Rect;
    block: string | null;
    lineThrough: boolean;
    align: string;
  };
  const pinfo = new Map<Element, PInfo | null>();
  function infoOf(el: Element): PInfo | null {
    const hit = pinfo.get(el);
    if (hit !== undefined) return hit;
    let res: PInfo | null = null;
    if (!el.closest('script, style, noscript, template, svg') && visible(el)) {
      const cs = getComputedStyle(el);
      const size = round(parseFloat(cs.fontSize) || 16, 0.5);
      const hEl = el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]');
      let isBtn = false;
      for (let e: Element | null = el; e && !isBtn; e = e.parentElement) isBtn = buttonSet.has(e);
      const lhPx = parseFloat(cs.lineHeight);
      const lsPx = parseFloat(cs.letterSpacing);
      res = {
        baseRole: hEl ? 'heading' : isBtn ? 'button' : el.closest('a') ? 'link' : 'other',
        level: hEl ? (/^H[1-6]$/.test(hEl.tagName) ? Number(hEl.tagName[1]) : Number(hEl.getAttribute('aria-level')) || 2) : 0,
        hEl,
        family: renderedFamily(cs.fontFamily),
        size,
        weight: Number(cs.fontWeight) || 400,
        lh: cs.lineHeight === 'normal' || !lhPx ? null : r2(lhPx / (parseFloat(cs.fontSize) || 16)),
        ls: cs.letterSpacing === 'normal' || !lsPx ? 0 : r2(lsPx / (parseFloat(cs.fontSize) || 16)),
        transform: cs.textTransform,
        colour: parse(cs.color) || [0, 0, 0, 1],
        bg: bgOf(el),
        rect: docRect(el),
        block: blockOf(el),
        lineThrough: /line-through/.test(cs.textDecorationLine) || !!el.closest('s, del, strike'),
        align: cs.textAlign,
      };
    }
    pinfo.set(el, res);
    return res;
  }
  // Text sitting on a picture (an <img> or <video> laid under it) has no measurable contrast.
  const overMedia = (r: Rect, el: Element) => {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const a = area(r);
    return media.some((m) => !el.contains(m.el) && m.rect.left <= cx && m.rect.right >= cx && m.rect.top <= cy && m.rect.bottom >= cy && area(m.rect) > a);
  };
  type Run = { chars: number; words: number; role: TextRoleC; level: number; hEl: Element | null; el: Element; family: string; size: number; weight: number; lh: number | null; ls: number; case: TextCaseC; colour: string; image: boolean; pass: boolean | null; contrast: number | null; block: string | null; top: number; text: string; bg: string };
  const runs: Run[] = [];
  {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let i = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((++i & 63) === 0 && over()) break;
      const text = clean(node.textContent || '');
      if (text.replace(/\s/g, '').length < T.minRunChars) continue;
      const el = node.parentElement;
      if (!el) continue;
      const p = infoOf(el);
      if (!p) continue;
      if (runs.length >= T.maxRuns) { partial = true; break; }
      const kase = caseOf(p.transform, text);
      let role: TextRoleC;
      if (p.baseRole === 'heading') role = `heading-${Math.min(6, Math.max(1, p.level))}` as TextRoleC;
      else if (p.baseRole === 'button') role = 'button';
      else if (isPrice(text, 30)) role = 'price';
      else if (p.baseRole === 'link') role = 'link';
      else if (p.size < T.labelMaxSize || (kase === 'uppercase' && p.ls > 0)) role = 'label';
      else role = 'body';
      const image = p.bg.image || overMedia(p.rect, el);
      const fg = blend(p.colour, p.bg.rgb);
      const ratio = image ? null : contrast(fg, p.bg.rgb);
      const large = p.size >= T.largeSize || (p.size >= T.largeBoldSize && p.weight >= 700);
      runs.push({
        chars: text.length, words: text.split(' ').filter(Boolean).length, role, level: p.level, hEl: p.hEl, el,
        family: p.family, size: p.size, weight: p.weight, lh: p.lh, ls: p.ls, case: kase, colour: hex(fg), image,
        pass: ratio === null ? null : ratio >= (large ? T.contrastLarge : T.contrastNormal), contrast: ratio,
        block: p.block, top: p.rect.top, text, bg: hex(p.bg.rgb),
      });
    }
  }
  const totalChars = runs.reduce((s, r) => s + r.chars, 0);
  const passShare = (rs: Run[]) => {
    const m = rs.filter((r) => r.pass !== null);
    const n = m.reduce((s, r) => s + r.chars, 0);
    return n ? r2(m.filter((r) => r.pass).reduce((s, r) => s + r.chars, 0) / n) : null;
  };

  // ---- outline (6.4) --------------------------------------------------------
  type INode = OutlineNodeC & { _r: Rect; _rs?: Rect[]; children?: INode[] };
  let visits = 0;
  const sig = (n: OutlineNodeC): string => n.type + (n.level ? n.level : '') + (n.children ? '(' + n.children.map(sig).join(',') + ')' : '');
  const shortText = (el: Element, max: number) => ((el.textContent || '').length <= max * 3 ? textOf(el) : null);

  function collapse(nodes: INode[]): INode[] {
    const out: INode[] = [];
    const keyOf = (n: INode) =>
      n.type === 'text' ? 'text' : n.type === 'product-card' ? 'pc' : n.type === 'image' ? 'img' + n.ratio : n.type === 'button' ? 'btn' + n.variant : n.type === 'badge' ? 'badge' : n.type === 'group' ? 'g' + sig(n) : n.type === 'icon-row' ? null : null;
    for (const n of nodes) {
      const prev = out[out.length - 1];
      const k = keyOf(n);
      if (prev && k && keyOf(prev) === k) {
        if (n.type === 'text') prev.words = (prev.words || 0) + (n.words || 0);
        else {
          prev.count = (prev.count || 1) + (n.count || 1);
          (prev._rs ||= [prev._r]).push(n._r);
        }
        prev._r = union([prev._r, n._r])!;
        continue;
      }
      out.push(n);
    }
    for (const n of out) if (n._rs && n._rs.length > 1) {
      const cols = columnsOf(n._rs);
      if (cols > 1) n.columns = Math.max(n.columns || 0, cols);
    }
    return out;
  }

  function combine(parts: INode[][]): INode[] {
    const ps = parts.filter((p) => p.length).map((nodes) => ({ nodes, rect: union(nodes.map((n) => n._r))! }));
    if (ps.length >= 2) {
      const a = ps[0].rect;
      const b = ps[1].rect;
      const sideBySide = b.left >= a.right - 4 && b.top < a.bottom - 4 && a.top < b.bottom - 4;
      if (sideBySide) {
        const cols: INode[] = ps.map((p): INode => (p.nodes.length === 1 ? p.nodes[0] : { type: 'group', children: p.nodes, _r: p.rect }));
        const types = new Set(cols.map((c) => c.type));
        // Side-by-side cards or images are a repeat, not a layout of columns.
        if (types.size === 1 && !types.has('group') && !types.has('text') && !types.has('heading')) return collapse(cols);
        const columns = Math.max(2, columnsOf(cols.map((c) => c._r)));
        const s = new Set(cols.map(sig));
        if (s.size === 1 && cols.length > 2) {
          const first = cols[0];
          return [{ type: 'group', columns, count: cols.length, children: first.type === 'group' ? first.children : [first], _r: union(cols.map((c) => c._r))! }];
        }
        return [{ type: 'group', columns, children: cols, _r: union(cols.map((c) => c._r))! }];
      }
    }
    return collapse(ps.flatMap((p) => p.nodes));
  }

  function walk(el: Element): INode[] {
    if (++visits > T.outlineMaxVisit) return [];
    if ((visits & 127) === 0 && over()) return [];
    if (SKIP.has(el.tagName)) return [];
    const br = el.getBoundingClientRect();
    if (br.width < 1 || br.height < 1) {
      if (getComputedStyle(el).display === 'contents') return combine(Array.from(el.children).map(walk));
      return [];
    }
    if (!visible(el)) return [];
    const _r = docRect(el);
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag) || el.getAttribute('role') === 'heading') {
      const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : Number(el.getAttribute('aria-level')) || 2;
      return [{ type: 'heading', level, text: textOf(el).slice(0, 80), _r }];
    }
    if (buttonSet.has(el)) return [{ type: 'button', text: clean(tag === 'INPUT' ? (el as HTMLInputElement).value : textOf(el)).slice(0, 40), variant: variantOf.has(el) ? variantOf.get(el)! : null, _r }];
    const st = shortText(el, 60);
    if (st !== null && isPrice(st, 40) && !el.querySelector('img, picture, video, button, h1, h2, h3, h4, h5, h6')) {
      const struck = Array.from(el.querySelectorAll('*')).concat(el).some((x) => /line-through/.test(getComputedStyle(x).textDecorationLine) || /^(S|DEL|STRIKE)$/.test(x.tagName));
      const sib = Array.from(el.parentElement?.children || []).some((x) => x !== el && (/^(S|DEL|STRIKE)$/.test(x.tagName) || /line-through/.test(getComputedStyle(x).textDecorationLine)) && PRICE.test(x.textContent || ''));
      return [{ type: 'price', compareAt: struck || sib, _r }];
    }
    {
      const aria = el.getAttribute('aria-label') || '';
      const am = aria.match(/([0-5](?:[.,]\d+)?)\s*(?:out of|\/|of)\s*5/i);
      const tm = st !== null && st.length <= 60 ? st.match(/\b([0-5][.,]\d)\b/) : null;
      const starish = st !== null && st.length <= 60 && (/review|rating|star|★|☆|avis|bewertung/i.test(st) || el.querySelectorAll('svg').length >= 3);
      if (am || (tm && starish)) {
        const v = am ? am[1] : tm![1];
        const cm = (st || '').match(/(\d[\d,.]*)\s*(?:reviews?|ratings?|avis|bewertungen)/i) || (st || '').match(/\((\d[\d,.]*)\)/);
        return [{ type: 'rating', rating: { value: Number(v.replace(',', '.')), count: cm ? Number(cm[1].replace(/[,.]/g, '')) : null }, _r }];
      }
    }
    if (tag === 'FORM') {
      const inputs = Array.from(el.querySelectorAll('input, select, textarea')).filter((i) => {
        const t = (i as HTMLInputElement).type;
        return !(i.tagName === 'INPUT' && /^(hidden|submit|button|image|reset)$/.test(t)) && visible(i);
      });
      if (inputs.length) return [{ type: 'form', fields: inputs.slice(0, 12).map((i) => (i.tagName === 'INPUT' ? (i as HTMLInputElement).type || 'text' : i.tagName.toLowerCase())), _r }];
    }
    if (cardSet.has(el)) return [{ type: 'product-card', _r }];
    {
      const kids = Array.from(el.children);
      const items = kids.filter((c) => c.tagName === 'DETAILS' || c.hasAttribute('aria-expanded') || !!c.querySelector(':scope > [aria-expanded], :scope > * > [aria-expanded]'));
      if (items.length >= 2 && items.length >= kids.length * 0.5 && !el.closest('nav, header')) return [{ type: 'accordion', count: items.length, _r }];
    }
    if (CAROUSEL.test(classOf(el)) || el.getAttribute('aria-roledescription') === 'carousel') {
      let slides = Array.from(el.querySelectorAll('[aria-roledescription="slide"]'));
      if (slides.length < 2) slides = Array.from(el.querySelectorAll('[class*="slide" i], [class*="carousel" i], .flickity-cell')).filter((s) => SLIDE.test(classOf(s)) && !/clone|duplicate/i.test(classOf(s))).slice(0, 200);
      // Slides nested in slides (a card carousel inside a hero slider) count once, at the outer level.
      slides = slides.filter((s) => !slides.some((o) => o !== s && o.contains(s)));
      if (slides.length >= 2) {
        const first = slides.find((s) => s.getBoundingClientRect().width > 1);
        const inner = first ? Array.from(first.children).flatMap(walk) : [];
        return [{ type: 'carousel', count: slides.length, ...(inner.length ? { children: collapse(inner) } : {}), _r }];
      }
    }
    if (tag === 'TABLE') {
      const t = el as HTMLTableElement;
      if (t.rows.length >= 2) return [{ type: 'table', rows: t.rows.length, columns: Math.max(...Array.from(t.rows).map((r) => r.cells.length)), _r }];
    }
    if (tag === 'PICTURE' || tag === 'IMG') {
      const img = (tag === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement | null;
      const m = img ? mediaOf.get(img) : null;
      if (br.width >= T.minImage && br.height >= T.minImage) return [{ type: 'image', ratio: m?.ratio || snap(br.width, br.height) || '1:1', alt: !!(img?.getAttribute('alt') || '').trim(), _r }];
      return [];
    }
    if (tag === 'VIDEO' || (tag === 'IFRAME' && VIDEO_SRC.test(el.getAttribute('src') || ''))) return br.width >= T.minImage ? [{ type: 'video', _r }] : [];
    {
      const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().width > 1).slice(0, 12);
      if (kids.length >= 3) {
        const iconish = kids.filter((k) => {
          const icons = Array.from(k.querySelectorAll('svg, img'));
          if (!icons.length || (k.textContent || '').length > T.iconRowMaxText * 3) return false;
          if (!icons.every((i) => { const r = i.getBoundingClientRect(); return r.width < T.iconMax && r.height < T.iconMax; })) return false;
          return textOf(k).length < T.iconRowMaxText;
        });
        if (iconish.length >= 3 && iconish.length >= kids.length * 0.75) return [{ type: 'icon-row', count: iconish.length, _r }];
      }
    }
    if (tag === 'NAV') {
      const links = Array.from(el.querySelectorAll('a[href]')).filter(visible);
      if (links.length >= 2) return [{ type: 'link-list', count: links.length, _r }];
    }
    if (tag === 'UL' || tag === 'OL') {
      const lis = Array.from(el.children).filter((c) => c.tagName === 'LI' && c.getBoundingClientRect().height > 1);
      const linky = lis.filter((li) => li.querySelector('a[href]') && (li.textContent || '').trim().length < 80);
      // A list of product cards links every item too; it is a grid, not a list of links.
      const cardy = lis.some((li) => cardSet.has(li) || [...cardSet].some((c) => li.contains(c)) || Array.from(li.querySelectorAll('img')).some((i) => i.getBoundingClientRect().width >= T.iconMax));
      if (lis.length >= 2 && linky.length >= lis.length * 0.7 && !cardy) return [{ type: 'link-list', count: lis.length, _r }];
    }
    {
      const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().height > 1);
      if (kids.length >= 3 && kids.every((k) => k.tagName === 'A' && !buttonSet.has(k) && (k.textContent || '').trim().length < 60)) return [{ type: 'link-list', count: kids.length, _r }];
    }
    if (st !== null && st.length >= 1 && st.length <= 24 && br.height <= 32 && br.width <= 160 && el.childElementCount <= 2) {
      const cs = getComputedStyle(el);
      const own = parse(cs.backgroundColor);
      const parentBg = bgOf(el.parentElement).rgb;
      const painted = own && own[3] > 0.5 && hex(blend(own, parentBg)) !== hex(parentBg);
      const bordered = (parseFloat(cs.borderTopWidth) || 0) >= 1 && cs.borderTopStyle !== 'none';
      if (painted || bordered) return [{ type: 'badge', _r }];
    }
    // Text: an element whose own text nodes say something. Inline children are part of it.
    const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent || '').trim()).map((n) => (n.textContent || '').trim()).join(' ');
    const blockKids = Array.from(el.children).filter((k) => !getComputedStyle(k).display.startsWith('inline'));
    if (direct && !blockKids.length) return [{ type: 'text', words: textOf(el).split(' ').filter(Boolean).length, _r }];
    const parts = Array.from(el.children).map(walk);
    if (direct) parts.unshift([{ type: 'text', words: direct.split(/\s+/).filter(Boolean).length, _r }]);
    return combine(parts);
  }

  function limitDepth(nodes: INode[], depth: number): INode[] {
    const leaves = (n: INode): INode[] => (n.type === 'group' && n.children ? n.children.flatMap(leaves) : [n]);
    const out: INode[] = [];
    for (const n of nodes) {
      if (!n.children) { out.push(n); continue; }
      if (depth >= T.outlineDepth) {
        if (n.type === 'group') out.push(...collapse(n.children.flatMap(leaves)).map((c) => { delete c.children; return c; }));
        else { delete n.children; out.push(n); }
      } else {
        n.children = limitDepth(n.children, depth + 1);
        out.push(n);
      }
    }
    return depth >= T.outlineDepth ? collapse(out) : out;
  }
  function prune(nodes: INode[], budget: number): void {
    // Breadth first: the top level survives, deep detail goes first.
    let left = budget;
    let level: INode[][] = [nodes];
    while (level.length) {
      const next: INode[][] = [];
      for (const arr of level) {
        if (arr.length > left) arr.length = Math.max(0, left);
        left -= arr.length;
        for (const n of arr) if (n.children) next.push(n.children);
      }
      level = next;
    }
    const strip = (ns: INode[]) => ns.forEach((n) => { if (n.children) { if (!n.children.length) delete n.children; else strip(n.children); } });
    strip(nodes);
  }
  const finish = (nodes: INode[]): OutlineNodeC[] =>
    nodes.map((n) => {
      const { _r, _rs, children, ...rest } = n;
      void _r; void _rs;
      return children && children.length ? { ...rest, children: finish(children) } : rest;
    });

  // ---- blocks: style (6.5) and outline ------------------------------------
  const blocks: StyleResult['blocks'] = {};
  const blockLayouts: BlockStyleC['layout'][] = [];
  const blockPads: number[] = [];
  const spacingValues: number[] = [];
  const cardRadii: number[] = [];
  const imageRadii: number[] = [];
  let anyShadow = buttons.some((b) => b.shadow);
  let accordions = 0;
  let carousels = 0;
  let gridBest: { products: number; columns: number } | null = null;
  const paintedArea: { colour: string; weight: number }[] = [];
  const borderColours: { colour: string; weight: number }[] = [];

  for (const block of blockEls) {
    const ref = block.getAttribute('data-secref')!;
    const rect = blockRect.get(ref)!;
    const bArea = Math.max(1, area(rect));
    const bruns = runs.filter((r) => r.block === ref);
    const bchars = bruns.reduce((s, r) => s + r.chars, 0);
    const cs = getComputedStyle(block);

    // Type: distinct styles by share.
    const styles = new Map<string, TextStyleC>();
    for (const r of bruns) {
      const k = [r.role, r.family, r.size, r.weight, r.lh, r.ls, r.case, r.colour].join('|');
      const s = styles.get(k);
      if (s) s.share += r.chars;
      else styles.set(k, { role: r.role, family: r.family, size: r.size, weight: r.weight, lineHeight: r.lh, letterSpacing: r.ls, case: r.case, colour: r.colour, share: r.chars });
    }
    const type = [...styles.values()].sort((a, b) => b.share - a.share).filter((s, i) => i === 0 || s.share / Math.max(1, bchars) >= T.minStyleShare).slice(0, T.maxTypeStyles).map((s) => ({ ...s, share: r2(s.share / Math.max(1, bchars)) }));
    const tc = new Map<string, number>();
    for (const r of bruns) tc.set(r.colour, (tc.get(r.colour) || 0) + r.chars);
    const textColours = [...tc].sort((a, b) => b[1] - a[1]).slice(0, T.maxTextColours).map(([colour, n]) => ({ colour, share: r2(n / Math.max(1, bchars)) }));

    // Background.
    const bmedia = media.filter((m) => m.block === ref);
    const own = bgOf(block);
    let background: BlockStyleC['background'];
    const bigVideo = bmedia.find((m) => m.kind === 'video' && clipArea(m.rect, rect) >= bArea * 0.5);
    const bigImage = bmedia.find((m) => m.kind === 'image' && clipArea(m.rect, rect) >= bArea * 0.6);
    const ownImage = cs.backgroundImage && cs.backgroundImage !== 'none' ? (/url\(/.test(cs.backgroundImage) ? 'image' : 'gradient') : null;
    if (ownImage === 'gradient') background = { kind: 'gradient', colour: null };
    else if (ownImage === 'image' || (!bigVideo && bigImage)) background = { kind: 'image', colour: null };
    else if (bigVideo) background = { kind: 'video', colour: null };
    else background = { kind: 'colour', colour: hex(own.rgb) };
    if (background.kind === 'colour') paintedArea.push({ colour: background.colour!, weight: bArea });

    // Buttons in the block: the accent is the block's primary button's background.
    const bbtns = buttons.filter((b) => b.block === ref);
    const pb = bbtns.find((b) => primaryCluster && primaryCluster.members.includes(b) && b.bg) || bbtns.find((b) => b.bg);
    const bw = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) || 0;
    const bcol = parse(cs.borderTopWidth && parseFloat(cs.borderTopWidth) ? cs.borderTopColor : cs.borderBottomColor);
    const border = bw >= 1 && bcol && bcol[3] > 0.1 ? hex(blend(bcol, own.rgb)) : null;
    if (border) borderColours.push({ colour: border, weight: 1 });

    // Content box: text, media, buttons.
    const contentRects = [...bruns.map((r) => infoOf(r.el)!.rect), ...bmedia.filter((m) => m !== bigImage && m !== bigVideo).map((m) => m.rect), ...bbtns.map((b) => docRect(b.el))]
      .map((r) => ({ top: Math.max(r.top, rect.top), left: Math.max(r.left, rect.left), bottom: Math.min(r.bottom, rect.bottom), right: Math.min(r.right, rect.right) }))
      .filter((r) => r.right > r.left && r.bottom > r.top);
    const content = union(contentRects) || rect;
    const contentWidth = Math.round(content.right - content.left);
    const full = rect.right - rect.left >= vw * T.fullWidthShare && (contentWidth >= vw * T.fullWidthShare || !!bigImage || !!bigVideo);
    let padTop = Math.round(parseFloat(cs.paddingTop) || 0);
    let padBottom = Math.round(parseFloat(cs.paddingBottom) || 0);
    if (padTop || padBottom) spacingValues.push(padTop, padBottom);
    if (!padTop && !padBottom) {
      padTop = Math.max(0, Math.round(content.top - rect.top));
      padBottom = Math.max(0, Math.round(rect.bottom - content.bottom));
    }
    blockPads.push((padTop + padBottom) / 2);

    // Main text alignment: the largest heading, else the most-used body text.
    const lead = [...bruns].filter((r) => r.role.startsWith('heading')).sort((a, b) => b.size - a.size)[0] || [...bruns].sort((a, b) => b.chars - a.chars)[0];
    const ta = lead ? infoOf(lead.el)!.align : 'left';
    const align: 'left' | 'center' | 'right' = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : 'left';

    // Media side: where the largest picture sits against the text.
    const biggest = [...bmedia].sort((a, b) => area(b.rect) - area(a.rect))[0];
    const textBox = union(bruns.filter((r) => !r.image).map((r) => infoOf(r.el)!.rect));
    let mediaSide: BlockStyleC['layout']['mediaSide'] = 'none';
    if (background.kind !== 'colour' || (biggest && bruns.some((r) => r.image))) mediaSide = 'background';
    else if (biggest && textBox) {
      const tcx = (textBox.left + textBox.right) / 2;
      if (biggest.rect.right <= tcx && biggest.rect.right <= textBox.left + 8) mediaSide = 'left';
      else if (biggest.rect.left >= tcx && biggest.rect.left >= textBox.right - 8) mediaSide = 'right';
      else mediaSide = 'top'; // stacked, image above or below the text
    } else if (biggest) mediaSide = 'top';

    // Shape.
    const radii = { button: median(bbtns.map((b) => b.radius)), image: null as number | null, card: null as number | null };
    const imgR: number[] = [];
    for (const m of bmedia) {
      if (m.rect.right - m.rect.left < T.radiusImage || m.rect.bottom - m.rect.top < T.radiusImage) continue;
      let r = 0;
      for (let e: Element | null = m.el, n = 0; e && n < 3 && !r; e = e.parentElement, n++) {
        const ecs = getComputedStyle(e);
        if (n === 0 || ecs.overflow !== 'visible') r = effRadius(ecs, e.getBoundingClientRect());
        if (ecs.boxShadow !== 'none') anyShadow = true;
      }
      imgR.push(r);
    }
    radii.image = median(imgR);
    imageRadii.push(...imgR);
    // Cards: around a picture, the first ancestor that holds text too and paints a box (background, border or shadow).
    const cardR: number[] = [];
    let blockShadow = cs.boxShadow !== 'none' || bbtns.some((b) => b.shadow);
    for (const m of bmedia.slice(0, 40)) {
      for (let e = m.el.parentElement, n = 0; e && e !== block && n < 4; e = e.parentElement, n++) {
        if (textOf(e).length < 3) continue;
        const ecs = getComputedStyle(e);
        const ebg = parse(ecs.backgroundColor);
        const paints = (ebg && ebg[3] > 0.5 && hex(blend(ebg, own.rgb)) !== hex(own.rgb)) || (parseFloat(ecs.borderTopWidth) || 0) >= 1 || ecs.boxShadow !== 'none';
        if (paints) {
          cardR.push(effRadius(ecs, e.getBoundingClientRect()));
          if (ecs.boxShadow !== 'none') blockShadow = true;
          if (ebg && ebg[3] > 0.5) paintedArea.push({ colour: hex(blend(ebg, own.rgb)), weight: area(docRect(e)) });
          const ebc = parse(ecs.borderTopColor);
          if ((parseFloat(ecs.borderTopWidth) || 0) >= 1 && ebc && ebc[3] > 0.1) borderColours.push({ colour: hex(blend(ebc, own.rgb)), weight: 1 });
        }
        break;
      }
    }
    radii.card = median(cardR);
    cardRadii.push(...cardR);
    if (blockShadow) anyShadow = true;

    // Imagery.
    const imagery = {
      count: bmedia.length,
      areaShare: r2(Math.min(1, bmedia.reduce((s, m) => s + clipArea(m.rect, rect), 0) / bArea)),
      ratio: mode(bmedia.filter((m) => m.kind === 'image').map((m) => m.ratio)),
    };

    // Commerce facts.
    const btext = textOf(block);
    const cards = cardsByBlock.get(ref) || [];
    const gridColumns = cards.length >= 2 ? columnsOf(cards.map(docRect)) : null;
    if (cards.length >= 2 && (!gridBest || cards.length > gridBest.products)) gridBest = { products: cards.length, columns: gridColumns || 1 };
    const rv = btext.match(/\b([0-5][.,]\d)\b(?=[^.]{0,40}(?:review|rating|star|★|out of))/i) || (() => {
      const a = Array.from(block.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') || '').find((s) => /out of\s*5/i.test(s));
      return a ? a.match(/([0-5](?:[.,]\d+)?)/) : null;
    })();
    const rc = btext.match(/(\d[\d,.]*)\s*(?:reviews?|ratings?|avis|bewertungen)\b/i);
    const payments = new Set<string>();
    for (const e of Array.from(block.querySelectorAll('img[alt], [title], [aria-label], svg title')).slice(0, 200)) {
      const s = e.tagName.toLowerCase() === 'title' ? e.textContent || '' : e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('aria-label') || '';
      const m = s.length < 40 ? s.match(PAYMENT) : null;
      if (m) payments.add(m[0].toLowerCase().replace(/\s/g, ''));
    }
    const discount = btext.match(/\b(?:save\s+)?\d{1,2}\s?%\s?off\b|\bsave\s+\d{1,2}\s?%/i);
    const freeShip = btext.match(/free\s+(?:standard\s+)?(?:shipping|delivery)[^.!\n]{0,40}?(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£]|kr|zł))/i);
    const commerce: BlockStyleC['commerce'] = {
      price: PRICE.test(btext),
      compareAt: bruns.some((r) => r.role === 'price' && infoOf(r.el)!.lineThrough) || Array.from(block.querySelectorAll('s, del, strike')).some((e) => PRICE.test(e.textContent || '')),
      discount: discount ? clean(discount[0]).slice(0, 40) : null,
      rating: rv || rc ? { value: rv ? Number(rv[1].replace(',', '.')) : null, count: rc ? Number(rc[1].replace(/[,.]/g, '')) : null } : null,
      freeShipping: freeShip ? clean(freeShip[0]).slice(0, 60) : null,
      // "Subscribe" alone is a newsletter sign-up, not a subscription offer.
      subscription: /subscribe\s*(?:&|and|\+)\s*save|subscription|deliver(?:ed|y)?\s+every|auto-?ship|auto-?renew/i.test(btext),
      urgency: /only \d+ left|low stock|selling fast|back in stock|almost gone|last chance/i.test(btext),
      paymentBadges: payments.size >= 2,
      products: cards.length,
      gridColumns,
    };

    // Outline, while time lasts.
    let outline: OutlineNodeC[] | undefined;
    let columns = 1;
    if (!over()) {
      visits = 0;
      let raw = walk(block);
      // A block that is one group (or one wrapper) reads better from inside it.
      if (raw.length === 1 && raw[0].type === 'group' && !raw[0].count && raw[0].children && raw[0].children.length === 1) raw = raw[0].children;
      const g = raw.find((n) => n.type === 'group') || raw.flatMap((n) => n.children || []).find((n) => n.type === 'group');
      if (g && g.columns) columns = g.columns;
      const countIn = (ns: INode[], t: string): number => ns.reduce((s, n) => s + (n.type === t ? 1 : 0) + countIn(n.children || [], t), 0);
      accordions += countIn(raw, 'accordion');
      carousels += countIn(raw, 'carousel');
      const limited = limitDepth(raw, 1);
      prune(limited, T.outlineMaxNodes);
      outline = finish(limited);
    }
    const layout = { columns, mediaSide, width: full ? 'full' as const : 'contained' as const, contentWidth, padTop, padBottom, align };
    blockLayouts.push(layout);
    blocks[ref] = {
      style: { type, background, textColours, accent: pb ? pb.bg : null, border, contrastPass: passShare(bruns), layout, radius: radii, shadows: blockShadow, imagery, commerce },
      ...(outline ? { outline } : {}),
    };
  }

  // ---- page: typography -------------------------------------------------------
  const famMap = new Map<string, { chars: number; heading: number; body: number; button: number }>();
  const roleChars = { heading: 0, body: 0, button: 0 };
  for (const r of runs) {
    const f = famMap.get(r.family) || { chars: 0, heading: 0, body: 0, button: 0 };
    f.chars += r.chars;
    const k = r.role.startsWith('heading') ? 'heading' : r.role === 'button' ? 'button' : 'body';
    f[k] += r.chars;
    roleChars[k] += r.chars;
    famMap.set(r.family, f);
  }
  const families = [...famMap]
    .sort((a, b) => b[1].chars - a[1].chars)
    .slice(0, 6)
    .map(([family, f]) => ({
      family,
      share: r2(f.chars / Math.max(1, totalChars)),
      roles: (['heading', 'body', 'button'] as const).filter((k) => roleChars[k] && f[k] / roleChars[k] >= 0.1),
    }));
  const sizeMap = new Map<number, number>();
  for (const r of runs) sizeMap.set(r.size, (sizeMap.get(r.size) || 0) + r.chars);
  const scale = [...sizeMap].sort((a, b) => a[0] - b[0]).map(([size, n]) => ({ size, share: Math.round((n / Math.max(1, totalChars)) * 1000) / 1000 }));
  const bodyRuns = runs.filter((r) => r.role === 'body');
  const bodySizeMap = new Map<number, number>();
  for (const r of bodyRuns) bodySizeMap.set(r.size, (bodySizeMap.get(r.size) || 0) + r.chars);
  const bodySize = [...bodySizeMap].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const lhMap = new Map<number, number>();
  for (const r of bodyRuns) if (r.size === bodySize && r.lh !== null) lhMap.set(r.lh, (lhMap.get(r.lh) || 0) + r.chars);
  const bodyLineHeight = [...lhMap].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const weights = [...new Set(runs.map((r) => r.weight))].sort((a, b) => a - b);
  const headRuns = runs.filter((r) => r.role.startsWith('heading'));
  const headChars = headRuns.reduce((s, r) => s + r.chars, 0);

  // ---- page: headings (6.3) ---------------------------------------------------
  type H = { el: Element; level: number; top: number; chars: number; size: number; weight: number; family: string; upper: boolean };
  const hs = new Map<Element, H & { best: number }>();
  for (const r of headRuns) {
    const h = hs.get(r.hEl!);
    if (!h) hs.set(r.hEl!, { el: r.hEl!, level: r.level, top: r.top, chars: r.chars, size: r.size, weight: r.weight, family: r.family, upper: r.case === 'uppercase', best: r.chars });
    else {
      h.chars += r.chars;
      h.top = Math.min(h.top, r.top);
      if (r.chars > h.best) Object.assign(h, { best: r.chars, size: r.size, weight: r.weight, family: r.family, upper: r.case === 'uppercase' });
    }
  }
  const heads = [...hs.values()].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const levels: HeadingLevelC[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => {
    const l = heads.filter((h) => h.level === level);
    return {
      level,
      count: l.length,
      size: median(l.map((h) => h.size)),
      weight: median(l.map((h) => h.weight)),
      family: mode(l.map((h) => h.family)),
      uppercaseShare: l.length ? r2(l.filter((h) => h.upper).length / l.length) : null,
      length: median(l.map((h) => h.chars)),
    };
  });
  let skips = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i].level > heads[i - 1].level + 1) skips++;
  const h1Count = levels[0].count;
  const styledEls = new Set<Element>();
  if (bodySize) for (const r of runs) if (!r.hEl && r.role !== 'button' && r.role !== 'price' && r.size >= bodySize * T.styledHeadingRatio && r.weight >= T.styledHeadingWeight && r.chars < T.styledHeadingMaxChars) styledEls.add(r.el);
  const present = levels.filter((l) => l.count && l.size);
  const headingRatios: number[] = [];
  for (let i = 0; i + 1 < present.length; i++) headingRatios.push(r2(present[i].size! / present[i + 1].size!));

  // ---- page: colour roles -----------------------------------------------------
  for (const b of buttons) if (b.bg) paintedArea.push({ colour: b.bg, weight: area(docRect(b.el)) });
  const inputs = Array.from(document.querySelectorAll('input, select, textarea')).filter((i) => {
    const t = (i as HTMLInputElement).type;
    return !(i.tagName === 'INPUT' && /^(hidden|submit|button|image|reset|checkbox|radio)$/.test(t));
  }).slice(0, T.maxElements).filter(visible);
  const inputRadii: number[] = [];
  for (const i of inputs) {
    const ics = getComputedStyle(i);
    inputRadii.push(effRadius(ics, i.getBoundingClientRect()));
    const ib = parse(ics.backgroundColor);
    const under = bgOf(i.parentElement).rgb;
    if (ib && ib[3] > 0.5) paintedArea.push({ colour: hex(blend(ib, under)), weight: area(docRect(i)) });
    const ibc = parse(ics.borderTopColor);
    if ((parseFloat(ics.borderTopWidth) || 0) >= 1 && ibc && ibc[3] > 0.1) borderColours.push({ colour: hex(blend(ibc, under)), weight: 1 });
    if (ics.boxShadow !== 'none') anyShadow = true;
  }
  for (const hr of Array.from(document.querySelectorAll('hr')).slice(0, 50)) {
    if (!visible(hr)) continue;
    const c = parse(getComputedStyle(hr).borderTopColor);
    if (c && c[3] > 0.1) borderColours.push({ colour: hex(blend(c, bgOf(hr.parentElement).rgb)), weight: 1 });
  }
  const painted = merge(paintedArea);
  const paintedTotal = painted.reduce((s, p) => s + p.weight, 0) || 1;
  const neutralsPainted = painted.filter((p) => neutral(p.colour));
  const palette: PageStylesC['colour']['palette'] = [];
  const background = neutralsPainted[0] || painted[0];
  if (background) palette.push({ role: 'background', colour: background.colour, share: r2(background.weight / paintedTotal) });
  const surface = neutralsPainted.find((p) => p !== background && p.weight / paintedTotal >= 0.02);
  if (surface) palette.push({ role: 'surface', colour: surface.colour, share: r2(surface.weight / paintedTotal) });
  const textCols = merge(runs.filter((r) => r.role !== 'button').map((r) => ({ colour: r.colour, weight: r.chars })));
  const textTotal = textCols.reduce((s, c) => s + c.weight, 0) || 1;
  const textMain = textCols[0];
  const bgRgb = background ? fromHex(background.colour) : ([255, 255, 255] as RGB);
  if (textMain) palette.push({ role: 'text', colour: textMain.colour, share: r2(textMain.weight / textTotal) });
  const muted = textMain && textCols.find((c) => c !== textMain && neutral(c.colour) && contrast(fromHex(c.colour), bgRgb) < contrast(fromHex(textMain.colour), bgRgb) && c.weight / textTotal >= 0.02);
  if (muted) palette.push({ role: 'text-muted', colour: muted.colour, share: r2(muted.weight / textTotal) });
  const accentBtns = merge(buttons.filter((b) => b.bg && !neutral(b.bg)).map((b) => ({ colour: b.bg!, weight: 1 })));
  const linkCols = merge(runs.filter((r) => r.role === 'link').map((r) => ({ colour: r.colour, weight: r.chars })));
  const linkTotal = linkCols.reduce((s, c) => s + c.weight, 0) || 1;
  let accent: string | null = null;
  if (accentBtns[0]) {
    accent = accentBtns[0].colour;
    palette.push({ role: 'accent', colour: accent, share: r2(accentBtns[0].weight / Math.max(1, buttons.length)) });
    const onAccent = merge(buttons.filter((b) => b.bg && deltaE(b.bg, accent!) < T.mergeDeltaE).map((b) => ({ colour: b.text, weight: 1 })))[0];
    if (onAccent) palette.push({ role: 'accent-text', colour: onAccent.colour, share: r2(onAccent.weight / Math.max(1, accentBtns[0].weight)) });
  } else {
    const l = linkCols.find((c) => !neutral(c.colour));
    if (l) { accent = l.colour; palette.push({ role: 'accent', colour: l.colour, share: r2(l.weight / linkTotal) }); }
  }
  const borders = merge(borderColours);
  if (borders[0]) palette.push({ role: 'border', colour: borders[0].colour, share: r2(borders[0].weight / borders.reduce((s, b) => s + b.weight, 0)) });
  if (linkCols[0]) palette.push({ role: 'link', colour: linkCols[0].colour, share: r2(linkCols[0].weight / linkTotal) });
  const hueSet = new Set<number>();
  for (const c of textCols) if (!neutral(c.colour) && c.weight / textTotal >= 0.01) hueSet.add(hueBin(c.colour));
  for (const c of painted) if (!neutral(c.colour) && c.weight / paintedTotal >= 0.01) hueSet.add(hueBin(c.colour));
  for (const c of accentBtns) hueSet.add(hueBin(c.colour));

  // ---- page: shape and spacing ---------------------------------------------
  const btnRadius = median(buttons.map((b) => b.radius));
  const btnHeight = median(buttons.map((b) => b.height));
  const cardRadius = median(cardRadii);
  const labelFor = (r: number | null, h: number | null): PageStylesC['shape']['label'] => {
    if (r === null) return null;
    if (h && r >= h / 2 - 1) return 'pill';
    return r <= 2 ? 'sharp' : r <= 8 ? 'soft' : r <= 20 ? 'rounded' : 'pill';
  };
  const contained = blockLayouts.filter((l) => l.width === 'contained').map((l) => l.contentWidth);
  const gutters: number[] = [];
  for (const block of blockEls) {
    const ref = block.getAttribute('data-secref')!;
    const rs = runs.filter((r) => r.block === ref).map((r) => infoOf(r.el)!.rect);
    const u = union(rs);
    if (u) gutters.push(Math.max(0, Math.min(u.left, vw - u.right)));
  }
  for (const b of buttons) if (b.paddingX) spacingValues.push(b.paddingX);
  let baseUnit: 4 | 8 | null = null;
  const sv = spacingValues.filter((v) => v > 0);
  if (sv.length >= 6) {
    const on = (u: number) => sv.filter((v) => Math.abs(v / u - Math.round(v / u)) * u <= 0.5).length / sv.length;
    baseUnit = on(8) >= 0.7 ? 8 : on(4) >= 0.7 ? 4 : null;
  }

  // ---- page: components and accessibility ----------------------------------
  const forms = Array.from(document.querySelectorAll('form')).filter((f) => visible(f) && inputs.some((i) => f.contains(i))).length;
  let sticky = 0;
  for (const el of Array.from(document.querySelectorAll('body > *, body > * > *, body > * > * > *, header')).slice(0, T.maxElements)) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.height >= 30 && r.width >= vw * 0.5 && visible(el)) sticky++;
  }
  const imgs = media.filter((m) => m.kind === 'image');
  const labelled = inputs.filter((i) => ((i as HTMLInputElement).labels?.length || 0) > 0 || i.hasAttribute('aria-label') || i.hasAttribute('aria-labelledby') || i.hasAttribute('title')).length;
  let tapTargets: number | null = null;
  if (arg.viewport === 'mobile') {
    const targets = Array.from(document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]'))
      .filter((e) => !e.closest('p'))
      .slice(0, T.maxElements)
      .filter(visible);
    tapTargets = targets.length ? r2(targets.filter((e) => e.getBoundingClientRect().height >= T.tapTarget).length / targets.length) : null;
  }
  const words = runs.reduce((s, r) => s + r.words, 0);
  const contrastPass = passShare(runs);
  const labelCounts = new Map<string, number>();
  for (const b of buttons) labelCounts.set(b.label, (labelCounts.get(b.label) || 0) + 1);

  const page: PageStylesC = {
    version: 1,
    partial,
    ms: 0,
    chars: totalChars,
    typography: {
      families,
      scale,
      bodySize,
      bodyLineHeight,
      headingRatios,
      weights,
      headingUppercaseShare: headChars ? r2(headRuns.filter((r) => r.case === 'uppercase').reduce((s, r) => s + r.chars, 0) / headChars) : null,
    },
    headings: { levels, h1Count, skips, styledNotMarked: styledEls.size, share: r2(headChars / Math.max(1, totalChars)), perScreen: r2(heads.length / screens) },
    colour: { palette, hues: hueSet.size, contrastPass },
    buttons: { variants, primary: primary !== null && primary >= 0 ? primary : null, labels: [...labelCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l) },
    shape: {
      radius: { button: btnRadius, image: median(imageRadii), card: cardRadius, input: median(inputRadii) },
      label: btnRadius !== null ? labelFor(btnRadius, btnHeight) : labelFor(cardRadius, null),
      shadows: anyShadow,
    },
    spacing: {
      contentWidth: contained.length ? Math.round(median(contained)!) : blockLayouts.length ? vw : null,
      gutter: gutters.length ? Math.round(median(gutters)!) : null,
      blockPadding: blockPads.length ? Math.round(median(blockPads)!) : null,
      baseUnit,
    },
    layout: {
      screens: Math.round(screens * 10) / 10,
      blocks: blockEls.length,
      wordsPerScreen: Math.round(words / screens),
      imagesPerScreen: r2(imgs.length / screens),
      imageryShare: r2(Math.min(1, media.reduce((s, m) => s + area(m.rect), 0) / (docH * vw))),
      gridColumns: gridBest ? (gridBest as { columns: number }).columns : null,
    },
    components: {
      forms,
      inputs: inputs.length,
      accordions,
      carousels,
      tabs: Array.from(document.querySelectorAll('[role="tablist"]')).filter(visible).length,
      tables: Array.from(document.querySelectorAll('table')).filter((t) => (t as HTMLTableElement).rows.length >= 2 && visible(t)).length,
      videos: media.filter((m) => m.kind === 'video').length,
      sticky,
    },
    accessibility: {
      altShare: imgs.length ? r2(imgs.filter((m) => m.altAttr).length / imgs.length) : null,
      headingOrderValid: skips === 0 && h1Count >= 1,
      contrastPass,
      lang: !!(document.documentElement.getAttribute('lang') || '').trim(),
      labelledInputs: inputs.length ? r2(labelled / inputs.length) : null,
      tapTargets,
    },
  };
  page.ms = Math.round(performance.now() - t0);
  return { page, blocks };
}
