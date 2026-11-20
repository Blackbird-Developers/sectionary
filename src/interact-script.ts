// Stage 4 (Ben, 20 Nov 2026): what the interaction step presses or hovers, found and marked inside the page
// (src/interact-clips.ts records it). Every function here runs in the page through page.evaluate, so each one is
// self-contained: no imports, no helpers shared between them. Marks:
//   data-secint-go="<ref>-<kind>"   the toggle or button found for a section, and data-secint-mode = how it works
//   data-secint-card="<ref>-<n>"    product cards to hover over (1 to 3)
//   data-secint-qcard               the product card a quick view button sits in (hovered first on desktop)
//   data-secint="go"                the one control the next press is for
//   data-secint-panel               the panel a filter toggle opened
//   data-secint-close               a panel's close button

export type InteractKind = 'faq' | 'quickview' | 'hover' | 'filters';
export type InteractTarget = { ref: string; index: number; kind: InteractKind; why: string };
export type InteractBox = { x: number; y: number; width: number; height: number };
/** press: an accordion's own toggle; hover: product cards; drawer: a button that opens a panel over the page; group: a filter group that opens in place. */
export type InteractMode = 'press' | 'hover' | 'drawer' | 'group';
export type InteractPlan = { ok: boolean; why: string; mode: InteractMode };

/**
 * Sections worth an interaction, at most `max`, at most one per kind except FAQs (two, in different sections).
 * A section that already has a clip (skip) gets no FAQ or hover clip; a quick view or filter panel becomes a new
 * block, so those may still come from it. Hover only when `desktop`; filters only on collection pages (or in a
 * section that is plainly a filter bar). Marks what it found, so planInteract can find it again.
 */
