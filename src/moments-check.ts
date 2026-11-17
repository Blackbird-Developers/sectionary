// Checks the moments runner (src/moments.ts) on local HTML pages in Chromium: what it must capture and
// what it must leave alone. No network.   npm run moments-check
import { chromium, type Browser } from 'playwright';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finalizeMoments, runMoments, runPopupWatch, type MomentContext } from './moments.js';
import type { MomentKind } from '../web/src/contracts/manifest.js';

const filler = '<section style="height:900px;padding:40px"><h2>Our story</h2><p>Soft, warm socks made to last.</p></section>'.repeat(4);
const later = (ms: number, js: string) => `<script>setTimeout(function(){${js}}, ${ms});</script>`;
const showPopup = (html: string) => later(800, `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)})`);
const backdrop = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50"></div>';
const box = (inner: string) => `<div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;height:420px;background:#fff;z-index:51;padding:24px">${inner}</div>`;

type Case = {
  name: string; kind: MomentKind; pageType: string; phone?: boolean; html: string; want: 'moment' | 'none'; panelType?: string;
  /** Give the runner a popup closer, as capture-page.ts does with dismissOverlays. */
  dismiss?: boolean;
  /** A JavaScript expression that must be true in the page afterwards. */
  after?: string;
};

const header = (nav: string) => `<header style="position:sticky;top:0;height:72px;background:#fff;z-index:20;display:flex;gap:24px;align-items:center;padding:0 24px"><a href="/">Socks Co</a>${nav}</header>`;
const megaCss = '<style>.has-mega .mega{display:none;position:absolute;left:0;right:0;top:72px;height:420px;background:#fafafa;padding:24px}.has-mega:hover .mega{display:grid;grid-template-columns:repeat(4,1fr)}</style>';
const megaNav = `<nav><ul style="display:flex;gap:24px;list-style:none;margin:0;padding:0"><li class="has-mega"><a href="/collections/all">Shop</a><div class="mega">${['Socks', 'Tights', 'Gifts', 'New in', 'Sale', 'Wool', 'Cotton', 'Kids'].map((t) => `<a href="/collections/${t.toLowerCase()}">${t}</a>`).join('')}</div></li><li><a href="/pages/about">About</a></li></ul></nav>`;
const phoneMenu = `<button aria-controls="drawer" aria-expanded="false" aria-label="Menu" style="width:44px;height:44px" onclick="var d=document.getElementById('drawer');d.style.display='block';this.setAttribute('aria-expanded','true')">☰</button>
  <div id="drawer" style="display:none;position:fixed;left:0;top:72px;width:100%;height:calc(100% - 72px);background:#fff;z-index:30">${['Shop', 'Socks', 'Tights', 'Gifts', 'About', 'Contact'].map((t) => `<a style="display:block;padding:12px" href="/${t.toLowerCase()}">${t}</a>`).join('')}</div>
  <script>document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.getElementById('drawer').style.display='none'}})</script>`;
const productForm = '<main style="padding:40px"><h1>Merino socks</h1><p>$18.00</p><form action="/cart/add" method="post" onsubmit="return false"><input type="hidden" name="id" value="1"><button type="submit" name="add" style="width:300px;height:48px">Add to cart</button></form></main>';
const stickyBar = `<div id="bar" style="display:none;position:fixed;left:0;right:0;bottom:0;height:72px;background:#111;color:#fff;z-index:40;align-items:center;justify-content:space-between;padding:0 24px"><span>Merino socks $18.00</span><button>Add to cart</button></div>
  <script>addEventListener('scroll',function(){document.getElementById('bar').style.display=scrollY>500?'flex':'none'})</script>`;

