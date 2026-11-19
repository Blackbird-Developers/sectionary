// Functions in this file run INSIDE the captured page (Playwright serialises them with page.evaluate), like
// clip-script.ts: self-contained, no imports, no closures over anything outside the function body.
// Stage 2 (Ben, 18 Nov 2026): product pages. They find a product's photo thumbnails, its option pickers (size,
// colour) and its size guide, and mark what clips.ts may press. They press nothing themselves.
// Shared rules: never a link to another page, never a submit button (a bare <button> in a form submits it),
// never a disabled or sold-out choice.

export type Box = { x: number; y: number; width: number; height: number };

/** The block (data-secref) holding the product form or, failing that, the add-to-cart button. */
export function productBlock(): { ref: string } | null {
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const form = Array.from(document.querySelectorAll('form[action*="/cart/add"]')).find(visible);
  let anchor: Element | null | undefined = form;
  if (!anchor) {
    anchor = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(
      (b) => visible(b) && /^(add to (cart|bag|basket)|add)$/i.test(((b as HTMLElement).innerText || (b as HTMLInputElement).value || '').trim()),
    );
  }
  const block = anchor?.closest('[data-secref]');
  return block ? { ref: block.getAttribute('data-secref') || '' } : null;
}

export type GalleryPlan = { ok: boolean; thumbs: number; why: string };

/**
 * A photo gallery driven by thumbnails, in block `ref`: a group of at least two small pictures you can click
 * (buttons, list items, [data-media-id]...), with different images, none of them a link to another page.
 * Marks the 2nd, 3rd and 4th with data-secthumb (1, 2, 3), the main picture with data-sectrack (where a click
 * must change something), and the gallery with data-secslider (centred while recording).
 */
export function findGallery(ref: string): GalleryPlan {
  const el = document.querySelector(`[data-secref="${ref}"]`);
  if (!el) return { ok: false, thumbs: 0, why: 'no-block' };
  // Marks the slider step may have left on this block are cleared first.
  for (const m of [el, ...Array.from(el.querySelectorAll('[data-secslider], [data-sectrack], [data-secthumb]'))]) {
    m.removeAttribute('data-secslider');
    m.removeAttribute('data-sectrack');
    m.removeAttribute('data-secthumb');
  }
  const shown = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const leaves = (e: Element) => {
    const a = e.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h));
  };
  const submits = (e: Element) => {
    const b = e.closest('button');
    return !!b && !!b.closest('form') && (b.getAttribute('type') || 'submit').toLowerCase() === 'submit';
  };
  const picOf = (e: Element) => {
    const img = e.querySelector('img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return r.width >= 24 && r.width <= 220 && r.height >= 24 && r.height <= 260 ? img : null;
  };
  // A list item wrapping a link to another page is that link: pressing its middle follows it.
  const holdsLink = (e: Element) =>
    Array.from(e.querySelectorAll('a[href]')).some((a) => {
      const h = (a.getAttribute('href') || '').trim();
      return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h));
    });
  const CLICKABLE = 'button, a, li, [role="button"], [role="tab"], [role="option"], [data-media-id], [data-image-id], [class*="thumb" i]';
  const groups = new Map<Element, Element[]>();
  for (const c of Array.from(el.querySelectorAll(CLICKABLE))) {
    if (!shown(c) || leaves(c) || holdsLink(c) || submits(c) || !picOf(c) || !c.parentElement) continue;
    const g = groups.get(c.parentElement) || [];
    if (!g.some((x) => x.contains(c) || c.contains(x))) g.push(c);
    groups.set(c.parentElement, g);
  }
  let thumbs: Element[] = [];
  for (const g of Array.from(groups.values())) {
    const srcs = new Set(g.map((t) => (picOf(t) as HTMLImageElement).currentSrc || (picOf(t) as HTMLImageElement).src));
    if (g.length >= 2 && srcs.size >= 2 && g.length > thumbs.length) thumbs = g;
  }
  if (thumbs.length < 2) return { ok: false, thumbs: 0, why: 'no-thumbnails' };
  // The main picture: the biggest picture in the block that is not one of the thumbnails.
  let main: Element | null = null;
  let area = 0;
  for (const img of Array.from(el.querySelectorAll('img'))) {
    if (thumbs.some((t) => t.contains(img))) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height > area && shown(img)) {
      main = img;
      area = r.width * r.height;
    }
  }
  if (!main || area < 150 * 150) return { ok: false, thumbs: 0, why: 'no-main-picture' };
  // The gallery: the smallest element holding both the main picture and the thumbnails.
  let gallery: Element | null = main.parentElement;
  while (gallery && gallery !== el && !thumbs.every((t) => gallery!.contains(t))) gallery = gallery.parentElement;
  (gallery || el).setAttribute('data-secslider', '1');
  (main.closest('picture, figure, [class*="media" i], [class*="image" i]') || main).setAttribute('data-sectrack', '1');
  thumbs.slice(1, 4).forEach((t, i) => t.setAttribute('data-secthumb', String(i + 1)));
  return { ok: true, thumbs: thumbs.length, why: `${thumbs.length} thumbnails` };
}

