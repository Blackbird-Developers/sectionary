// Functions in this file run INSIDE the captured page (Playwright serialises them with page.evaluate),
// like page-script.ts: no imports, no closures over anything outside the function body. They find what a
// moment needs and return plain data. Deciding what it was happens in Node (src/moment-logic.ts), where it
// is tested without a browser.

/** Something floating over the page, as one snapshot saw it. Boxes are in viewport pixels. */
export type Overlay = {
  /** The element's data-secmoment value, set by the snapshot so later steps can find it again. */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  position: string;
  z: number;
  /** Visible text, spaces collapsed, at most 300 characters; textLength is the full length. */
  text: string;
  textLength: number;
  links: number;
  buttons: number;
  email: boolean;
  tel: boolean;
};

/**
 * Every visible element that is fixed, sticky or absolute, overlaps the screen and covers at least 2% of it;
 * and, inside a full-screen fixed wrapper, the panel it holds (position "inner").
 */
export function snapshotOverlays(): Overlay[] {
  const w = window as unknown as { __secMomentSeq?: number };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const min = vw * vh * 0.02;
  const out: Overlay[] = [];
  const seen = new Set<string>();
  // A full-screen fixed element that holds the page's main content is the page itself in a scroll box, not an
  // overlay. Read from the structure: on a small page a cart drawer can hold half of all the words.
  const mainContent = document.querySelector('main, [role="main"]') || document.querySelector('h1');
  const notThePage = (el: HTMLElement) => !mainContent || !el.contains(mainContent);
  const visible = (cs: CSSStyleDeclaration) => cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  const onScreen = (r: DOMRect) => Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  // A drawer or popup often sits inside a full-screen wrapper that also paints the dimmed backdrop
  // (myzoobox.com's desktop cart drawer): the panel itself is a plain child. Find it through the wrappers.
  const innerPanel = (wrapper: HTMLElement): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestArea = 0;
    const walk = (node: Element, depth: number) => {
      if (depth > 5) return;
      for (const c of Array.from(node.children) as HTMLElement[]) {
        const ccs = getComputedStyle(c);
        if (!visible(ccs)) continue;
        const cr = c.getBoundingClientRect();
        if (cr.width >= vw * 0.9 && cr.height >= vh * 0.8) {
          walk(c, depth + 1);
          continue;
        }
        const area = onScreen(cr);
        if (area >= vw * vh * 0.1 && area > bestArea && (c.innerText || '').trim().length >= 20) {
          best = c;
          bestArea = area;
        }
      }
    };
    walk(wrapper, 0);
    return best;
  };
  const add = (el: HTMLElement, position: string, z: number) => {
    let key = el.getAttribute('data-secmoment');
    if (!key) {
      w.__secMomentSeq = (w.__secMomentSeq || 0) + 1;
      key = 'm' + w.__secMomentSeq;
      el.setAttribute('data-secmoment', key);
    }
    if (seen.has(key)) return;
    seen.add(key);
    const r = el.getBoundingClientRect();
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    out.push({
      key,
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      position,
      z,
      text: text.slice(0, 300),
      textLength: text.length,
      links: el.querySelectorAll('a[href]').length,
      buttons: el.querySelectorAll('button, [role="button"], input[type="submit"]').length,
      email: !!el.querySelector('input[type="email"], input[name*="email" i]'),
      tel: !!el.querySelector('input[type="tel"]'),
    });
  };
  const scan = (root: ParentNode) => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (el.shadowRoot) scan(el.shadowRoot);
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky' && cs.position !== 'absolute') continue;
      if (!visible(cs)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (onScreen(r) < min) continue;
      const z = parseInt(cs.zIndex, 10) || 0;
      add(el, cs.position, z);
      if (cs.position === 'fixed' && r.width >= vw * 0.9 && r.height >= vh * 0.8) {
        const len = (el.innerText || '').trim().length;
        if (len >= 20 && notThePage(el)) {
          const inner = innerPanel(el);
          if (inner) add(inner, 'inner', z);
        }
      }
    }
  };
  scan(document);
  return out;
}