const cases: Case[] = [
  { name: 'newsletter popup after a moment', kind: 'first-visit-popup', pageType: 'home', html: filler + showPopup(backdrop + box('<h2>Get 10% off your first order</h2><input type="email" placeholder="Email"><button>Sign up</button>')), want: 'moment', panelType: 'popup' },
  { name: 'phone: newsletter popup', kind: 'first-visit-popup', pageType: 'home', phone: true, html: filler + showPopup(backdrop + box('<h2>Join the club</h2><input type="email"><button>Sign up</button>').replace('width:520px', 'width:340px')), want: 'moment', panelType: 'popup' },
  { name: 'cookie bar is not a popup', kind: 'first-visit-popup', pageType: 'home', html: filler + showPopup('<div style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:60">We use cookies to improve your experience. <button>Accept</button></div>'), want: 'none' },
  { name: 'age gate is not a popup', kind: 'first-visit-popup', pageType: 'home', html: filler + showPopup(backdrop + box('<h2>Are you over 21 years old?</h2><button>Yes</button><button>No</button>')), want: 'none' },
  { name: 'country picker is not a popup', kind: 'first-visit-popup', pageType: 'home', html: filler + showPopup(backdrop + box('<h2>Choose your country</h2><p>Shipping to United States</p><button>Continue</button>')), want: 'none' },
  { name: 'no popup at all', kind: 'first-visit-popup', pageType: 'home', html: filler, want: 'none' },
  { name: 'desktop: mega menu on hover', kind: 'menu-open', pageType: 'home', html: megaCss + header(megaNav) + filler, want: 'moment', panelType: 'menu' },
  { name: 'phone: menu button opens a drawer', kind: 'menu-open', pageType: 'home', phone: true, html: header(phoneMenu) + filler, want: 'moment', panelType: 'menu' },
  { name: 'desktop: plain links, no submenu', kind: 'menu-open', pageType: 'home', html: header('<nav><a href="/shop">Shop</a><a href="/about">About</a></nav>') + filler, want: 'none' },
  { name: 'phone: unmarked button labelled "Open menu"', kind: 'menu-open', pageType: 'home', phone: true, html: header(phoneMenu.replace('aria-controls="drawer" aria-expanded="false" aria-label="Menu"', 'class="site-mobile-toggle" aria-label="Open menu"')) + filler, want: 'moment', panelType: 'menu' },
  { name: 'desktop: menu a script builds on click', kind: 'menu-open', pageType: 'home', html: header(`<nav><button id="shop" onclick="if(!document.getElementById('panel'))document.querySelector('header').insertAdjacentHTML('beforeend','<div id=&quot;panel&quot; style=&quot;position:absolute;left:0;right:0;top:72px;height:400px;background:#fafafa&quot;>${['Socks', 'Tights', 'Gifts', 'Sale', 'Wool', 'Kids'].map((t) => `<a href=&quot;/c/${t}&quot;>${t}</a>`).join('')}</div>')">Shop</button><a href="/about">About</a></nav>`) + filler, want: 'moment', panelType: 'menu' },
  { name: 'desktop: a search button is never a menu', kind: 'menu-open', pageType: 'home', html: header('<nav><a href="/shop">Shop</a><button aria-label="Search">Search</button></nav>') + filler, want: 'none' },
  {
    name: 'phone: the header grows to hold the menu',
    kind: 'menu-open', pageType: 'home', phone: true, want: 'moment', panelType: 'menu', after: "document.getElementById('inflow').style.display === 'none'",
    html: `<header style="position:sticky;top:0;background:#fff;z-index:20"><div style="height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 16px"><a href="/">Socks Co</a><button aria-label="Toggle menu" style="width:32px;height:32px" onclick="var n=document.getElementById('inflow');n.style.display=n.style.display==='none'?'block':'none'">☰</button></div><nav id="inflow" style="display:none;height:520px">${['Shop', 'Socks', 'Tights', 'Gifts', 'About', 'Contact'].map((t) => `<a style="display:block;padding:12px" href="/${t.toLowerCase()}">${t}</a>`).join('')}</nav></header>` + filler,
  },
  {
    name: 'desktop: a small dropdown is no menu, and the header stays',
    kind: 'menu-open', pageType: 'home', want: 'none', after: "getComputedStyle(document.querySelector('header')).display !== 'none'",
    html: '<style>.dd .sub{display:none;position:absolute;top:72px;left:200px;width:220px;background:#eee}.dd:hover .sub{display:block}</style>' + header('<nav><ul style="display:flex;gap:24px;list-style:none;margin:0;padding:0"><li class="dd"><a href="/shop">Shop</a><ul class="sub"><li><a href="/a">Subscribe</a></li><li><a href="/b">Gift</a></li></ul></li><li><a href="/about">About</a></li></ul></nav>') + filler,
  },
  { name: 'sticky add-to-cart bar after scrolling', kind: 'sticky-atc', pageType: 'product', html: header('<a href="/cart">Cart</a>') + productForm + filler + stickyBar, want: 'moment', panelType: 'sticky-add-to-cart' },
  { name: 'a sticky header is not a sticky add-to-cart bar', kind: 'sticky-atc', pageType: 'product', html: header('<a href="/cart">Cart</a><button>Add to cart</button>') + productForm + filler, want: 'none' },
  {
    name: 'a sign-up popup our scrolling opens is closed first',
    kind: 'sticky-atc', pageType: 'product', want: 'moment', panelType: 'sticky-add-to-cart', dismiss: true, after: "getComputedStyle(document.getElementById('su')).display === 'none'",
    html: header('<a href="/cart">Cart</a>') + productForm + filler + stickyBar +
      `<div id="su" class="popup" style="display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:500px;height:400px;background:#fff;z-index:99"><button class="close" onclick="document.getElementById('su').style.display='none'">×</button>Get 10% off</div>
      <script>var shown=false;addEventListener('scroll',function(){if(!shown&&scrollY>100){shown=true;document.getElementById('su').style.display='block'}})</script>`,
  },
];