/**
 * Centres the gallery findGallery marked (data-secslider) and returns the block's on-screen part, with `focus` =
 * the main picture (data-sectrack) cut to the viewport, in the shape clips.ts records with.
 */
export function placeMarked(arg: { ref: string; scroll: boolean }): {
  ok: boolean; rect: Box; block: Box; focus: Box; vw: number; vh: number;
} {
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  const el = document.querySelector(`[data-secref="${arg.ref}"]`);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el) return { ok: false, rect: empty, block: empty, focus: empty, vw, vh };
  const cut = (b: DOMRect): Box => {
    const x0 = Math.max(0, b.left);
    const y0 = Math.max(0, b.top);
    return { x: x0, y: y0, width: Math.max(0, Math.min(vw, b.right) - x0), height: Math.max(0, Math.min(vh, b.bottom) - y0) };
  };
  const target = el.matches('[data-secslider]') ? el : el.querySelector('[data-secslider]') || el;
  if (arg.scroll) {
    const r0 = target.getBoundingClientRect();
    const absTop = r0.top + window.scrollY;
    window.scrollTo({ top: Math.max(0, r0.height < vh ? absTop - (vh - r0.height) / 2 : absTop), left: 0, behavior: 'instant' as ScrollBehavior });
  }
  const r = el.getBoundingClientRect();
  const rect = cut(r);
  const t = el.querySelector('[data-sectrack]');
  return { ok: rect.width > 1 && rect.height > 1, rect, block: { x: r.left, y: r.top, width: r.width, height: r.height }, focus: t ? cut(t.getBoundingClientRect()) : rect, vw, vh };
}

export type OptionsPlan = {
  ok: boolean;
  /** radio = labels of radio inputs; select = a drop-down; swatch = buttons. */
  how: 'radio' | 'select' | 'swatch' | 'none';
  /** How many choices will be made (1 or 2). */
  choices: number;
  /** select only: the values to pick, in order, then the original to put back. */
  values: string[];
  original: string | null;
  group: string;
  why: string;
};

/**
 * The first option group of the product (size, colour...) with at least one other choice available: radio
 * inputs with labels, a visible drop-down, or a row of swatch buttons. Marks up to two choices other than the
 * current one with data-secopt (1, 2), the current one with data-secopt-orig, and the area to show (the group
 * plus the price) with data-secoptions on the smallest element holding both.
 */
