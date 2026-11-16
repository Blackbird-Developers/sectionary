// Checks measureStyles() (SEC-31 design metadata) against small pages whose
// right answer is known. Local HTML only, no network:  npm run styles-check
import { chromium } from 'playwright';
import { measureStyles, STYLE_THRESHOLDS, type OutlineNodeC, type StyleResult } from './style-script.js';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const para = '<p>' + 'Soft socks made from combed cotton, knitted in Portugal and sent in recycled boxes. '.repeat(3) + '</p>';

type Check = [string, boolean, string];
type Case = { name: string; pageType?: string; html: string; check: (r: StyleResult) => Check[] };

const find = (nodes: OutlineNodeC[] | undefined, type: string): OutlineNodeC | undefined => {
  for (const n of nodes || []) {
    if (n.type === type) return n;
    const inner = find(n.children, type);
    if (inner) return inner;
  }
  return undefined;
};

const cases: Case[] = [
  {
    name: 'font stack whose first family is missing',
    html: `<section data-secref="b1" style="font-family: 'NoSuchFamilyXyz', sans-serif; padding: 40px">
      <h2 style="font-family: 'NoSuchFamilyXyz', 'AlsoMissingAbc', serif">Our story</h2>${para}</section>`,
    check: (r) => {
      const fams = r.page.typography.families.map((f) => f.family);
      return [
        ['missing family never reported', !fams.some((f) => /NoSuch|AlsoMissing/.test(f)), fams.join(', ')],
        ['body falls back to sans-serif', r.blocks.b1.style.type.some((t) => t.role === 'body' && t.family === 'sans-serif'), JSON.stringify(r.blocks.b1.style.type.map((t) => [t.role, t.family]))],
        ['heading falls back to serif', r.blocks.b1.style.type.some((t) => t.role === 'heading-2' && t.family === 'serif'), ''],
      ];
    },
  },
  {
    name: 'text over an image (contrast null)',
    html: `<section data-secref="b1" style="position: relative; height: 500px; overflow: hidden">
      <img src="${PX}" alt="Hero" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover">
      <div style="position: relative; padding: 120px 80px; color: #fff"><h1 style="font-size: 56px">Summer edit</h1><p>New colours, same soft cotton.</p></div>
    </section>
    <section data-secref="b2" style="padding: 40px; background: #fff; color: #222">${para}</section>`,
    check: (r) => [
      ['hero contrast is null', r.blocks.b1.style.contrastPass === null, String(r.blocks.b1.style.contrastPass)],
      ['hero background is image', r.blocks.b1.style.background.kind === 'image', r.blocks.b1.style.background.kind],
      ['hero media side is background', r.blocks.b1.style.layout.mediaSide === 'background', r.blocks.b1.style.layout.mediaSide],
      ['plain block passes contrast', r.blocks.b2.style.contrastPass === 1, String(r.blocks.b2.style.contrastPass)],
      ['page share ignores the hero', r.page.colour.contrastPass === 1, String(r.page.colour.contrastPass)],
    ],
  },
  {
    name: 'skipped heading level',
    html: `<section data-secref="b1" style="padding: 40px"><h1>Shop</h1>${para}<h2>Best sellers</h2>${para}<h4>Care guide</h4>${para}
      <div style="font-size: 40px; font-weight: 700">Looks like a heading</div></section>`,
    check: (r) => [
      ['one skip (h2 -> h4)', r.page.headings.skips === 1, String(r.page.headings.skips)],
      ['h1 count 1', r.page.headings.h1Count === 1, String(r.page.headings.h1Count)],
      ['order flagged invalid', r.page.accessibility.headingOrderValid === false, String(r.page.accessibility.headingOrderValid)],
      ['h3 count 0, h4 count 1', r.page.headings.levels[2].count === 0 && r.page.headings.levels[3].count === 1, JSON.stringify(r.page.headings.levels.map((l) => l.count))],
      ['styled-not-marked 1', r.page.headings.styledNotMarked === 1, String(r.page.headings.styledNotMarked)],
    ],
  },
  {
    name: 'two button variants',
    html: `<style>.solid{background:#1f4d3a;color:#fff;border:0;border-radius:24px;height:48px;padding:0 28px;font:600 16px sans-serif}
      .ghost{background:transparent;color:#1f4d3a;border:2px solid #1f4d3a;border-radius:4px;height:44px;padding:0 20px;font:500 15px sans-serif}</style>
      <section data-secref="b1" style="padding: 40px">${para}
        <button class="solid">Shop now</button> <button class="solid">Shop now</button> <button class="solid">Join</button>
        <button class="ghost">Learn more</button> <button class="ghost">Our story</button>
        <button aria-label="Close">×</button></section>`,
    check: (r) => {
      const v = r.page.buttons.variants;
      return [
        ['two variants (icon button ignored)', v.length === 2, JSON.stringify(v.map((x) => [x.background, x.count]))],
        ['solid first, 3 buttons, pill', v[0]?.background === '#1f4d3a' && v[0]?.count === 3 && v[0]?.radius === 24, JSON.stringify(v[0])],
        ['ghost transparent with border', v[1]?.background === null && v[1]?.border === '#1f4d3a', JSON.stringify(v[1])],
        ['primary is the solid one', r.page.buttons.primary === 0, String(r.page.buttons.primary)],
        ['accent is the solid colour', r.page.colour.palette.some((p) => p.role === 'accent' && p.colour === '#1f4d3a'), JSON.stringify(r.page.colour.palette)],
        ['radius label pill', r.page.shape.label === 'pill', String(r.page.shape.label)],
        ['top label "Shop now"', r.page.buttons.labels[0] === 'Shop now', r.page.buttons.labels.join(' | ')],
      ];
    },
  },
  {
    name: 'product grid of 8 in 4 columns',
    pageType: 'collection',
    html: `<section data-secref="b1" style="padding: 40px"><h2>New in</h2>
      <ul style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; list-style: none; padding: 0">
      ${Array.from({ length: 8 }, (_, i) => `<li><a href="/products/sock-${i}"><img src="${PX}" alt="Sock ${i}" style="width: 100%; aspect-ratio: 4 / 5; object-fit: cover"></a>
        <a href="/products/sock-${i}">Sock ${i}</a><div>$${20 + i}.00</div></li>`).join('')}
      </ul></section>`,
    check: (r) => {
      const pc = find(r.blocks.b1.outline, 'product-card');
      return [
        ['outline: 8 product cards', pc?.count === 8, JSON.stringify(r.blocks.b1.outline)],
        ['outline: 4 columns', pc?.columns === 4, String(pc?.columns)],
        ['commerce: 8 products, 4 columns', r.blocks.b1.style.commerce.products === 8 && r.blocks.b1.style.commerce.gridColumns === 4, JSON.stringify(r.blocks.b1.style.commerce)],
        ['page grid columns 4', r.page.layout.gridColumns === 4, String(r.page.layout.gridColumns)],
        ['image ratio 4:5', r.blocks.b1.style.imagery.ratio === '4:5', String(r.blocks.b1.style.imagery.ratio)],
      ];
    },
  },
  {
    name: 'struck-through price',
    pageType: 'product',
    html: `<section data-secref="b1" style="padding: 40px; display: flex; gap: 40px">
      <img src="${PX}" alt="Gift box" style="width: 600px; height: 600px; object-fit: cover">
      <div><h1>Gift box</h1><div class="price"><s>$40.00</s> <span>$30.00</span></div><p>25% off this week. Only 3 left.</p>
        <form action="/cart/add"><select name="size"><option>S</option></select><button style="background:#000;color:#fff;height:48px">Add to cart</button></form></div>
    </section>`,
    check: (r) => {
      const c = r.blocks.b1.style.commerce;
      const price = find(r.blocks.b1.outline, 'price');
      return [
        ['commerce compareAt', c.compareAt === true, JSON.stringify(c)],
        ['outline price compareAt', price?.compareAt === true, JSON.stringify(r.blocks.b1.outline)],
        ['discount text', c.discount === '25% off', String(c.discount)],
        ['urgency', c.urgency === true, String(c.urgency)],
        ['media side left', r.blocks.b1.style.layout.mediaSide === 'left', r.blocks.b1.style.layout.mediaSide],
        ['primary is add to cart', r.page.buttons.primary !== null && r.page.buttons.variants[r.page.buttons.primary].background === '#000000', JSON.stringify(r.page.buttons)],
      ];
    },
  },
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Same shim as the crawler: functions sent into the page still call tsx's __name helper.
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  const page = await ctx.newPage();
  let bad = 0;
  let checks = 0;
  for (const c of cases) {
    await page.setContent(`<!doctype html><html lang="en"><head><style>body{margin:0;font-family:sans-serif;color:#222;background:#fff}</style></head><body>${c.html}</body></html>`, { waitUntil: 'load' });
    const r = await page.evaluate(measureStyles, { t: STYLE_THRESHOLDS, viewport: 'desktop' as const, pageType: c.pageType || 'home' });
    console.log(`\n${c.name}  (${r.page.ms}ms${r.page.partial ? ', partial' : ''})`);
    for (const [label, ok, detail] of c.check(r)) {
      checks++;
      if (!ok) bad++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> ${detail}`}`);
    }
  }
  await browser.close();
  console.log(bad ? `\n${bad} of ${checks} checks FAILED` : `\nall ${checks} checks in ${cases.length} cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