export function interactBlocks(arg: { max: number; skip: string[]; desktop: boolean; pageType: string }): InteractTarget[] {
  const label = (e: Element) => ((e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.textContent || '') as string).replace(/\s+/g, ' ').trim();
  const box = (e: Element) => e.getBoundingClientRect();
  const shown = (e: Element, allowTransparent = false) => {
    const cs = getComputedStyle(e);
    const r = box(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (!allowTransparent && Number(cs.opacity) < 0.05) return false;
    return r.width >= 8 && r.height >= 8;
  };
  // Site chrome and things that are not the section's own content: menus, dialogs, carts, the footer.
  const chrome = (e: Element) =>
    !!e.closest('header, nav, footer, [role="navigation"], [role="dialog"], [aria-modal="true"], dialog, [role="menu"], [role="menubar"], [class*="cart-drawer" i], [id*="cart-drawer" i], [class*="mega-menu" i]');
  const inFilters = (e: Element) => !!e.closest('[class*="facet" i], [id*="facet" i], [class*="filter" i], [id*="filter" i], [class*="refine" i]');
  const leavingLink = (e: Element) => {
    if (e.tagName !== 'A') return false;
    const h = (e.getAttribute('href') || '').trim();
    return !!h && !h.startsWith('#') && !/^javascript:/i.test(h);
  };
  const productCard = (e: Element): Element | null => {
    let c: Element | null = e;
    for (let i = 0; i < 8 && c && c !== document.body; i++, c = c.parentElement) {
      if (c.querySelector('a[href*="/products/"]') && box(c).width >= 100 && box(c).height >= 120) return c;
    }
    return null;
  };

  const FAQ_TEXT = /\bfaqs?\b|frequently asked|questions/i;
  const TAB = /^(product )?(description|details|ingredients|key ingredients|full ingredients|how to use|directions|usage|materials?|fabric( and care)?|care( instructions)?|shipping|delivery|returns|shipping (and|&) returns|delivery (and|&) returns|specifications?|specs|features|benefits|nutrition( facts)?|nutritional information|dimensions|size (and|&) fit|fit|composition|warranty)\b/i;
  const NOT_FAQ = /menu|navigation|search|account|cart|basket|currency|country|language|region|sort|filter|show more|load more|view all|read more|see more/i;
  // Not "quick add": that adds to the cart straight away (activistmanuka.com, 20 Nov 2026). A dialog opener named so is
  // still fine through its words ("Choose options").
  const QUICK = /quick[\s_-]*(view|shop|look|buy)|quickview|quickshop|choose options|select options|view options|see options/i;
  const ADD = /add to (cart|bag|basket)|^add$|^\+$|buy now|buy it now|checkout|sold out|notify me/i;
  const HOVER_CLASS = /(hover|secondary|second|alt|alternate|swap|back|flip)[-_]?(image|img|media|photo|pic)|(image|img|media|photo)[-_]?(hover|secondary|second|alt|swap|back|flip)|media--hover-effect|has-hover|hover-image|image--hover/i;
  const FILTER_BUTTON = /^(filters?|filter (and|&|\+) sort|sort (and|&|\+) filters?|filter by|refine( by)?|refine (and|&) sort|show filters?|filter products|all filters|filter results)$/i;

  document.querySelectorAll('[data-secint-go], [data-secint-card], [data-secint-qcard], [data-secint-mode], [data-secint-answer]').forEach((e) => {
    e.removeAttribute('data-secint-go');
    e.removeAttribute('data-secint-card');
    e.removeAttribute('data-secint-qcard');
    e.removeAttribute('data-secint-mode');
    e.removeAttribute('data-secint-answer');
  });

  const findFaq = (block: Element): { el: Element; why: string } | null => {
    const blockText = ((block as HTMLElement).innerText || '').replace(/\s+/g, ' ');
    const usable = (e: Element) => {
      if (leavingLink(e) || e.closest('form') || chrome(e) || inFilters(e)) return false;
      if (e.closest('[class*="variant" i], [class*="swatch" i], variant-selects, variant-radios, [class*="option-selector" i]')) return false;
      const l = label(e);
      return l.length >= 2 && l.length <= 160 && !NOT_FAQ.test(l) && shown(e);
    };
    let toggles = Array.from(block.querySelectorAll('details:not([open]) > summary, [aria-expanded="false"]')).filter((e) => {
      if (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'OPTION') return false;
      if (e.getAttribute('aria-haspopup') && e.getAttribute('aria-haspopup') !== 'false') return false;
      if (/^(combobox|listbox|menuitem|option|tab)$/.test(e.getAttribute('role') || '')) return false;
      return usable(e);
    });
    // A theme's own accordion with neither <details> nor aria-expanded (buyhi.co, 20 Nov 2026): a clickable title
    // named so, right before its answer, which is collapsed while closed. Marked so interactOpened watches the answer.
    if (!toggles.length) {
      const TITLE = /(accordion|collaps|faq|question|disclosure)[\w-]*(toggle|title|header|heading|trigger|question|head|label|button|btn)|(toggle|title|header|heading|trigger|question|head)[\w-]*(accordion|faq|collaps)/i;
      toggles = Array.from(block.querySelectorAll('[class]')).filter((e) => {
        const c = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '';
        if (!TITLE.test(c) || getComputedStyle(e).cursor !== 'pointer') return false;
        const answer = e.nextElementSibling;
        if (!answer) return false;
        const cs = getComputedStyle(answer);
        const closed = answer.getBoundingClientRect().height < 8 || cs.display === 'none' || cs.visibility === 'hidden';
        return closed && usable(e);
      });
      toggles.forEach((e) => e.setAttribute('data-secint-answer', 'next'));
    }
    if (!toggles.length) return null;
    const questions = (blockText.match(/\?/g) || []).length;
    const looksFaq = FAQ_TEXT.test(blockText) || questions >= 2 || toggles.some((e) => /\?\s*$/.test(label(e)));
    const tabby = toggles.some((e) => TAB.test(label(e)));
    if (!((toggles.length >= 2 && (looksFaq || tabby)) || tabby || toggles.some((e) => /\?\s*$/.test(label(e))))) return null;
    // The first toggle in the section's top part, so the answer has room to open below it.
    const top = box(block).top;
    const el = toggles.find((e) => box(e).top - top < Math.max(600, box(block).height * 0.6)) || toggles[0];
    return { el, why: `${looksFaq ? 'faq' : 'accordion'} "${label(el).slice(0, 60)}"` };
  };

  const findQuick = (block: Element): { el: Element; card: Element; why: string } | null => {
    for (const e of Array.from(block.querySelectorAll('button, [role="button"], a, [class*="quick" i]'))) {
      const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '';
      const data = Array.from(e.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.name).join(' ');
      const l = label(e);
      if (!QUICK.test(`${l} ${cls} ${data}`)) continue;
      const dialog = e.getAttribute('aria-haspopup') === 'dialog';
      // Never an add to cart: not by its words, not a submit button, not inside a cart form (a dialog opener is fine).
      if (!dialog && (ADD.test(l) || (e as HTMLButtonElement).type === 'submit' || e.closest('form[action*="/cart"]'))) continue;
      if (e.tagName !== 'BUTTON' && e.tagName !== 'A' && e.getAttribute('role') !== 'button' && !e.querySelector('svg, img') && l.length < 3) continue;
      if (chrome(e)) continue;
      // On a phone nothing hovers, so the button must already show; on desktop it may wait for the card's hover.
      if (!shown(e, arg.desktop)) continue;
      const card = productCard(e);
      if (!card) continue;
      return { el: e, card, why: `quick view "${(l || cls).slice(0, 40)}"` };
    }
    return null;
  };

  const findHover = (block: Element): Element[] => {
    if (!arg.desktop) return [];
    const cards: Element[] = [];
    const seenCards = new Set<Element>();
    for (const img of Array.from(block.querySelectorAll('img'))) {
      const card = productCard(img);
      if (!card || seenCards.has(card)) continue;
      seenCards.add(card);
      // A picture counts with a real address, or one waiting to load (a data: placeholder plus data-src/srcset).
      const real = (i: HTMLImageElement) => {
        const src = (i.currentSrc || i.getAttribute('src') || '').trim();
        if (src && !/^data:/.test(src)) return src;
        return (i.getAttribute('data-src') || i.getAttribute('data-srcset') || i.getAttribute('srcset') || '').trim();
      };
      const imgs = Array.from(card.querySelectorAll('img')).filter((i) => !!real(i));
      const srcs = new Set(imgs.map((i) => real(i).split(/[?\s]/)[0]));
      if (srcs.size < 2) continue;
      const hidden = imgs.some((i) => {
        const cs = getComputedStyle(i);
        return Number(cs.opacity) < 0.1 || cs.visibility === 'hidden';
      });
      const named = imgs.some((i) => {
        for (let p: Element | null = i; p && p !== card.parentElement; p = p.parentElement) {
          const c = typeof (p as HTMLElement).className === 'string' ? (p as HTMLElement).className : '';
          if (HOVER_CLASS.test(c)) return true;
        }
        return false;
      });
      // Card sized: not a product page's own gallery, which also holds several photos (buyhi.co, 20 Nov 2026).
      if (!(hidden || named) || !shown(card) || box(card).width < 100 || box(card).width > window.innerWidth * 0.5 || box(card).height > window.innerHeight * 0.85) continue;
      cards.push(card);
      if (cards.length >= 12) break;
    }
    // Cards in one row, so they are on screen together (arcticfoxandco.com, 20 Nov 2026: the first three found sat
    // in two rows and only one was in view). The fullest row wins; a lone card is fine when that is all there is.
    const rows: Element[][] = [];
    for (const c of cards) {
      const row = rows.find((r) => Math.abs(box(r[0]).top - box(c).top) <= 60);
      if (row) row.push(c);
      else rows.push([c]);
    }
    const best = rows.sort((a, b) => b.length - a.length)[0] || [];
    return best.slice(0, 3);
  };

  const findFilters = (block: Element): { el: Element; mode: 'drawer' | 'group'; why: string } | null => {
    const cls = `${typeof (block as HTMLElement).className === 'string' ? (block as HTMLElement).className : ''} ${block.id}`;
    if (arg.pageType !== 'collection' && !/facet|filter/i.test(cls)) return null;
    const norm = (s: string) => s.replace(/\(\s*\d+\s*\)|\d+/g, ' ').replace(/[^a-z&+ ]/gi, ' ').replace(/\s+/g, ' ').trim();
    for (const e of Array.from(block.querySelectorAll('button, summary, [role="button"], a[href^="#"]'))) {
      const l = norm(label(e));
      if (!FILTER_BUTTON.test(l) || !shown(e) || chrome(e)) continue;
      if ((e as HTMLButtonElement).type === 'submit') continue;
      return { el: e, mode: 'drawer', why: `filters "${l}"` };
    }
    for (const e of Array.from(block.querySelectorAll('details:not([open]) > summary, [aria-expanded="false"]'))) {
      if (!inFilters(e) || chrome(e) || e.tagName === 'INPUT' || e.tagName === 'SELECT' || leavingLink(e)) continue;
      const l = norm(label(e));
      if (l.length < 2 || l.length > 40 || /^sort/i.test(l) || FILTER_BUTTON.test(l) || !shown(e)) continue;
      return { el: e, mode: 'group', why: `filter group "${l}"` };
    }
    return null;
  };

  const out: InteractTarget[] = [];
  const count: Record<string, number> = {};
  const room = (k: InteractKind) => (count[k] || 0) < (k === 'faq' ? 2 : 1);
  const add = (ref: string, kind: InteractKind, why: string) => {
    out.push({ ref, index: Number(ref.replace(/^b/, '')) || 0, kind, why });
    count[kind] = (count[kind] || 0) + 1;
  };
  for (const block of Array.from(document.querySelectorAll('[data-secref]'))) {
    if (out.length >= arg.max) break;
    const ref = block.getAttribute('data-secref') || '';
    if (!ref || block.parentElement?.closest('[data-secref]') || box(block).height < 40) continue;
    const own = !arg.skip.includes(ref);
    if (room('filters')) {
      const f = findFilters(block);
      if (f) {
        f.el.setAttribute('data-secint-go', `${ref}-filters`);
        f.el.setAttribute('data-secint-mode', f.mode);
        add(ref, 'filters', f.why);
        continue;
      }
    }
    if (room('quickview') && out.length < arg.max) {
      const q = findQuick(block);
      if (q) {
        q.el.setAttribute('data-secint-go', `${ref}-quickview`);
        q.el.setAttribute('data-secint-mode', 'drawer');
        q.card.setAttribute('data-secint-qcard', ref);
        add(ref, 'quickview', q.why);
      }
    }
    if (own && room('hover') && out.length < arg.max) {
      const cards = findHover(block);
      if (cards.length) {
        cards.forEach((c, i) => c.setAttribute('data-secint-card', `${ref}-${i + 1}`));
        add(ref, 'hover', `hover over ${cards.length} product card${cards.length > 1 ? 's' : ''}`);
        continue;
      }
    }
    if (own && room('faq') && out.length < arg.max && !out.some((t) => t.ref === ref)) {
      const f = findFaq(block);
      if (f) {
        f.el.setAttribute('data-secint-go', `${ref}-faq`);
        f.el.setAttribute('data-secint-mode', 'press');
        add(ref, 'faq', f.why);
      }
    }
  }
  return out;
}

/** Finds the section's marked control again and makes it the one the next press is for (data-secint="go"). */
export function planInteract(arg: { ref: string; kind: InteractKind }): InteractPlan {
  document.querySelectorAll('[data-secint="go"], [data-secint-panel], [data-secint-close]').forEach((e) => {
    e.removeAttribute('data-secint');
    e.removeAttribute('data-secint-panel');
    e.removeAttribute('data-secint-close');
  });
  const label = (e: Element) => ((e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.textContent || '') as string).replace(/\s+/g, ' ').trim();
  if (arg.kind === 'hover') {
    const cards = Array.from(document.querySelectorAll(`[data-secint-card^="${arg.ref}-"]`)).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width >= 100 && r.height >= 100 && getComputedStyle(c).display !== 'none';
    });
    return cards.length ? { ok: true, why: `${cards.length} product card${cards.length > 1 ? 's' : ''}`, mode: 'hover' } : { ok: false, why: 'cards-gone', mode: 'hover' };
  }
  const el = document.querySelector(`[data-secint-go="${arg.ref}-${arg.kind}"]`);
  if (!el) return { ok: false, why: 'gone', mode: 'press' };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 8 || r.height < 8) {
    // A quick view button that only shows while its card is hovered is still fine: the card is hovered first.
    if (!(arg.kind === 'quickview' && cs.display !== 'none' && r.width >= 8 && r.height >= 8)) return { ok: false, why: 'hidden', mode: 'press' };
  }
  el.setAttribute('data-secint', 'go');
  const mode = (el.getAttribute('data-secint-mode') || 'press') as InteractMode;
  return { ok: true, why: `"${label(el).slice(0, 60)}"`, mode };
}

