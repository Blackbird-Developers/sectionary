// Checks the block types collectBlocks() gives, above all for Shopify sections whose key is only an ID
// (a UUID, the theme editor's timestamp key): those came out as types like "1148845a-a334-49ac-..." and
// filled a third of the wall's Block filter (handover of 10 Nov 2026). Pins the normal keys too.
// Local HTML only, no network:  npm run type-hint-check
import { chromium } from 'playwright';
import { collectBlocks } from './page-script.js';

const words = '<p>Soft, warm and made to last. Free delivery over 50.</p>';
const sec = (key: string, cls: string, inner: string, idOverride?: string) =>
  `<div id="${idOverride ?? `shopify-section-template--15921970937904__${key}`}" class="shopify-section ${cls}" style="min-height:260px">${inner}</div>`;
const idOf = (key: string) => `shopify-section-template--15921970937904__${key}`;
// A section taller than two screens, cut into its three rows.
const tall = (key: string, cls: string, ids: string[]) =>
  sec(key, cls, ids.map((id) => `<div id="${id}" style="height:800px">${words}</div>`).join(''));

type Case = [name: string, id: string, want: string];

// Page 1: a Shopify page, cut by its sections.
const shopifyPage = [
  sec('1148845a-a334-49ac-8a50-943995d6922a', '', `<div class="banner banner--medium"><h2>Autumn edit</h2>${words}</div>`),
  sec('16359276425da8ce', 'section-featured-blog', `<h2>From the journal</h2>${words}`),
  sec('', '', `<div data-section-type="slideshow"><h2>Welcome</h2>${words}</div>`, 'shopify-section-1566389874427'),
  sec('1695849321ce59c7f4', '', `<div data-section-type="template--23023421489227__1695849321ce59c7f4"><h2>Frequently asked questions</h2>${words}</div>`),
  sec('d0359d86-9115-47a8-9629-183f723f6a85', '', `<div class="page-width"><div class="jdgm-widget jdgm-all-reviews-widget">${words}</div></div>`),
  sec('ee59d8dd-b588-478f-a607-ab76c36795ef', '', `<div class="page-width"><h2>Follow us on Instagram</h2>${words}</div>`),
  sec('aa2fa821-d194-4d29-96f1-3078ccd4d2e3', '', `<div class="page-width">${words}</div>`),
  sec('ad1c7de4-6c16-4f51-815d-9fe8f7a3a997', 'section', `<div class="page-width">${words}</div>`),
  sec('shogun-custom-html-2660ea50-7bd9-4956-ba0d-02d2a9e15c3f', '', words),
  sec('4f1a2b3c-1111-4abc-9def-123456789abc', 'shopify-section-group-footer-group', `<div class="page-width">${words}</div>`),
  sec('5e2b0c1d-2222-4abc-9def-123456789abc', 'shopify-section-group-footer-group', `<div class="newsletter-band"><h2>Stay in touch</h2><form><input type="email"></form></div>`),
  sec('hero_banner_kCjXcf', '', words),
  sec('image_banner', '', words),
  sec('featured_collection', '', words),
  sec('footer_custom_dpdhwt', '', words),
  sec('header_section', '', words),
  sec('faq', '', words),
  sec('ugc', '', words),
  sec('cta', '', words),
  `<div id="${idOf('9c5da0f1-c889-4605-b984-76dda1172e0f')}" class="shopify-section announcement-bar" style="height:90px">${words}</div>`,
  sec('0bd0aa05-5019-4993-a92b-91ae82356f18', 'index-section', `<div class="site-box-container"><div class="site-box box__announcement" style="height:400px">${words}</div></div>`),
  tall('bb67cc6a-99fa-42b6-a9c1-1648475d0f00', '', ['x1a', 'x1b', 'x1c']),
  tall('1727714570224b3728', 'section-lookbook', ['x2a', 'x2b', 'x2c']),
].join('');