async function run(browser: Browser, c: Case, dir: string): Promise<{ ok: boolean; said: string }> {
  const ctx = await browser.newContext(c.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  // Same shim as the crawler: functions sent into the page still call tsx's __name helper.
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  const page = await ctx.newPage();
  try {
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif}</style></head><body>${c.html}</body></html>`, { waitUntil: 'load' });
    const dismiss = async (p: typeof page) => {
      await p.evaluate(() => document.querySelectorAll<HTMLElement>('.popup .close').forEach((b) => b.click()));
    };
    const mctx: MomentContext = { vp: c.phone ? 'mobile' : 'desktop', pageDir: dir, quality: 70, pageType: c.pageType, kinds: [c.kind], ...(c.dismiss ? { dismiss } : {}) };
    const a = c.kind === 'first-visit-popup' ? await runPopupWatch(page, mctx) : { moments: [], panels: [], notes: [] };
    const b = c.kind === 'first-visit-popup' ? { moments: [], panels: [], notes: [] } : await runMoments(page, mctx);
    const done = await finalizeMoments([a, b], dir, mctx.vp, 5);
    const high = done.moments.filter((m) => m.confidence === 'high');
    const said = done.moments.length ? done.moments.map((m) => `${m.kind} ${m.confidence}${m.error ? ' ' + m.error : ''} [${m.frames.map((f) => f.role).join(',')}]`).join('; ') : 'no moment';
    if (c.after && !(await page.evaluate(c.after))) return { ok: false, said: `${said} (afterwards: ${c.after} is false)` };
    if (c.want === 'none') return { ok: high.length === 0 && done.panels.length === 0, said };
    const m = high[0];
    if (!m) return { ok: false, said };
    const panel = done.panels.find((p) => p.ref === m.panelRef);
    const files = await Promise.all(m.frames.map((f) => stat(path.join(dir, f.file)).then((s) => s.size > 0, () => false)));
    const ok = !!panel && panel.typeHint === c.panelType && panel.index === 5 && panel.moment === c.kind && files.every(Boolean) && m.frames.some((f) => f.role === 'panel' && f.file === panel.file);
    return { ok, said: `${said} -> block ${panel ? `${panel.index} ${panel.typeHint} ${panel.width}x${panel.height}` : 'none'}` };
  } finally {
    await ctx.close();
  }
}

// ---- add-to-cart and cart-drawer, on a pretend Shopify store served by routes (no network) ----------------

type CartCase = {
  name: string;
  /** What the store does when the product form is sent. */
  answer: 'drawer' | 'wrapped-drawer' | 'sliding-drawer' | 'toast' | 'redirect' | 'checkout' | 'none';
  soldOut?: boolean;
  platform?: string;
  want: { response?: string; confidence: 'high' | 'low'; error?: string; panelType?: string; cartDrawer?: boolean; filled: boolean; checkoutBlocked?: boolean; analyticsBlocked?: boolean };
};

const ANSWERS: Record<CartCase['answer'], string> = {
  drawer: `document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;top:0;right:0;width:420px;height:100%;background:#fff;z-index:50;padding:24px"><h2>Your cart</h2><p>Merino socks</p><p>$18.00</p><p>Quantity 1</p><button>Remove</button><a href="/checkout">Check out</a></div>');`,
  // The drawer is a plain child of a full-screen wrapper that also paints the backdrop (myzoobox.com, desktop):
  // hidden until opened, or always there with the panel pushed off the screen.
  'wrapped-drawer': `document.getElementById('cd').style.visibility = 'visible';`,
  'sliding-drawer': `document.getElementById('cd-panel').style.transform = 'none'; document.getElementById('cd-back').style.opacity = '0.5';`,
  toast: `document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;top:16px;right:16px;width:300px;height:70px;background:#111;color:#fff;z-index:50;padding:12px">Added to your cart</div>');`,
  redirect: `location.href = '/cart';`,
  checkout: `location.href = '/checkouts/cn/abc123';`,
  none: '',
};

const CART_LINES = '<h2>Your cart</h2><p>Merino socks</p><p>$18.00</p><p>Quantity 1</p><button>Remove</button><a href="/checkout">Check out</a>';
const WRAPPED: Partial<Record<CartCase['answer'], string>> = {
  'wrapped-drawer': `<div id="cd" style="position:fixed;inset:0;z-index:60;visibility:hidden;display:flex;justify-content:flex-end"><div style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div><div style="position:relative;width:420px;height:100%;background:#fff;padding:24px;box-sizing:border-box">${CART_LINES}</div></div>`,
  'sliding-drawer': `<div style="position:fixed;inset:0;z-index:60;pointer-events:none;display:flex;justify-content:flex-end;overflow:hidden"><div id="cd-back" style="position:absolute;inset:0;background:#000;opacity:0"></div><div id="cd-panel" style="position:relative;width:420px;height:100%;background:#fff;padding:24px;box-sizing:border-box;transform:translateX(100%);pointer-events:auto">${CART_LINES}</div></div>`,
};

function productPage(c: CartCase): string {
  const button = c.soldOut ? '<button type="submit" name="add" disabled>Sold out</button>' : '<button type="submit" name="add" style="width:300px;height:48px">Add to cart</button>';
  const add = c.answer === 'checkout' ? '' : "await fetch('/cart/add.js', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ id: 111, quantity: 1 }] }) }); fetch('https://www.google-analytics.com/g/collect?en=add_to_cart').catch(function () {}); document.querySelector('.cart-count-bubble').textContent = '1';";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif}</style></head><body>
    <header style="height:72px;display:flex;justify-content:space-between;align-items:center;padding:0 24px"><a href="/">Socks Co</a><span class="cart-count-bubble">0</span></header>
    <main style="padding:40px"><h1>Merino socks</h1><p>$18.00</p>
      <form action="/cart/add" method="post" id="f"><input type="hidden" name="id" value="111">${button}</form>
      <div class="shopify-payment-button"><button style="width:300px;height:48px">Buy it now</button></div>
    </main><section style="height:1600px"></section>
    ${WRAPPED[c.answer] ?? ''}
    <script>document.getElementById('f').addEventListener('submit', async function (e) { e.preventDefault(); ${add} ${ANSWERS[c.answer]} });</script>
  </body></html>`;
}

const cartCases: CartCase[] = [
  { name: 'cart: the store answers with its cart drawer', answer: 'drawer', want: { response: 'drawer', confidence: 'high', panelType: 'cart-drawer', cartDrawer: true, filled: true, analyticsBlocked: true } },
  { name: 'cart: drawer inside a hidden full-screen wrapper', answer: 'wrapped-drawer', want: { response: 'drawer', confidence: 'high', panelType: 'cart-drawer', cartDrawer: true, filled: true } },
  { name: 'cart: drawer slid in from off the screen', answer: 'sliding-drawer', want: { response: 'drawer', confidence: 'high', panelType: 'cart-drawer', cartDrawer: true, filled: true } },
  { name: 'cart: the store answers with a small notice', answer: 'toast', want: { response: 'toast', confidence: 'high', panelType: 'add-to-cart-toast', filled: true } },
  { name: 'cart: the store goes to its cart page', answer: 'redirect', want: { response: 'redirect', confidence: 'high', filled: true } },
  { name: 'cart: a button that starts a checkout is stopped', answer: 'checkout', want: { confidence: 'low', error: 'checkout-attempt', filled: true, checkoutBlocked: true } },
  { name: 'cart: a sold-out product is left alone', answer: 'drawer', soldOut: true, want: { confidence: 'low', error: 'no-atc', filled: false } },
  { name: 'cart: not a Shopify store, never tried', answer: 'drawer', platform: 'woocommerce', want: { confidence: 'low', error: 'not-shopify', filled: false } },
];

async function runCart(browser: Browser, c: CartCase, dir: string): Promise<{ ok: boolean; said: string }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  let count = 0;
  let checkoutReached = false;
  // The pretend store. The cart guards are installed later, so they see every request first.
  await context.route('https://shop.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/products/socks') return route.fulfill({ contentType: 'text/html', body: productPage(c) });
    if (u.pathname === '/cart/add.js') {
      count = 1;
      return route.fulfill({ contentType: 'application/json', body: '{"items":[{"id":111}]}' });
    }
    if (u.pathname === '/cart.js') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ item_count: count }) });
    if (u.pathname === '/cart') return route.fulfill({ contentType: 'text/html', body: '<h1>Your cart</h1><p>Merino socks $18.00 Quantity 1</p>' });
    if (u.pathname.startsWith('/checkouts')) checkoutReached = true;
    return route.fulfill({ contentType: 'text/html', body: '<p>page</p>' });
  });
  await context.route('https://www.google-analytics.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  const page = await context.newPage();
  try {
    await page.goto('https://shop.test/products/socks');
    let filled: string | null = null;
    const mctx: MomentContext = {
      vp: 'desktop', pageDir: dir, quality: 70, pageType: 'product', kinds: ['add-to-cart', 'cart-drawer'], platform: c.platform ?? 'shopify',
      cart: { context, analyticsHosts: ['google-analytics.com'], pace: async () => {}, onFill: (origin) => (filled = origin) },
    };
    const res = await runMoments(page, mctx);
    const done = await finalizeMoments([res], dir, 'desktop', 5);
    const add = done.moments.find((m) => m.kind === 'add-to-cart');
    const drawer = done.moments.find((m) => m.kind === 'cart-drawer');
    const panel = add?.panelRef ? done.panels.find((p) => p.ref === add.panelRef) : undefined;
    const said = `${done.moments.map((m) => `${m.kind} ${m.confidence}${m.response ? ' ' + m.response : ''}${m.error ? ' ' + m.error : ''}`).join('; ') || 'no moment'}${panel ? ` -> block ${panel.typeHint}` : ''}; filled ${filled ? 'yes' : 'no'}; checkout aborted ${res.cart?.guards.checkoutAborts.length ?? 0}, analytics aborted ${res.cart?.guards.analyticsAborts ?? 0}`;
    const w = c.want;
    const ok =
      !!add && add.confidence === w.confidence && (w.response === undefined || add.response === w.response) && (w.error === undefined || add.error === w.error) &&
      (w.panelType === undefined || panel?.typeHint === w.panelType) && !!drawer === !!w.cartDrawer && !!filled === w.filled && !checkoutReached &&
      (!w.checkoutBlocked || (res.cart?.guards.checkoutAborts.length ?? 0) > 0) && (!w.analyticsBlocked || (res.cart?.guards.analyticsAborts ?? 0) > 0) &&
      // "Buy it now" is never the button pressed.
      (!add.trigger.label || add.trigger.label === 'Add to cart');
    return { ok, said };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const dir = await mkdtemp(path.join(tmpdir(), 'moments-check-'));
  let bad = 0;
  for (const c of cases) {
    const caseDir = path.join(dir, String(cases.indexOf(c)));
    const r = await run(browser, c, caseDir).catch((e) => ({ ok: false, said: 'threw: ' + (e as Error).message.split('\n')[0] }));
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} -> ${r.said}`);
  }
  for (const c of cartCases) {
    const r = await runCart(browser, c, path.join(dir, 'cart-' + cartCases.indexOf(c))).catch((e) => ({ ok: false, said: 'threw: ' + (e as Error).message.split('\n')[0] }));
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} -> ${r.said}`);
  }
  await browser.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  console.log(bad ? `${bad} FAILED` : `all ${cases.length + cartCases.length} moment cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