export function findOptions(): OptionsPlan {
  const none: OptionsPlan = { ok: false, how: 'none', choices: 0, values: [], original: null, group: '', why: '' };
  const shown = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const OFF = /(^|[\s_-])(sold-?out|unavailable|disabled|is-disabled|out-of-stock|soldout)([\s_-]|$)/i;
  const off = (e: Element) => e.matches(':disabled, [aria-disabled="true"]') || OFF.test(e.getAttribute('class') || '') || OFF.test((e as HTMLElement).dataset?.state || '');
  const leaves = (e: Element) => {
    const a = e.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h));
  };
  const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]')).filter(shown);
  const pb = document.querySelector('[data-secref] form[action*="/cart/add"]')?.closest('[data-secref]');
  const scope: Element = forms[0]?.closest('[data-secref]') || pb || document.querySelector('main') || document.body;
  const label = (e: Element) => ((e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.getAttribute('value') || '') as string).replace(/\s+/g, ' ').trim().slice(0, 40);
  const groupName = (e: Element) => {
    const fs = e.closest('fieldset');
    const lg = fs?.querySelector('legend');
    return ((lg?.textContent || e.getAttribute('aria-label') || e.getAttribute('name') || '') as string).replace(/\s+/g, ' ').trim().slice(0, 40);
  };
  // Every option group is marked data-secoptgroup (the area shown is all of them together: size, colour, style),
  // and the one whose choices are made gets data-secopt / data-secopt-orig. The smallest element holding all the
  // groups is data-secoptions (its words describe the new block).
  const groupsSeen: Element[] = [];
  const markGroup = (g: Element) => {
    if (!groupsSeen.some((x) => x.contains(g) || g.contains(x))) groupsSeen.push(g);
  };
  const mark = (groupBox: Element, targets: Element[], orig: Element | null) => {
    targets.slice(0, 2).forEach((t, i) => t.setAttribute('data-secopt', String(i + 1)));
    if (orig) orig.setAttribute('data-secopt-orig', '1');
    markGroup(groupBox);
  };
  const finish = () => {
    for (const g of groupsSeen) g.setAttribute('data-secoptgroup', '1');
    let common: Element | null = groupsSeen[0] || null;
    while (common && !groupsSeen.every((g) => common!.contains(g))) common = common.parentElement;
    (common || groupsSeen[0])?.setAttribute('data-secoptions', '1');
  };
  // Swatches: never a slider arrow, a close, menu or quantity control, and only in the product form or in an area
  // named for variants and options (kotn.com, 18 Nov 2026: a slider's two arrow buttons passed for a swatch row).
  const NOT_OPTION = /\b(prev(ious)?|next|arrow|chevron|slide|close|menu|search|cart|bag|wishlist|share|zoom|play|pause|quantity|qty|increase|decrease|minus|plus)\b|[‹›«»←→+−]/i;
  const OPTION_AREA = /variant|option|swatch|picker|selector|size|colou?r|style|fit|length|width|flavou?r/i;
  const inOptionArea = (e: Element) => {
    if (e.closest('form[action*="/cart/add"]')) return true;
    for (let p: Element | null = e.parentElement; p && p !== scope.parentElement; p = p.parentElement) {
      if (OPTION_AREA.test((p.getAttribute('class') || '') + ' ' + (p.getAttribute('id') || '') + ' ' + (p.getAttribute('aria-label') || ''))) return true;
    }
    return false;
  };

  // The group whose choices are made: the first one found with another choice available.
  let active: OptionsPlan | null = null;

  // 1. Radio inputs with labels, grouped by name.
  const radios = new Map<string, HTMLInputElement[]>();
  for (const r of Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
    if (!r.name || r.name === 'id' || leaves(r)) continue;
    radios.set(r.name, [...(radios.get(r.name) || []), r]);
  }
  // A group of radio inputs is a product option only in the product form or an area named for options, and never
  // an accordion, tabs or filters built from radios (athleticpropulsionlabs.com's "Quick Facts", 18 Nov 2026).
  const NOT_OPTION_GROUP = /accordion|\btabs?\b|faq|collaps|toggle|drawer|menu|filter|sort|slide|review|rating|stars?\b/i;
  const ordered = Array.from(radios.entries()).sort((a, b) => Number(!!b[1][0].closest('form[action*="/cart/add"]')) - Number(!!a[1][0].closest('form[action*="/cart/add"]')));
  for (const [name, inputs] of ordered) {
    const clickable = (i: HTMLInputElement) => (i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null) || i.closest('label') || (shown(i) ? i : null);
    const items = inputs.map((i) => ({ i, c: clickable(i) })).filter((x) => x.c && shown(x.c));
    if (items.length < 2) continue;
    const box = items[0].i.closest('fieldset, [role="radiogroup"]') || (items[0].c as Element).parentElement || scope;
    const named = name + ' ' + (box.getAttribute('class') || '') + ' ' + (box.getAttribute('id') || '');
    if (NOT_OPTION_GROUP.test(named) || (!inOptionArea(items[0].i) && !OPTION_AREA.test(named))) continue;
    const orig = items.find((x) => x.i.checked) || null;
    const targets = items.filter((x) => x !== orig && !x.i.disabled && !off(x.i) && !off(x.c as Element)).map((x) => x.c as Element);
    if (active || !targets.length) {
      markGroup(box);
      continue;
    }
    mark(box, targets, orig ? (orig.c as Element) : null);
    active = { ok: true, how: 'radio', choices: Math.min(2, targets.length), values: [], original: null, group: groupName(items[0].i) || name, why: `${items.length} choices` };
  }

  // 2. A visible drop-down (not Shopify's hidden variant list, name="id").
  for (const s of Array.from(scope.querySelectorAll<HTMLSelectElement>('select'))) {
    if (s.name === 'id' || !shown(s) || s.disabled || leaves(s)) continue;
    const opts = Array.from(s.options).filter((o) => !o.disabled && o.value && !OFF.test(o.textContent || ''));
    const others = opts.filter((o) => o.value !== s.value);
    if (opts.length < 2) continue;
    const box = s.closest('fieldset, div') || s;
    if (active || !others.length) {
      markGroup(box);
      continue;
    }
    s.setAttribute('data-secopt-select', '1');
    mark(box, [], null);
    active = { ok: true, how: 'select', choices: Math.min(2, others.length), values: others.slice(0, 2).map((o) => o.value), original: s.value, group: groupName(s), why: `${opts.length} choices` };
  }

  // 3. Swatch buttons: a row of at least two. A bare <button> inside a form would submit it, so only
  // type="button" or role radio/option counts, and never one that is a link to another page.
  const SWATCH = 'button[type="button"], [role="radio"], [role="option"], [class*="swatch" i], [data-option-value], [data-value]';
  const rows = new Map<Element, Element[]>();
  for (const b of Array.from(scope.querySelectorAll(SWATCH))) {
    if (!shown(b) || leaves(b) || !b.parentElement || !inOptionArea(b)) continue;
    if (b.tagName === 'BUTTON' && (b.getAttribute('type') || 'submit').toLowerCase() === 'submit') continue;
    const words = label(b);
    if (/add to|buy|checkout|subscribe|notify/i.test(words) || NOT_OPTION.test(words + ' ' + (b.getAttribute('class') || ''))) continue;
    if (((b as HTMLElement).innerText || '').trim().length > 24) continue;
    const r = b.getBoundingClientRect();
    if (r.width > 260 || r.height > 120) continue;
    const g = rows.get(b.parentElement) || [];
    if (!g.some((x) => x.contains(b) || b.contains(x))) g.push(b);
    rows.set(b.parentElement, g);
  }
  for (const [parent, g] of Array.from(rows.entries())) {
    if (g.length < 2) continue;
    const isOn = (b: Element) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || /(^|\s)(active|selected|is-selected|is-active|checked)(\s|$)/i.test(b.getAttribute('class') || '');
    const orig = g.find(isOn) || null;
    const targets = g.filter((b) => b !== orig && !off(b));
    if (active || !targets.length) {
      markGroup(parent);
      continue;
    }
    mark(parent, targets, orig);
    active = { ok: true, how: 'swatch', choices: Math.min(2, targets.length), values: [], original: null, group: groupName(parent) || label(parent), why: `${g.length} swatches` };
  }
  if (!active) return { ...none, why: 'no-options' };
  finish();
  return active;
}

