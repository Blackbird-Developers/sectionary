// Checks stage 4 (FAQs and accordions, hover, quick view, filters; src/interact-clips.ts and
// src/interact-script.ts) on local pages in Chromium. No network: every request is answered by Playwright, and
// every address asked for is kept, so a visit or a cart request that should have been stopped shows.
//   npm run interact-check
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { interactBlocks, planInteract } from './interact-script.js';
import { recordInteractClips, type InteractResult } from './interact-clips.js';
import { TIME_WARP_SCRIPT } from './time-warp.js';

const ORIGIN = 'https://shop.test';
const DIR = path.resolve('_tmp/interact-check');
const results: { name: string; ok: boolean; said: string }[] = [];
const note = (name: string, ok: boolean, said: string) => {
  results.push({ name, ok, said });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} -> ${said}`);
};
/** Every request that reached the test server (the step's guard stops visits and cart changes before this). */
const asked: { url: string; method: string }[] = [];

async function newContext(browser: Browser, pages: Record<string, string>, phone = false): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, reducedMotion: 'no-preference' });
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  await context.addInitScript(TIME_WARP_SCRIPT);
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    asked.push({ url: u.href, method: route.request().method() });
    if (u.pathname.startsWith('/cart')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const img = u.pathname.match(/^\/img\/([0-9a-f]{6})-(\d+)x(\d+)\.svg$/);
    if (img) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${img[2]}" height="${img[3]}"><rect width="100%" height="100%" fill="#${img[1]}"/><circle cx="50%" cy="50%" r="25%" fill="#fff"/></svg>` });
    const body = pages[u.pathname];
    return body === undefined ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  return context;
}