const shopifyCases: Case[] = [
  ['UUID key, Dawn-style first child', idOf('1148845a-a334-49ac-8a50-943995d6922a'), 'banner'],
  ['timestamp key, name in the wrapper class', idOf('16359276425da8ce'), 'featured-blog'],
  ['old theme millisecond key, data-section-type inside', 'shopify-section-1566389874427', 'slideshow'],
  ['data-section-type that is an ID, FAQ heading', idOf('1695849321ce59c7f4'), 'faq'],
  ['UUID key holding a review app widget', idOf('d0359d86-9115-47a8-9629-183f723f6a85'), 'review'],
  ['UUID key, Instagram heading only', idOf('ee59d8dd-b588-478f-a607-ab76c36795ef'), 'instagram'],
  ['UUID key, nothing to go on', idOf('aa2fa821-d194-4d29-96f1-3078ccd4d2e3'), 'unknown'],
  ['UUID key the clean-up cuts short', idOf('ad1c7de4-6c16-4f51-815d-9fe8f7a3a997'), 'unknown'],
  ['name followed by a UUID (Shogun)', idOf('shogun-custom-html-2660ea50-7bd9-4956-ba0d-02d2a9e15c3f'), 'shogun-custom-html'],
  ['UUID key in the footer group', idOf('4f1a2b3c-1111-4abc-9def-123456789abc'), 'footer'],
  ['UUID key in the footer group, newsletter band', idOf('5e2b0c1d-2222-4abc-9def-123456789abc'), 'newsletter'],
  ['editor key keeps its name', idOf('hero_banner_kCjXcf'), 'hero-banner'],
  ['plain-word key keeps its last word (was "image")', idOf('image_banner'), 'image-banner'],
  ['plain-word key keeps its last word (was "featured")', idOf('featured_collection'), 'featured-collection'],
  ['lower-case random tag goes', idOf('footer_custom_dpdhwt'), 'footer-custom'],
  ['"-section" adds nothing', idOf('header_section'), 'header'],
  ['short real name: faq', idOf('faq'), 'faq'],
  ['short real name: ugc', idOf('ugc'), 'ugc'],
  ['short real name: cta', idOf('cta'), 'cta'],
  ['UUID key, thin announcement bar', idOf('9c5da0f1-c889-4605-b984-76dda1172e0f'), 'announcement'],
  ['a tall content row called announcement is not the bar', idOf('0bd0aa05-5019-4993-a92b-91ae82356f18'), 'unknown'],
  ['piece of a tall UUID section: no "<id>-part"', 'x1a', 'unknown'],
  ['piece of a tall UUID section: no "<id>-part" (2)', 'x1c', 'unknown'],
  ['piece of a tall section named by its wrapper class', 'x2b', 'lookbook-part'],
];

// Page 2: no Shopify sections, cut by its tags.
const plainPage = [
  '<header id="c1" style="height:80px"><a href="/">Socks Co</a></header>',
  `<section id="c2" class="hero-area" style="min-height:400px"><h1>Big sale</h1>${words}</section>`,
  `<section id="c3" style="min-height:300px"><div class="testimonial-slider">${words}</div></section>`,
  `<section id="c4" style="min-height:300px"><div class="wrap"><h2>Customer reviews</h2>${words}</div></section>`,
  `<section id="c5" style="min-height:300px"><div class="section-header"><h2>Shop the range</h2></div><div class="product-grid">${words}</div></section>`,
  `<section id="c6" style="min-height:300px"><div class="grid"><div class="card"><div class="card-info"><div class="jdgm-widget jdgm-preview-badge">5 stars</div>${words}</div></div></div><h2>Shop the range</h2></section>`,
  `<section id="c7" style="min-height:300px">${words}</section>`,
  `<footer id="c8" style="min-height:200px">${words}</footer>`,
].join('');

const plainCases: Case[] = [
  ['header tag', 'c1', 'header'],
  ['class keyword on the block', 'c2', 'hero'],
  ['class keyword on the first child', 'c3', 'testimonial'],
  ['heading only', 'c4', 'review'],
  ['a title row called section-header is not a header', 'c5', 'product'],
  ['a star badge deep in a product card is not a review', 'c6', 'unknown'],
  ['nothing to go on', 'c7', 'unknown'],
  ['footer tag', 'c8', 'footer'],
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Same shim as the crawler: functions sent into the page still call tsx's __name helper.
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  const page = await ctx.newPage();
  let bad = 0;
  let count = 0;
  for (const [title, html, cases] of [['Shopify page', shopifyPage, shopifyCases], ['plain page', plainPage, plainCases]] as const) {
    await page.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body>${html}</body></html>`, { waitUntil: 'domcontentloaded' });
    const got = await page.evaluate(collectBlocks, { minHeight: 80, maxBlocks: 40 });
    console.log(`${title}: cut by ${got.strategy}, ${got.blocks.length} blocks`);
    const byId = new Map(got.blocks.map((b) => [b.id, b.typeHint]));
    for (const [name, id, want] of cases) {
      count++;
      const hint = byId.has(id) ? byId.get(id) : '(no block)';
      const ok = hint === want;
      if (!ok) bad++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(55)} -> ${hint}${ok ? '' : `  (wanted ${want})`}`);
    }
  }
  await browser.close();
  console.log(bad ? `${bad} FAILED` : `all ${count} type cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