/**
 * The options area: every marked option group together (size, colour, style), plus 12 px. Not the whole product
 * column (apl, outway, tinycottons, 18 Nov 2026: titles, descriptions and accordions came along): when all the
 * groups are taller than 60% of the screen, only the group whose choices are made. At least 320 px wide. The
 * area is centred on screen and returned cut to the viewport, with its top in page coordinates.
 */
export function placeOptions(): { ok: boolean; box: Box; top: number } {
  const empty = { ok: false, box: { x: 0, y: 0, width: 0, height: 0 }, top: 0 };
  const groups = Array.from(document.querySelectorAll('[data-secoptgroup]'));
  if (!groups.length) return empty;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const union = (els: Element[]) => {
    const u = { t: Infinity, l: Infinity, b: -Infinity, r: -Infinity };
    for (const e of els) {
      const x = e.getBoundingClientRect();
      if (!x.width || !x.height) continue;
      u.t = Math.min(u.t, x.top + window.scrollY);
      u.b = Math.max(u.b, x.bottom + window.scrollY);
      u.l = Math.min(u.l, x.left);
      u.r = Math.max(u.r, x.right);
    }
    return u;
  };
  let u = union(groups);
  if (u.b - u.t > vh * 0.6) {
    const act = groups.find((g) => g.matches('[data-secopt-select]') || g.querySelector('[data-secopt], [data-secopt-select]')) || groups[0];
    u = union([act]);
  }
  if (!Number.isFinite(u.t)) return empty;
  const minW = Math.min(320, vw - 16);
  if (u.r - u.l < minW) {
    const c = (u.l + u.r) / 2;
    u.l = Math.max(0, c - minW / 2);
    u.r = Math.min(vw, u.l + minW);
  }
  const h = u.b - u.t;
  window.scrollTo({ top: Math.max(0, h < vh ? u.t - (vh - h) / 2 : u.t - 40), left: 0, behavior: 'instant' as ScrollBehavior });
  const x0 = Math.max(0, u.l - 12);
  const y0 = Math.max(0, u.t - window.scrollY - 12);
  const box = { x: x0, y: y0, width: Math.min(vw, u.r + 12) - x0, height: Math.min(vh, u.b - window.scrollY + 12) - y0 };
  return { ok: box.width > 40 && box.height > 30, box, top: Math.round(y0 + window.scrollY) };
}