/**
 * Brings the control (or the first card) on screen: a third of the way down for toggles, so what opens has room
 * below; centred for cards and quick view buttons. Returns the section's on-screen part (rect), its whole box
 * (block), and for hover the cards' on-screen union (focus), all in viewport CSS pixels.
 */
export function placeInteract(arg: { ref: string; kind: InteractKind; scroll: boolean }): { ok: boolean; rect: InteractBox; block: InteractBox; focus: InteractBox; vw: number; vh: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  const block = document.querySelector(`[data-secref="${arg.ref}"]`);
  const target = arg.kind === 'hover' ? document.querySelector(`[data-secint-card="${arg.ref}-1"]`) : document.querySelector('[data-secint="go"]');
  if (!block || !target) return { ok: false, rect: empty, block: empty, focus: empty, vw, vh };
  if (arg.scroll) {
    const r = target.getBoundingClientRect();
    const want = arg.kind === 'faq' || arg.kind === 'filters' ? vh * 0.3 : vh / 2 - r.height / 2;
    window.scrollBy({ top: r.top - want, behavior: 'instant' as ScrollBehavior });
  }
  const clip = (r: DOMRect | InteractBox) => {
    const left = 'left' in r ? r.left : r.x;
    const top = 'top' in r ? r.top : r.y;
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    return { x: x0, y: y0, width: Math.max(0, Math.min(vw, left + r.width) - x0), height: Math.max(0, Math.min(vh, top + r.height) - y0) };
  };
  const b = block.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  let focus = clip(b);
  if (arg.kind === 'hover') {
    const cards = Array.from(document.querySelectorAll(`[data-secint-card^="${arg.ref}-"]`)).map((c) => c.getBoundingClientRect());
    const x0 = Math.min(...cards.map((c) => c.left));
    const y0 = Math.min(...cards.map((c) => c.top));
    const x1 = Math.max(...cards.map((c) => c.right));
    const y1 = Math.max(...cards.map((c) => c.bottom));
    focus = clip({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  const onScreen = t.top >= 0 && t.bottom <= vh && t.left >= 0 && t.right <= vw;
  return { ok: onScreen, rect: clip(b), block: { x: b.left, y: b.top, width: b.width, height: b.height }, focus, vw, vh };
}

/** The middle of each card to hover, in order, cut to the screen. */
export function cardPoints(ref: string): { x: number; y: number }[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return Array.from(document.querySelectorAll(`[data-secint-card^="${ref}-"]`))
    .map((c) => {
      const img = c.querySelector('img');
      const r = (img && img.getBoundingClientRect().width > 40 ? img : c).getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 200)) };
    })
    .filter((p) => p.x > 0 && p.x < vw && p.y > 0 && p.y < vh);
}