/**
 * The control that opens the navigation. Phone: the menu button in the header. Desktop: the first top-level
 * item that has a submenu. Marks it with data-secmoment-trigger="1" and says how it was found.
 */
export function findMenuTrigger(phone: boolean): { label: string; via: string; tag: string; href: string | null } | null {
  document.querySelectorAll('[data-secmoment-trigger]').forEach((e) => e.removeAttribute('data-secmoment-trigger'));
  const visible = (el: Element, minSide: number) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // On screen sideways too: a closed drawer's own close button sits off to the left (myzoobox.com).
    return r.width >= minSide && r.height >= minSide && r.right > 0 && r.left < window.innerWidth && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  // Never a control for search (out of scope), the cart, the account or closing something.
  const notMenu = /close|search|cart|basket|bag|account|log ?in|sign ?in|wishlist/i;
  const labelOf = (el: Element) => ((el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
  const pick = (el: Element, via: string) => {
    el.setAttribute('data-secmoment-trigger', '1');
    return { label: labelOf(el), via, tag: el.tagName.toLowerCase(), href: el.getAttribute('href') };
  };
  if (phone) {
    const groups: [string, string, RegExp | null][] = [
      ['button[aria-controls][aria-expanded="false"]', 'menu button (aria-controls)', /menu|navigation/i],
      ['header summary, [role="banner"] summary', 'menu summary in the header', /menu|navigation/i],
      ['[class*="hamburger" i], [class*="menu-toggle" i], [class*="menu-drawer" i] summary, [data-drawer-toggle]', 'menu toggle by class', null],
      // Themes that mark nothing: a button labelled "Open menu" (myzoobox.com) or "Toggle menu" (myirelandbox.com).
      ['button, [role="button"]', 'button labelled menu', /\bmenu\b|navigation|hamburger|burger|nav-toggle|mobile-toggle/i],
    ];
    for (const [sel, via, label] of groups) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = el.getBoundingClientRect();
        if (r.top > 140 || r.bottom < 0 || !visible(el, 20)) continue;
        const words = labelOf(el) + ' ' + (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '');
        if (label && !label.test(words)) continue;
        if (notMenu.test(labelOf(el))) continue;
        return pick(el, via);
      }
    }
    return null;
  }
  const navs = Array.from(document.querySelectorAll('header nav, header [role="navigation"], [role="banner"] nav, #shopify-section-header nav, .shopify-section-group-header-group nav'));
  for (const nav of navs) {
    const r = nav.getBoundingClientRect();
    if (r.top > 220 || !visible(nav, 10)) continue;
    for (const item of Array.from(nav.querySelectorAll('li, details'))) {
      const hasSub = item.querySelector('ul ul, li ul, details > :not(summary), [class*="mega" i], [class*="dropdown" i], [class*="submenu" i]') || (item.tagName === 'LI' && item.querySelector('ul'));
      if (!hasSub) continue;
      const trigger = item.querySelector(':scope > summary, :scope > details > summary, :scope > a, :scope > button, :scope > span > a, :scope > div > a, summary, a, button');
      if (!trigger || !visible(trigger, 10)) continue;
      const tr = trigger.getBoundingClientRect();
      if (tr.top > 220) continue;
      return pick(trigger, 'first top-level navigation item with a submenu');
    }
  }
  // Menus a script builds only when opened (myirelandbox.com) have no submenu in the page yet. A worded
  // button among the navigation's items opens one; links go somewhere, so they never count here.
  for (const nav of navs) {
    if (nav.getBoundingClientRect().top > 220 || !visible(nav, 10)) continue;
    for (const b of Array.from(nav.querySelectorAll('button, [aria-haspopup="true"], [aria-haspopup="menu"]'))) {
      const text = labelOf(b);
      if (!text || text.length > 30 || notMenu.test(text) || !visible(b, 10) || b.getBoundingClientRect().top > 220) continue;
      if (b.tagName === 'A' && b.getAttribute('href') && !/^(#|javascript:)/i.test(b.getAttribute('href') || '')) continue;
      return pick(b, 'worded button in the navigation');
    }
  }
  return null;
}

/**
 * The page's main add-to-cart button, by the moments brief's rules (7.6): first visible, enabled match;
 * never a payment, buy-now, subscribe or sold-out button. Marks it data-secmoment-atc="1".
 */
export function findAddToCart(): { label: string; via: string; top: number; bottom: number } | null {
  document.querySelectorAll('[data-secmoment-atc]').forEach((e) => e.removeAttribute('data-secmoment-atc'));
  const never = /buy (it )?now|checkout|pay with|pay now|paypal|shop pay|apple pay|google pay|pre-?order|subscribe|notify me|sold out/i;
  const textOf = (el: Element) => ((el as HTMLInputElement).value && el.tagName === 'INPUT' ? (el as HTMLInputElement).value : (el as HTMLElement).innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const usable = (el: Element) => {
    if (el.closest('.shopify-payment-button, [data-shopify="payment-button"]')) return false;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 20 || r.height < 16 || cs.visibility === 'hidden' || cs.display === 'none') return false;
    return !never.test(textOf(el));
  };
  const steps: [string, string][] = [
    ['form[action*="/cart/add"] button[type="submit"], form[action*="/cart/add"] input[type="submit"]', "form[action*='/cart/add'] submit"],
    ['button[name="add"], [data-add-to-cart], [data-action="add-to-cart"], #AddToCart, .product-form__submit, .single_add_to_cart_button', 'known add-to-cart button'],
  ];
  const found = (el: Element, via: string) => {
    el.setAttribute('data-secmoment-atc', '1');
    const r = el.getBoundingClientRect();
    return { label: textOf(el).slice(0, 80), via, top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY) };
  };
  for (const [sel, via] of steps) for (const el of Array.from(document.querySelectorAll(sel))) if (usable(el)) return found(el, via);
  const words = /^(add to (cart|bag|basket)|add|in den warenkorb|ajouter au panier|añadir al carrito|aggiungi al carrello|toevoegen aan winkelwagen)$/i;
  for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
    const r = el.getBoundingClientRect();
    if (r.top + window.scrollY > 1400) continue;
    if (usable(el) && words.test(textOf(el))) return found(el, 'button worded add to cart');
  }
  return null;
}

