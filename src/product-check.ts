// Checks stage 2 (product pages: gallery thumbnails, product options, size guide; src/product-clips.ts and
// src/product-script.ts) on local pages in Chromium. No network: pages are served from a made-up origin by
// Playwright. Needs ffmpeg on the PATH for the encode case.   npm run product-check
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeClip } from './clip-encode.js';
import { findGallery, findOptions, findSizeGuide, placeOptions } from './product-script.js';
import { recordProductClips } from './product-clips.js';
import { TIME_WARP_SCRIPT } from './time-warp.js';

const ORIGIN = 'https://shop.test';
const DIR = path.resolve('_tmp/product-check');
const results: { name: string; ok: boolean; said: string }[] = [];
const note = (name: string, ok: boolean, said: string) => {
  results.push({ name, ok, said });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} -> ${said}`);
};

async function newContext(browser: Browser, phone = false): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, reducedMotion: 'no-preference' });
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  await context.addInitScript(TIME_WARP_SCRIPT);
  return context;
}

/** Serves `pages` under ORIGIN, counts requests to the cart, opens the first page. */
async function open(context: BrowserContext, pages: Record<string, string>, cartHits: { n: number }): Promise<Page> {
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith('/cart')) {
      cartHits.n++;
      return route.fulfill({ status: 404, body: 'no cart here' });
    }
    const body = pages[p];
    return body === undefined ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto(`${ORIGIN}${Object.keys(pages)[0]}`);
  await page.waitForTimeout(300);
  return page;
}

const doc = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif} .row{display:flex;gap:8px} input:checked+label{background:#111;color:#fff}</style></head><body>${body}</body></html>`;
const colours = ['#e63946', '#2a9d8f', '#e9c46a', '#264653'];
const svg = (c: string, w = 600, h = 600) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${c}"/></svg>`)}`;

const galleryHtml = (thumbs: string) => `
  <div class="product__media" style="width:640px">
    <img id="main" src="${svg(colours[0])}" style="width:600px;height:600px">
    <ul class="row" style="list-style:none;padding:0">${thumbs}</ul>
  </div>
  <script>function show(i){document.getElementById('main').src=${JSON.stringify(colours.map((c) => svg(c)))}[i]}</script>`;
const thumbButtons = colours.map((c, i) => `<li><button type="button" class="thumbnail" aria-label="Load image ${i + 1}" onclick="show(${i})"><img src="${svg(c, 80, 80)}" style="width:80px;height:80px"></button></li>`).join('');
const thumbLinks = colours.map((c, i) => `<li><a href="/products/other-${i}"><img src="${svg(c, 80, 80)}" style="width:80px;height:80px"></a></li>`).join('');

const sizes = ['S', 'M', 'L', 'XL'];
const radioOptions = (soldOut = 'XL') => `
  <fieldset><legend>Size</legend><div class="row">
    ${sizes.map((s, i) => `<input type="radio" id="size-${s}" name="Size" value="${s}" ${i === 0 ? 'checked' : ''} ${s === soldOut ? 'disabled' : ''} onchange="document.getElementById('price').textContent='$'+(20+${i}*5)+'.00'"><label for="size-${s}" style="padding:8px 14px;border:1px solid #333">${s}</label>`).join('')}
  </div></fieldset>`;
const productForm = (opts: string) => `
  <form action="/cart/add" method="post" onsubmit="window.submits=(window.submits||0)+1">
    <input type="hidden" name="id" value="1">
    <p class="price" id="price">$20.00</p>
    ${opts}
    <button type="submit" name="add" style="width:300px;height:48px">Add to cart</button>
  </form>`;
const sizeGuideModal = `
  <button type="button" class="size-guide" onclick="document.getElementById('sg').style.display='block'">Size guide</button>
  <div id="sg" role="dialog" style="display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:600px;height:420px;background:#fff;border:1px solid #333;z-index:50;padding:24px">
    <h2>Size chart</h2><table><tr><td>S</td><td>36</td></tr><tr><td>M</td><td>38</td></tr><tr><td>L</td><td>40</td></tr></table>
    <button type="button" aria-label="Close" onclick="this.parentElement.style.display='none'">×</button>
  </div>
  <div id="sgbg" style="display:none"></div>`;
const productPage = (inner: string) => doc(`<section data-secref="b1" class="main-product" style="display:flex;gap:40px;padding:40px">${inner}</section><section data-secref="b2" style="height:900px"><h2>More</h2></section>`);