/**
 * The panel a size guide press opened, measured now (it may have still been sliding in when first seen), cut to
 * the viewport, and whether it reads like a size guide: size words or a table or picture inside (spanx.com,
 * 18 Nov 2026: a blank panel was taken).
 */
export function sizePanel(key: string): { ok: boolean; box: Box; why: string } {
  const el = document.querySelector(`[data-secmoment="${key}"]`) as HTMLElement | null;
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  if (!el) return { ok: false, box: empty, why: 'panel-gone' };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  const x0 = Math.max(0, r.left);
  const y0 = Math.max(0, r.top);
  const box = { x: x0, y: y0, width: Math.max(0, Math.min(vw, r.right) - x0), height: Math.max(0, Math.min(vh, r.bottom) - y0) };
  if (box.width * box.height < vw * vh * 0.06) return { ok: false, box, why: 'panel-too-small' };
  // Real content: size words in at least a sentence of text, or a table with rows, or a picture of a decent
  // size (a size chart image). Small icons do not count (spanx.com: a blank panel with an icon passed).
  const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
  const SIZE_WORDS = /\b(size|sizing|chart|measure|measurements?|cm|inch(es)?|bust|waist|hips?|chest|length|inseam|XS|XL|EU|UK|US)\b/i;
  const table = Array.from(el.querySelectorAll('table')).some((t) => t.rows.length >= 2 && t.getBoundingClientRect().height > 40);
  const picture = Array.from(el.querySelectorAll('img')).some((i) => {
    const b = i.getBoundingClientRect();
    return b.width >= 120 && b.height >= 120 && i.complete && i.naturalWidth > 0;
  });
  if (!(text.length >= 30 && SIZE_WORDS.test(text)) && !table && !picture) return { ok: false, box, why: 'not-a-size-guide' };
  return { ok: true, box, why: '' };
}