const doc = (body: string, css = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif}${css}</style></head><body>${body}</body></html>`;
/** A picture with a real address on the test shop (a colour and a white circle), as stores serve them. */
const pic = (c: string, w = 300, h = 300) => `/img/${c.replace('#', '')}-${w}x${h}.svg`;
const more = '<section data-secref="b9" style="height:1200px;padding:40px"><h2>More</h2><p>Soft, warm socks for every season.</p></section>';
const top = '<section data-secref="b0" style="height:500px;background:#eee"><h1>Socks Co</h1></section>';

const answer = (q: string) => `<p style="margin:0;padding:12px 0">Yes. ${q.replace('?', '')} is covered: every pair ships within two days, and returns are free for thirty days.</p>`;
const QUESTIONS = ['Do you ship worldwide?', 'Can I return my socks?', 'Are they machine washable?'];

/** An FAQ made of <details>. */
const faqDetails = (extra = '') =>
  doc(`${top}<section data-secref="b1" class="faq" style="padding:40px;min-height:700px"><h2>Frequently asked questions</h2>
  ${QUESTIONS.map((q) => `<details style="border-bottom:1px solid #ccc"><summary style="padding:16px 0;font-size:20px;cursor:pointer">${q}</summary>${answer(q)}</details>`).join('')}
  </section>${extra}${more}`);

/** An FAQ made of buttons with aria-expanded and aria-controls, toggled by the theme's script. */
const faqButtons = doc(`${top}<section data-secref="b1" class="accordion-section" style="padding:40px;min-height:700px"><h2>Questions</h2>
  ${QUESTIONS.map((q, i) => `<div class="accordion__item"><button type="button" class="accordion__title" aria-expanded="false" aria-controls="ans${i}" style="display:block;width:100%;text-align:left;padding:16px 0;font-size:20px;background:none;border:0;border-bottom:1px solid #ccc">${q}</button><div id="ans${i}" hidden>${answer(q)}</div></div>`).join('')}
  </section>${more}
  <script>document.querySelectorAll('.accordion__title').forEach(function(b){b.addEventListener('click',function(){var open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',open?'false':'true');document.getElementById(b.getAttribute('aria-controls')).hidden=open;});});</script>`);

/** A product page's details accordion. */
const productAccordion = doc(`${top}<section data-secref="b1" class="product-info" style="padding:40px;min-height:600px"><h2>Cosy Socks</h2>
  <details><summary style="padding:14px 0;font-size:18px">Description</summary><p>Merino wool, reinforced heel and toe, made in Portugal.</p></details>
  <details><summary style="padding:14px 0;font-size:18px">Ingredients</summary><p>80% merino wool, 18% nylon, 2% elastane.</p></details>
  </section>${more}`);

/** A footer with collapsible link groups and a header with a menu toggle: neither is an FAQ. */
const chromeOnly = doc(`<header data-secref="b0" style="height:80px"><button aria-expanded="false" aria-controls="m">Menu</button><nav id="m" hidden><a href="/a">A</a></nav></header>
  <section data-secref="b1" style="height:600px;padding:40px"><h2>Our story</h2><p>We knit socks.</p></section>
  <footer data-secref="b2" style="padding:40px"><details><summary>Shop?</summary><a href="/socks">Socks</a></details><details><summary>Help?</summary><a href="/help">Help</a></details></footer>${more}`);

const CARD_CSS = '.grid{display:grid;grid-template-columns:repeat(auto-fill,300px);gap:24px;padding:40px 24px}.card{position:relative;width:300px}.card__media{position:relative;width:300px;height:300px}.card__media img{position:absolute;inset:0;width:100%;height:100%;transition:opacity .4s}.card__media .img2{opacity:0}.card:hover .card__media .img2{opacity:1}.qv{position:absolute;left:20px;right:20px;top:240px;opacity:0;padding:10px}.card:hover .qv{opacity:1}';
const card = (i: number, extra = '') => `<div class="card"><a href="/products/sock-${i}"><div class="card__media"><img class="img1" src="${pic(['#264653', '#2a9d8f', '#e9c46a'][i % 3])}" alt=""><img class="img2 secondary-image" src="${pic(['#e76f51', '#f4a261', '#8ab17d'][i % 3])}" alt=""></div><h3>Sock ${i}</h3></a><p>$24.00</p>${extra}</div>`;
/** A product grid whose cards show a second photo on hover. */
const hoverGrid = (extra = (_i: number) => '', css = CARD_CSS) => doc(`${top}<section data-secref="b1" class="featured-collection"><h2>Best sellers</h2><div class="grid">${[1, 2, 3].map((i) => card(i, extra(i))).join('')}</div></section>${more}`, css);

/** A quick view modal, opened by the card's button, closed by Escape or its close button. */
const quickModal = `<div id="qv" role="dialog" aria-modal="true" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50">
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;height:480px;background:#fff;display:flex;gap:24px;padding:24px;box-sizing:border-box">
  <img src="${pic('#264653', 360, 420)}" alt="" style="width:360px;height:420px"><div><h2>Sock 1</h2><p>$24.00</p><button type="button">Add to cart</button></div>
  <button type="button" aria-label="Close" style="position:absolute;right:8px;top:8px;width:36px;height:36px" onclick="document.getElementById('qv').style.display='none'">×</button></div></div>
  <script>window.openQv=function(){document.getElementById('qv').style.display='block'};document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('qv').style.display='none'})</script>`;
const quickGrid = (button: (i: number) => string) => hoverGrid((i) => button(i), CARD_CSS.replace('.card:hover .card__media .img2{opacity:1}', '')).replace('</body>', `${quickModal}</body>`);

/** A collection page with a "Filter and sort" button that opens a drawer. */
const filterDrawer = doc(`${top}<section data-secref="b1" class="collection-toolbar" style="padding:20px 40px;height:80px"><button type="button" id="fb" aria-expanded="false" style="padding:12px 20px">Filter and sort</button></section>
  <section data-secref="b2" class="collection-grid"><div class="grid">${[1, 2, 3].map((i) => card(i)).join('')}</div></section>${more}
  <div id="drawer" style="display:none;position:fixed;top:0;right:0;bottom:0;width:420px;background:#fff;box-shadow:0 0 20px #0004;z-index:60;padding:24px;box-sizing:border-box">
  <h2>Filter</h2><button type="button" aria-label="Close drawer" class="drawer__close" onclick="document.getElementById('drawer').style.display='none'">×</button>
  <details open><summary>Size</summary><label><input type="checkbox"> S</label><label><input type="checkbox"> M</label><label><input type="checkbox"> L</label></details>
  <details open><summary>Colour</summary><label><input type="checkbox"> Red</label><label><input type="checkbox"> Blue</label></details>
  <details open><summary>Availability</summary><label><input type="checkbox"> In stock</label></details></div>
  <script>document.getElementById('fb').addEventListener('click',function(){document.getElementById('drawer').style.display='block';this.setAttribute('aria-expanded','true')})</script>`, CARD_CSS);

/** A collection page with filter groups that open in place, under the toggle. */
const filterGroups = doc(`${top}<section data-secref="b1" class="facets-container" style="padding:20px 40px;height:90px"><form class="facets" id="FacetFiltersForm" style="display:flex;gap:16px">
  <details class="facets__disclosure" style="position:relative"><summary style="padding:12px 16px;border:1px solid #999">Price</summary><div class="facets__display" style="position:absolute;top:48px;left:0;width:340px;background:#fff;border:1px solid #999;padding:20px;z-index:5">From <input type="number" value="0" style="width:80px"> To <input type="number" value="60" style="width:80px"><p>The highest price is $60.00</p></div></details>
  <details class="facets__disclosure" style="position:relative"><summary style="padding:12px 16px;border:1px solid #999">Size</summary><div class="facets__display" style="position:absolute;top:48px;left:0;width:240px;background:#fff;border:1px solid #999;padding:20px;z-index:5"><label><input type="checkbox"> S</label><label><input type="checkbox"> M</label></div></details>
  </form></section><section data-secref="b2" class="collection-grid"><div class="grid">${[1, 2, 3].map((i) => card(i)).join('')}</div></section>${more}`, CARD_CSS.replace('.card:hover .card__media .img2{opacity:1}', ''));

/** A filter button that opens a bar of filter groups inside the page, not a layer over it (antoniasaintny.com). */
const filterBar = doc(`${top}<section data-secref="b1" class="filter-bar" style="padding:16px 40px"><button type="button" class="filter-bar__button" aria-expanded="false" aria-controls="fbf" style="padding:10px 18px">Filter</button>
  <div id="fbf" class="filter-bar__filters" hidden style="display:flex;gap:12px;padding:14px 0"><button type="button">Size</button><button type="button">Colour</button><button type="button">Price</button><button type="button">Availability</button></div></section>
  <section data-secref="b2" class="collection-grid"><div class="grid">${[1, 2, 3].map((i) => card(i)).join('')}</div></section>${more}
  <script>var fb=document.querySelector('.filter-bar__button');fb.addEventListener('click',function(){var o=fb.getAttribute('aria-expanded')==='true';fb.setAttribute('aria-expanded',o?'false':'true');document.getElementById('fbf').hidden=o;});</script>`, CARD_CSS.replace('.card:hover .card__media .img2{opacity:1}', ''));

/** A card with one photo only (nothing to show on hover). */
const plainCard = (i: number) => `<div class="card"><a href="/products/plain-${i}"><div class="card__media"><img class="img1" src="${pic('#6d597a')}" alt=""></div><h3>Plain ${i}</h3></a><p>$18.00</p></div>`;
/** Two rows: one card with a second photo in the first, two in the second. */
const twoRows = doc(`${top}<section data-secref="b1" class="collection"><div class="grid" style="grid-template-columns:repeat(3,300px)">${plainCard(1)}${plainCard(2)}${card(3)}${card(4)}${card(5)}${plainCard(6)}</div></section>${more}`, CARD_CSS);

/** A theme's own accordion: a clickable title before an answer collapsed to no height, no <details>, no aria (buyhi.co). */
const classAccordion = doc(`${top}<section data-secref="b1" class="product-info" style="padding:40px;min-height:600px"><h2>Detox Crystals</h2><div class="td-accordion">
  <div class="td-accordion__item"><div class="td-accordion__toggle" style="cursor:pointer;padding:16px 0;font-size:18px">Details</div><div class="td-accordion__content" style="height:0;overflow:hidden"><p style="margin:0;padding:10px 0">The most important part of your daily wellness routine, in a crystal you stir into water.</p></div></div>
  <div class="td-accordion__item"><div class="td-accordion__toggle" style="cursor:pointer;padding:16px 0;font-size:18px">How To Prepare</div><div class="td-accordion__content" style="height:0;overflow:hidden"><p style="margin:0;padding:10px 0">Start with a low dose.</p></div></div>
  </div></section>${more}
  <script>document.querySelectorAll('.td-accordion__toggle').forEach(function(t){t.addEventListener('click',function(){var c=t.nextElementSibling;c.style.height=c.style.height==='0px'?'auto':'0px';});});</script>`);

type Run = { page: Page; context: BrowserContext; r: InteractResult };
async function run(browser: Browser, html: string, sub: string, opts: { phone?: boolean; pageType?: string; skip?: string[] } = {}): Promise<Run> {
  const context = await newContext(browser, { '/': html }, opts.phone);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.waitForTimeout(400);
  const env = { context, framesRoot: path.join(DIR, '_frames', sub), maxClips: 4, touch: !!opts.phone, log: () => {} };
  const r = await recordInteractClips(page, env, { pageDir: path.join(DIR, sub), vp: opts.phone ? 'mobile' : 'desktop', quality: 85, firstIndex: 10, skip: new Set(opts.skip ?? []), pageType: opts.pageType ?? 'home' });
  return { page, context, r };
}
const said = (r: InteractResult) => r.notes.join(' · ') || 'no notes';
const clipOn = (r: InteractResult, ref: string) => r.clips.find((c) => c.ref === ref && c.verdict === 'recorded');

async function planChecks(browser: Browser): Promise<void> {
  const plan = async (html: string, name: string, test: (found: string[]) => boolean, opts: { phone?: boolean; pageType?: string } = {}) => {
    const context = await newContext(browser, { '/': html }, opts.phone);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.waitForTimeout(300);
    const targets = await page.evaluate(interactBlocks, { max: 4, skip: [], desktop: !opts.phone, pageType: opts.pageType ?? 'home' });
    const found: string[] = [];
    for (const t of targets) {
      const p = await page.evaluate(planInteract, { ref: t.ref, kind: t.kind });
      found.push(`${t.ref} ${t.kind}${p.ok ? `/${p.mode}` : ' (no plan)'} ${t.why}`);
    }
    note(name, test(found), found.join(', ') || 'nothing');
    await context.close();
  };
  await plan(faqDetails(), 'plan: an FAQ of <details> questions', (f) => f.length === 1 && f[0].startsWith('b1 faq/press faq'));
  await plan(faqButtons, 'plan: an FAQ of aria-expanded buttons', (f) => f.length === 1 && f[0].startsWith('b1 faq/press'));
  await plan(productAccordion, "plan: a product page's Description and Ingredients", (f) => f.length === 1 && /accordion "Description"/.test(f[0]));
  await plan(chromeOnly, 'plan: a menu toggle and footer link groups are not FAQs', (f) => f.length === 0);
  await plan(hoverGrid(), 'plan: product cards with a second photo on hover', (f) => f.some((x) => x.startsWith('b1 hover/hover')));
  await plan(hoverGrid(), 'plan: no hover on a phone', (f) => !f.some((x) => x.includes('hover')), { phone: true });
  await plan(quickGrid((i) => (i === 1 ? '<button type="button" class="qv quick-view-button" onclick="openQv()">Quick view</button>' : '')), 'plan: a card\'s quick view button (shown on hover)', (f) => f.some((x) => x.startsWith('b1 quickview/drawer')));
  await plan(quickGrid((i) => `<form action="/cart/add" method="post"><button type="submit" class="quick-add__submit">Add to cart</button></form>${i === 0 ? '' : ''}`), 'plan: a quick add to cart is never a quick view', (f) => !f.some((x) => x.includes('quickview')));
  await plan(quickGrid((i) => (i === 2 ? '<button type="button" aria-haspopup="dialog" class="quick-add__submit" onclick="openQv()">Choose options</button>' : '')), 'plan: "Choose options" that opens a dialog is a quick view', (f) => f.some((x) => x.includes('quickview/drawer')));
  await plan(filterDrawer, 'plan: a "Filter and sort" button opens a drawer', (f) => f.some((x) => x.startsWith('b1 filters/drawer')), { pageType: 'collection' });
  await plan(filterGroups, 'plan: filter groups that open in place', (f) => f.some((x) => x.startsWith('b1 filters/group')), { pageType: 'collection' });
  await plan(filterDrawer, 'plan: no filters on a home page', (f) => !f.some((x) => x.includes('filters')), { pageType: 'home' });
  await plan(quickGrid((i) => (i === 1 ? '<button type="button" class="qv quick-add" onclick="openQv()">Quick add +</button>' : '')), 'plan: "Quick add +" adds to the cart: never a quick view', (f) => !f.some((x) => x.includes('quickview')));
  await plan(twoRows, 'plan: hover cards come from one row', (f) => f.some((x) => /hover over 2 product cards/.test(x)));
  await plan(classAccordion, "plan: a theme's own accordion without <details> or aria", (f) => f.length === 1 && /accordion \"Details\"/.test(f[0]));
}

async function recordChecks(browser: Browser): Promise<void> {
  {
    const { page, context, r } = await run(browser, faqDetails(), 'faq-details');
    const c = clipOn(r, 'b1');
    const closed = await page.evaluate(() => Array.from(document.querySelectorAll('details')).every((d) => !d.open));
    note('faq: a <details> question opens, recorded on the section', !!c && !!c.rect && c.rect.height > 40, said(r));
    note('faq: the question is closed again after', closed, closed ? 'all closed' : 'one left open');
    await context.close();
  }
  {
    const { page, context, r } = await run(browser, faqButtons, 'faq-buttons');
    const back = await page.evaluate(() => Array.from(document.querySelectorAll('.accordion__title')).every((b) => b.getAttribute('aria-expanded') === 'false'));
    note("faq: a theme's aria-expanded question opens and is recorded", !!clipOn(r, 'b1'), said(r));
    note('faq: pressed again after, so it closes', back, back ? 'closed' : 'left open');
    await context.close();
  }
  {
    const { page, context, r } = await run(browser, classAccordion, 'faq-class');
    const closed = await page.evaluate(() => Array.from(document.querySelectorAll('.td-accordion__content')).every((c) => (c as HTMLElement).style.height === '0px'));
    note("faq: a theme's own accordion opens and is recorded", !!clipOn(r, 'b1'), said(r));
    note("faq: the theme's accordion is closed again after", closed, closed ? 'closed' : 'left open');
    await context.close();
  }
  {
    const { context, r } = await run(browser, faqDetails(), 'faq-phone', { phone: true });
    note('faq on a phone: tapped and recorded', !!clipOn(r, 'b1'), said(r));
    await context.close();
  }
  {
    const { context, r } = await run(browser, faqDetails(), 'faq-skip', { skip: ['b1'] });
    note('a section that already has a clip gets no FAQ clip', !r.clips.length, said(r));
    await context.close();
  }
  {
    const { context, r } = await run(browser, hoverGrid(), 'hover');
    note('hover: the cards show their second photo, recorded on the section', !!clipOn(r, 'b1'), said(r));
    await context.close();
  }
  {
    // Second photos marked as such, but the theme never shows them: nothing changes, so no clip.
    const { context, r } = await run(browser, hoverGrid(() => '', CARD_CSS.replace('.card:hover .card__media .img2{opacity:1}', '')), 'hover-static');
    note('hover: cards that do not change give no clip', !r.clips.length && /no-change/.test(said(r)), said(r));
    await context.close();
  }
  {
    asked.length = 0;
    const { page, context, r } = await run(browser, quickGrid((i) => (i === 1 ? '<button type="button" class="qv quick-view-button" onclick="openQv()">Quick view</button>' : '')), 'quickview');
    const blk = r.blocks.find((b) => b.typeHint === 'quick-view');
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('qv')!).display === 'none');
    note('quick view: the panel becomes a quick-view block with its clip', !!blk && !!clipOn(r, blk.ref), said(r));
    note('quick view: closed again after', hidden, hidden ? 'closed' : 'still open');
    await context.close();
  }
  {
    asked.length = 0;
    // A "Quick shop" whose script adds to the cart before it opens the panel: the cart request never leaves.
    const { context, r } = await run(browser, quickGrid((i) => (i === 1 ? `<button type="button" class="qv quick-shop" onclick="fetch('/cart/add.js',{method:'POST',body:'id=1'}).catch(function(){});openQv()">Quick shop</button>` : '')), 'quickshop-cart');
    const cart = asked.some((a) => a.url.includes('/cart/add') && a.method === 'POST');
    note('quick view: a cart request the button fires is stopped', !cart, `${cart ? 'cart request reached the store' : 'no cart request'} · ${said(r)}`);
    await context.close();
  }
  {
    asked.length = 0;
    const { page, context, r } = await run(browser, quickGrid((i) => (i === 1 ? '<a class="qv quick-view-link" href="/products/sock-1?view=quick">Quick view</a>' : '')), 'quick-leave');
    const stayed = new URL(page.url()).pathname === '/';
    const visited = asked.some((a) => a.url.includes('view=quick'));
    note('quick view: a link that would leave the page is held, nothing kept', stayed && !visited && !r.blocks.length, `${stayed ? 'stayed' : 'left'} · ${said(r)}`);
    await context.close();
  }
  {
    const { page, context, r } = await run(browser, filterDrawer, 'filter-drawer', { pageType: 'collection' });
    const blk = r.blocks.find((b) => b.typeHint === 'filter-panel');
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('drawer')!).display === 'none');
    note('filters: the drawer becomes a filter-panel block with its clip', !!blk && !!clipOn(r, blk.ref), said(r));
    note('filters: the drawer is closed again after', hidden, hidden ? 'closed' : 'still open');
    await context.close();
  }
  {
    const { page, context, r } = await run(browser, filterGroups, 'filter-group', { pageType: 'collection' });
    const blk = r.blocks.find((b) => b.typeHint === 'filter-panel');
    const closed = await page.evaluate(() => Array.from(document.querySelectorAll('details')).every((d) => !d.open));
    const ticked = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="checkbox"]')).some((i) => (i as HTMLInputElement).checked));
    note('filters: a group that opens in place becomes a filter-panel block', !!blk && !!clipOn(r, blk.ref), said(r));
    note('filters: the group is closed again and nothing was ticked', closed && !ticked, `${closed ? 'closed' : 'open'} · ${ticked ? 'ticked!' : 'nothing ticked'}`);
    await context.close();
  }
  {
    const { context, r } = await run(browser, filterDrawer, 'filter-phone', { pageType: 'collection', phone: true });
    note('filters on a phone: the drawer is tapped open and recorded', r.blocks.some((b) => b.typeHint === 'filter-panel'), said(r));
    await context.close();
  }
  {
    const { page, context, r } = await run(browser, filterBar, 'filter-bar', { pageType: 'collection' });
    const closed = await page.evaluate(() => document.querySelector('.filter-bar__button')!.getAttribute('aria-expanded') === 'false');
    note('filters: a button that only opens a bar inside the page gives no clip', !r.blocks.some((b) => b.typeHint === 'filter-panel'), said(r));
    note('filters: that bar is closed again after', closed, closed ? 'closed' : 'still open');
    await context.close();
  }
}

async function main(): Promise<void> {
  await rm(DIR, { recursive: true, force: true });
  await mkdir(DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    await planChecks(browser);
    await recordChecks(browser);
  } finally {
    await browser.close();
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} of ${results.length} FAILED` : `all ${results.length} interaction cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