async function planChecks(browser: Browser): Promise<void> {
  const hits = { n: 0 };
  const run = async (html: string, fn: (p: Page) => Promise<[boolean, string]>, name: string) => {
    const context = await newContext(browser);
    const page = await open(context, { '/products/socks': html }, hits);
    const [ok, said] = await fn(page);
    note(name, ok, said);
    await context.close();
  };
  await run(productPage(galleryHtml(thumbButtons) + productForm(radioOptions())), async (p) => {
    const g = await p.evaluate(findGallery, 'b1');
    return [g.ok && g.thumbs === 4 && (await p.locator('[data-secthumb]').count()) === 3, `${g.ok ? 'ok' : 'no'} ${g.why}`];
  }, 'gallery: four thumbnail buttons, the 2nd to 4th marked');
  await run(productPage(galleryHtml(thumbLinks) + productForm(radioOptions())), async (p) => {
    const g = await p.evaluate(findGallery, 'b1');
    return [!g.ok, `${g.ok ? 'ok' : 'no'} ${g.why}`];
  }, 'gallery: thumbnails that link to other pages are never used');
  await run(productPage(productForm(radioOptions())), async (p) => {
    const o = await p.evaluate(findOptions);
    const marked = await p.evaluate(() => Array.from(document.querySelectorAll('[data-secopt]')).map((e) => e.textContent).join(','));
    return [o.ok && o.how === 'radio' && o.choices === 2 && marked === 'M,L', `${o.how} ${o.group}: ${marked}`];
  }, 'options: radio sizes, the sold-out one skipped');
  await run(productPage(productForm('<select name="id" style="display:none"><option value="1">S</option><option value="2">M</option></select><label>Colour <select name="Colour"><option>Red</option><option>Teal</option><option disabled>Gold</option><option>Navy</option></select></label>')), async (p) => {
    const o = await p.evaluate(findOptions);
    return [o.ok && o.how === 'select' && o.values.join(',') === 'Teal,Navy' && o.original === 'Red', `${o.how}: ${o.values.join(',')} (from ${o.original})`];
  }, 'options: a visible drop-down, not the hidden variant list');
  await run(productPage(productForm(`<div class="row" role="radiogroup" aria-label="Colour">${['Red', 'Teal', 'Navy'].map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'is-selected' : ''}" aria-label="${c}" style="width:40px;height:40px;background:${colours[i]}"></button>`).join('')}</div>`)), async (p) => {
    const o = await p.evaluate(findOptions);
    return [o.ok && o.how === 'swatch' && o.choices === 2, `${o.how} ${o.why}`];
  }, 'options: swatch buttons');
  await run(productPage(productForm(`<div class="row">${['Red', 'Teal', 'Navy'].map((c, i) => `<a class="swatch" href="/products/socks-${c.toLowerCase()}" aria-label="${c}" style="display:block;width:40px;height:40px;background:${colours[i]}"></a>`).join('')}</div>`)), async (p) => {
    const o = await p.evaluate(findOptions);
    return [!o.ok, `${o.ok ? o.how : 'none'} ${o.why}`];
  }, 'options: colour swatches that link to other products are never used');
  await run(productPage(productForm(`<div class="row">${['Red', 'Teal', 'Navy'].map((c) => `<button class="swatch" aria-label="${c}" style="width:40px;height:40px"></button>`).join('')}</div>`)), async (p) => {
    const o = await p.evaluate(findOptions);
    return [!o.ok, `${o.ok ? o.how : 'none'} ${o.why}`];
  }, 'options: a bare button in the form (it would submit) is never a swatch');
  await run(productPage(`<div class="slideshow"><img src="${svg(colours[0])}" style="width:600px;height:400px"><div class="row"><button type="button" aria-label="Previous slide">‹</button><button type="button" aria-label="Next slide">›</button></div></div>` + productForm('')), async (p) => {
    const o = await p.evaluate(findOptions);
    return [!o.ok, `${o.ok ? o.how : 'none'} ${o.why}`];
  }, "options: a slider's two arrow buttons are not swatches");
  await run(productPage(`<div style="width:520px"><h1>Merino socks</h1><p>The softest socks we make, knitted in Portugal.</p>${productForm(radioOptions())}<details open style="height:600px"><summary>Description</summary><p>Long text</p></details></div>`), async (p) => {
    await p.evaluate(findOptions);
    const at = await p.evaluate(placeOptions);
    return [at.ok && at.box.height < 200 && at.box.width >= 320, `${Math.round(at.box.width)}x${Math.round(at.box.height)}`];
  }, 'options area: just the option groups, not the title or accordion');
  await run(productPage(`<div class="accordion">${['Quick Facts', 'Description'].map((t, i) => `<input type="radio" name="accordion" id="acc-${i}" ${i === 0 ? 'checked' : ''}><label for="acc-${i}" style="display:block;padding:12px">${t}</label>`).join('')}</div>` + productForm(radioOptions())), async (p) => {
    const o = await p.evaluate(findOptions);
    return [o.ok && o.how === 'radio' && o.group === 'Size', `${o.how} ${o.group}`];
  }, 'options: an accordion built from radios is not an option group');
  await run(productPage(productForm(radioOptions()) + sizeGuideModal), async (p) => {
    const s = await p.evaluate(findSizeGuide, 'b1');
    return [s.ok, `${s.ok ? 'ok' : 'no'} "${s.label}"`];
  }, 'size guide: a button that opens a panel');
  await run(productPage(productForm(radioOptions()) + '<a href="/pages/size-chart">Size chart</a>'), async (p) => {
    const s = await p.evaluate(findSizeGuide, 'b1');
    return [!s.ok, `${s.ok ? 'ok' : 'no'} ${s.why}`];
  }, 'size guide: a link to another page is never used');
}

async function recordChecks(browser: Browser): Promise<void> {
  const env = (context: BrowserContext, sub: string, phone = false) => ({ context, framesRoot: path.join(DIR, '_frames', sub), maxClips: 3, touch: phone, log: () => {} });
  // The whole product page: gallery, options, size guide. Nothing may reach the cart.
  {
    const hits = { n: 0 };
    const context = await newContext(browser);
    const page = await open(context, { '/products/socks': productPage(galleryHtml(thumbButtons) + productForm(radioOptions()) + sizeGuideModal) }, hits);
    const pageDir = path.join(DIR, 'full');
    const r = await recordProductClips(page, env(context, 'full'), { pageDir, vp: 'desktop', quality: 85, firstIndex: 3, skip: new Set() });
    const byWhy = (w: string) => r.clips.find((c) => c.why.startsWith(w));
    const g = byWhy('gallery');
    const o = byWhy('options');
    const s = byWhy('size guide');
    note('product page: gallery thumbnails recorded on the product block', !!g && g.verdict === 'recorded' && g.ref === 'b1', g ? `${g.verdict} ${g.error ?? ''} · ${g.why} · slowed x${g.slowdown}` : 'none');
    note('product page: options recorded as a new block', !!o && o.verdict === 'recorded' && r.blocks.some((b) => b.typeHint === 'product-options'), o ? `${o.verdict} ${o.error ?? ''} · ${o.why}` : 'none');
    note('product page: size guide recorded as a new block', !!s && s.verdict === 'recorded' && r.blocks.some((b) => b.typeHint === 'size-guide'), s ? `${s.verdict} ${s.error ?? ''} · ${s.why}` : 'none');
    note('product page: new blocks continue the indexes', r.blocks.map((b) => b.index).join(',') === '3,4', r.blocks.map((b) => `${b.index} ${b.typeHint}`).join(', '));
    const submits = await page.evaluate(() => (window as unknown as { submits?: number }).submits || 0);
    note('product page: nothing was added to a cart', submits === 0 && hits.n === 0, `form submits ${submits}, cart requests ${hits.n}`);
    const back = await page.evaluate(() => (document.querySelector('input[name="Size"]:checked') as HTMLInputElement)?.value);
    note('product page: the first size is chosen again afterwards', back === 'S', `checked: ${back}`);
    const closed = await page.evaluate(() => getComputedStyle(document.getElementById('sg')!).display === 'none');
    note('product page: the size guide is closed again', closed, closed ? 'closed' : 'still open');
    if (s?.verdict === 'recorded' && s.frames && s.framesDir && s.rect) {
      const e = await encodeClip({ framesDir: s.framesDir, frames: s.frames, rect: s.rect, viewportWidth: 1440, frameRegion: s.frameRegion, recordedMs: s.recordedMs || 0, slowdown: s.slowdown, outFile: path.join(DIR, 'size-guide.mp4') });
      note('size guide clip encodes, cut to the panel', e.ok && e.width <= 1080 && Math.abs(e.width / e.height - 600 / 420) < 0.15, e.ok ? `${e.width}x${e.height} ${(e.durationMs / 1000).toFixed(1)}s` : e.error);
    }
    await context.close();
  }
  // A size guide button that opens a blank panel: no block.
  {
    const hits = { n: 0 };
    const context = await newContext(browser);
    const blank = sizeGuideModal.replace(/<h2>Size chart<\/h2><table>.*?<\/table>/, '');
    const page = await open(context, { '/products/socks': productPage(productForm('') + blank) }, hits);
    const r = await recordProductClips(page, env(context, 'blank'), { pageDir: path.join(DIR, 'blank'), vp: 'desktop', quality: 85, firstIndex: 3, skip: new Set() });
    const s = r.clips.find((c) => c.why.startsWith('size guide'));
    note('size guide that opens a blank panel: no block', !r.blocks.length && (!s || s.verdict !== 'recorded'), r.notes.join(' · '));
    await context.close();
  }
  // A size guide button that leaves the page: everything stops, nothing is kept.
  {
    const hits = { n: 0 };
    const context = await newContext(browser);
    const page = await open(context, { '/products/socks': productPage(productForm('') + `<button type="button" onclick="location.href='/pages/sizes'">Size guide</button>`), '/pages/sizes': doc('<h1>Sizes</h1>') }, hits);
    const r = await recordProductClips(page, env(context, 'leaves'), { pageDir: path.join(DIR, 'leaves'), vp: 'desktop', quality: 85, firstIndex: 3, skip: new Set() });
    note('size guide that leaves the page: stopped, nothing kept', !r.blocks.length && !r.clips.some((c) => c.verdict === 'recorded') && r.notes.some((n) => n.startsWith('stopped')), r.notes.join(' · '));
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
  console.log(bad ? `${bad} of ${results.length} FAILED` : `all ${results.length} product cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