/** The middle of the product card a quick view button sits in (hovered first on desktop), or null. */
export function quickCardPoint(): { x: number; y: number } | null {
  const go = document.querySelector('[data-secint="go"]');
  const card = go?.closest('[data-secint-qcard]');
  if (!card) return null;
  const img = card.querySelector('img');
  const r = (img && img.getBoundingClientRect().width > 40 ? img : card).getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + Math.min(r.height / 2, 200);
  return x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight ? { x: Math.round(x), y: Math.round(y) } : null;
}

/** Whether the marked toggle is open now: its <details> is open, it says aria-expanded="true", or what it controls shows. */
export function interactOpened(): boolean {
  const el = document.querySelector('[data-secint="go"]');
  if (!el) return false;
  if (el.tagName === 'SUMMARY' && (el.parentElement as HTMLDetailsElement | null)?.open) return true;
  if (el.getAttribute('aria-expanded') === 'true') return true;
  const id = el.getAttribute('aria-controls');
  const p = id ? document.getElementById(id.split(/\s+/)[0]) : el.getAttribute('data-secint-answer') === 'next' ? el.nextElementSibling : null;
  if (p) {
    const cs = getComputedStyle(p);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && p.getBoundingClientRect().height > 8;
  }
  return false;
}

/**
 * Closes the marked toggle again if it is still open: a <details> directly, anything else by a second press
 * ('press' asks the caller for it). 'none' when it is already closed.
 */