/**
 * After scrolling past the main button: pinned bars that touch the top or bottom of the screen, span it,
 * are 44 to 220px tall and hold an add-to-cart button. `skip` = keys of what was already showing at rest
 * (the site header). Uses window.__secPinned, refreshed by hidePinned({ rescan: true }) just before.
 */
export function findStickyBars(skip: string[]): { key: string; label: string; links: number }[] {
  const w = window as unknown as { __secPinned?: Set<HTMLElement>; __secMomentSeq?: number };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const atc = /\badd to (cart|bag|basket)\b|^add\b|in den warenkorb|ajouter au panier|añadir al carrito|aggiungi al carrello|toevoegen aan winkelwagen/i;
  const out: { key: string; label: string; links: number }[] = [];
  for (const el of Array.from(w.__secPinned || [])) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0.05) continue;
    const r = el.getBoundingClientRect();
    const edge = r.top <= 8 && r.top >= -8 ? 'top' : r.bottom >= vh - 8 && r.bottom <= vh + 8 ? 'bottom' : null;
    if (!edge || r.width < vw * 0.85 || r.height < 44 || r.height > 220) continue;
    const key = el.getAttribute('data-secmoment') || '';
    if (key && skip.includes(key)) continue;
    const links = el.querySelectorAll('a[href]').length;
    if (links > 6) continue;
    const button = Array.from(el.querySelectorAll('button, input[type="submit"], [role="button"]')).find((b) => atc.test(((b as HTMLInputElement).value && b.tagName === 'INPUT' ? (b as HTMLInputElement).value : (b as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()));
    if (!button) continue;
    let k = key;
    if (!k) {
      w.__secMomentSeq = (w.__secMomentSeq || 0) + 1;
      k = 'm' + w.__secMomentSeq;
      el.setAttribute('data-secmoment', k);
    }
    out.push({ key: k, label: ((button as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), links });
  }
  return out;
}

/** Keys of the pinned elements showing at the top of the screen right now: the site header and its bars. */
export function pinnedAtTop(): string[] {
  const w = window as unknown as { __secPinned?: Set<HTMLElement>; __secMomentSeq?: number };
  const out: string[] = [];
  for (const el of Array.from(w.__secPinned || [])) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.top > 120 || r.bottom < 0) continue;
    let k = el.getAttribute('data-secmoment');
    if (!k) {
      w.__secMomentSeq = (w.__secMomentSeq || 0) + 1;
      k = 'm' + w.__secMomentSeq;
      el.setAttribute('data-secmoment', k);
    }
    out.push(k);
  }
  return out;
}