/** Block fields for the marked options area, by the rules collectBlocks uses; tags it with data-secref. */
export function describeOptions(ref: string): { tag: string; id: string | null; classes: string | null; text: string; textLength: number; headline: string | null; buttons: number; images: number; videos: number; bg: string } | null {
  const el = document.querySelector('[data-secoptions]') as HTMLElement | null;
  if (!el) return null;
  el.setAttribute('data-secref', ref);
  const text = ((el.innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
  const transparent = (c: string) => c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
  let bg = getComputedStyle(el).backgroundColor;
  for (let p: HTMLElement | null = el.parentElement; transparent(bg) && p; p = p.parentElement) bg = getComputedStyle(p).backgroundColor;
  if (transparent(bg)) bg = getComputedStyle(document.body).backgroundColor;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute('id') || null,
    classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().slice(0, 200) : null,
    text: text.slice(0, 2000),
    textLength: text.length,
    headline: null,
    buttons: el.querySelectorAll('button, [role="radio"], [role="option"], label').length,
    images: el.querySelectorAll('img, picture').length,
    videos: 0,
    bg,
  };
}

/**
 * The product's size guide control: a button or in-page link whose words say size guide or size chart. Not a
 * link to another page, not one that opens a new tab, not a submit button. Prefers one inside the product
 * block. Marks it data-secsize.
 */
export function findSizeGuide(ref: string | null): { ok: boolean; label: string; why: string } {
  const SIZE = /\b(size|sizing)\s*(guide|chart|help|&\s*fit)\b|\bfind\s+(your|my)\s+(size|fit)\b|\bfit\s+guide\b/i;
  const shown = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width >= 8 && r.height >= 8 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const scope = (ref && document.querySelector(`[data-secref="${ref}"]`)) || document.querySelector('main') || document.body;
  const CAND = 'button, a, summary, [role="button"], [aria-controls], [data-modal], [data-popup], [data-drawer], span[onclick], div[onclick]';
  for (const e of Array.from(scope.querySelectorAll(CAND))) {
    const words = ((e.getAttribute('aria-label') || '') + ' ' + ((e as HTMLElement).innerText || '')).replace(/\s+/g, ' ').trim();
    if (!SIZE.test(words) || words.length > 60 || !shown(e)) continue;
    if (e.matches('a[target="_blank"]')) continue;
    const a = e.closest('a[href]');
    if (a) {
      const h = (a.getAttribute('href') || '').trim();
      if (!(h === '' || h.startsWith('#') || /^javascript:/i.test(h))) continue;
    }
    const b = e.closest('button');
    if (b && b.closest('form') && (b.getAttribute('type') || 'submit').toLowerCase() === 'submit') continue;
    e.setAttribute('data-secsize', '1');
    return { ok: true, label: words.slice(0, 40), why: e.tagName.toLowerCase() };
  }
  return { ok: false, label: '', why: 'no-size-guide' };
}

/** The close button inside the panel with this data-secmoment key, marked data-secclose. */
export function markPanelClose(key: string): boolean {
  const panel = document.querySelector(`[data-secmoment="${key}"]`);
  if (!panel) return false;
  const c = panel.querySelector('[aria-label*="close" i], [class*="close" i], [data-close], button[title*="close" i]');
  if (!c) return false;
  c.setAttribute('data-secclose', '1');
  return true;
}