export function closeToggle(): 'done' | 'press' | 'none' {
  const el = document.querySelector('[data-secint="go"]');
  if (!el) return 'none';
  if (el.tagName === 'SUMMARY') {
    const d = el.parentElement as HTMLDetailsElement | null;
    if (d?.open) {
      d.open = false;
      return 'done';
    }
    return 'none';
  }
  if (el.getAttribute('data-secint-answer') === 'next') {
    const a = el.nextElementSibling;
    return a && a.getBoundingClientRect().height > 8 && getComputedStyle(a).display !== 'none' ? 'press' : 'none';
  }
  return el.getAttribute('aria-expanded') === 'true' ? 'press' : 'none';
}

/**
 * A filter group that opened in place: the toggle's box joined with the panel it opened, cut to the screen, if
 * the panel reads like filters (filter words, and boxes to tick or links or a price slider). The panel is marked
 * data-secint-panel and given data-secmoment="<key>" so describePanel can read it.
 */
export function groupPanel(key: string): { ok: boolean; box: InteractBox; why: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  const el = document.querySelector('[data-secint="go"]');
  if (!el) return { ok: false, box: empty, why: 'toggle-gone' };
  let panel: Element | null = null;
  const id = el.getAttribute('aria-controls');
  if (id) panel = document.getElementById(id.split(/\s+/)[0]);
  if (!panel && el.tagName === 'SUMMARY' && el.parentElement?.tagName === 'DETAILS') panel = Array.from(el.parentElement.children).find((c) => c.tagName !== 'SUMMARY') || null;
  if (!panel) panel = el.nextElementSibling;
  if (!panel) return { ok: false, box: empty, why: 'no-panel' };
  const p = panel.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  if (p.height < 20 || getComputedStyle(panel).display === 'none') return { ok: false, box: empty, why: 'panel-closed' };
  const x0 = Math.max(0, Math.min(p.left, t.left));
  const y0 = Math.max(0, Math.min(p.top, t.top));
  const x1 = Math.min(vw, Math.max(p.right, t.right));
  const y1 = Math.min(vh, Math.max(p.bottom, t.bottom));
  const box = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  if (box.width < 120 || box.height < 60) return { ok: false, box, why: 'panel-too-small' };
  const text = ((panel as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
  const ticks = panel.querySelectorAll('input[type="checkbox"], input[type="radio"], input[type="range"], input[type="number"], [role="checkbox"], [role="slider"]').length;
  const links = panel.querySelectorAll('a[href]').length;
  if (!(ticks >= 2 || links >= 3 || (text.length >= 10 && /\b(in stock|out of stock|price|from|to|size|colou?r|availability|brand|type|material)\b/i.test(text)))) return { ok: false, box, why: 'not-filters' };
  panel.setAttribute('data-secint-panel', '1');
  panel.setAttribute('data-secmoment', key);
  return { ok: true, box, why: '' };
}

/**
 * A panel that opened over the page (marked data-secmoment="<key>" by the overlay snapshot): its box cut to the
 * screen, kept only if it reads like the kind asked for. A quick view shows a product (a price, an add to cart, or
 * a title with a picture); filters show filter words with boxes to tick, links or a slider.
 */
export function overlayPanel(arg: { key: string; kind: InteractKind }): { ok: boolean; box: InteractBox; why: string } {
  const el = document.querySelector(`[data-secmoment="${arg.key}"]`) as HTMLElement | null;
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  if (!el) return { ok: false, box: empty, why: 'panel-gone' };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  const x0 = Math.max(0, r.left);
  const y0 = Math.max(0, r.top);
  const box = { x: x0, y: y0, width: Math.max(0, Math.min(vw, r.right) - x0), height: Math.max(0, Math.min(vh, r.bottom) - y0) };
  if (box.width * box.height < vw * vh * 0.06) return { ok: false, box, why: 'panel-too-small' };
  const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
  if (arg.kind === 'quickview') {
    const price = /(?:[$£€¥₹]|\b(?:USD|EUR|GBP|CAD|AUD)\s?)\s?\d{1,5}(?:[.,]\d{2})?|\d{1,5}[.,]\d{2}\s?(?:€|zł|kr)/.test(text);
    const add = /add to (cart|bag|basket)|buy now|buy it now|sold out|choose options/i.test(text);
    const picture = Array.from(el.querySelectorAll('img')).some((i) => {
      const b = i.getBoundingClientRect();
      return b.width >= 120 && b.height >= 120;
    });
    if (!(price || add) || (!picture && !price)) return { ok: false, box, why: 'not-a-product' };
    return { ok: true, box, why: '' };
  }
  const ticks = el.querySelectorAll('input[type="checkbox"], input[type="radio"], input[type="range"], input[type="number"], [role="checkbox"], [role="slider"], details, [aria-expanded]').length;
  const links = el.querySelectorAll('a[href]').length;
  if (!/\b(filters?|sort|refine|price|size|colou?r|availability|brand|product type|in stock)\b/i.test(text) || (ticks < 2 && links < 3)) return { ok: false, box, why: 'not-filters' };
  return { ok: true, box, why: '' };
}

/** Marks the close button of the panel with data-secmoment="<key>" (data-secint-close). False when it has none. */
export function markInteractClose(key: string): boolean {
  const el = document.querySelector(`[data-secmoment="${key}"]`);
  if (!el) return false;
  const scope = el.closest('[role="dialog"], dialog, [aria-modal="true"]') || el;
  const c = scope.querySelector('[aria-label*="close" i], [class*="close" i], [data-close], [data-dismiss], button[title*="close" i], [aria-label*="dismiss" i]');
  if (!c) return false;
  c.setAttribute('data-secint-close', '1');
  return true;
}