/**
 * The fields of a block for the panel a moment revealed, by the same rules collectBlocks uses, and tags the
 * panel with data-secref so its screenshot and hidePinned can find it. Null when the panel is gone.
 */
export function describePanel(arg: { key: string; ref: string }): {
  tag: string; id: string | null; classes: string | null; top: number; height: number; width: number;
  text: string; textLength: number; headline: string | null; buttons: number; images: number; videos: number; bg: string;
} | null {
  const el = document.querySelector(`[data-secmoment="${arg.key}"]`) as HTMLElement | null;
  if (!el) return null;
  el.setAttribute('data-secref', arg.ref);
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const text = ((el.innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
  const head = el.querySelector('h1, h2, h3, h4, [role="heading"]');
  const transparent = (c: string) => c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
  let bg = cs.backgroundColor;
  if (transparent(bg) && el.firstElementChild) bg = getComputedStyle(el.firstElementChild).backgroundColor;
  if (transparent(bg)) bg = getComputedStyle(document.body).backgroundColor;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute('id') || null,
    classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().slice(0, 200) : null,
    top: Math.round(cs.position === 'fixed' ? r.top : r.top + window.scrollY),
    height: Math.round(r.height),
    width: Math.round(r.width),
    text: text.slice(0, 2000),
    textLength: text.length,
    headline: head ? (head.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    buttons: el.querySelectorAll('a.button, a.btn, button, [class*="button"], [class*="btn"], input[type="submit"]').length,
    images: el.querySelectorAll('img, picture').length,
    videos: el.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="videopress"]').length,
    bg,
  };
}

/** The text of the header's cart count badge, if the store has one ("0", "1 item"). */
export function cartBadge(): string | null {
  const el = document.querySelector('[class*="cart-count" i], [class*="cart__count" i], [data-cart-count], .cart-count-bubble');
  return el ? ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) : null;
}

/**
 * A header control that opens the cart as a drawer: a button or summary whose aria-controls points at an
 * element named for a cart drawer. Never a link to /cart (that would be a second page visit). Marks it
 * data-secmoment-cartdrawer="1".
 */
export function findCartDrawerToggle(): { label: string } | null {
  document.querySelectorAll('[data-secmoment-cartdrawer]').forEach((e) => e.removeAttribute('data-secmoment-cartdrawer'));
  for (const el of Array.from(document.querySelectorAll('button[aria-controls], summary[aria-controls], [role="button"][aria-controls]'))) {
    if (el.tagName === 'A') continue;
    const target = document.getElementById(el.getAttribute('aria-controls') || '');
    if (!target) continue;
    const words = (target.id + ' ' + (typeof target.className === 'string' ? target.className : '')).toLowerCase();
    if (!/cart|basket|bag/.test(words) || !/drawer|sidebar|mini|flyout|slide|panel/.test(words)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16 || r.top > 160 || r.right <= 0 || r.left >= window.innerWidth) continue;
    el.setAttribute('data-secmoment-cartdrawer', '1');
    return { label: ((el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 80) };
  }
  return null;
}

/** Whether the element with this data-secmoment key is still showing (for closing a menu again). */
export function overlayShowing(key: string): boolean {
  const el = document.querySelector(`[data-secmoment="${key}"]`);
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/** Last resort when a panel will not close: take it out of the page's picture. */
export function forceHide(key: string): void {
  const el = document.querySelector(`[data-secmoment="${key}"]`) as HTMLElement | null;
  if (el) el.style.setProperty('display', 'none', 'important');
}
