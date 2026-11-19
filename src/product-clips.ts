// Stage 2 (Ben, 18 Nov 2026): product pages. After the stills, moments and sliders of a product page, three
// interactions are recorded in slow motion, like every clip (src/clips.ts, src/time-warp.ts):
//   1. the photo gallery: its 2nd to 4th thumbnails are clicked (when the slider step left the block without a
//      clip); the clip goes on the product block;
//   2. the product options (size, colour): up to two other available choices are made; a new block,
//      "product-options" (the option pickers and the price), gets the still and the clip; the first choice is
//      put back afterwards;
//   3. the size guide: it is opened, recorded as it appears, and closed again; a new block, "size-guide" (the
//      panel), gets the still and the clip.
// Never add to cart, never a submit button, never a link to another page, never a sold-out choice
// (src/product-script.ts). If the page loads a new document, changes address or opens a tab, it stops at once
// and keeps nothing from that interaction.
import type { Page } from 'playwright';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import sharp from 'sharp';
import { describeOptions, findGallery, findOptions, findSizeGuide, markPanelClose, placeMarked, placeOptions, productBlock, sizePanel } from './product-script.js';
import { describePanel, forceHide, overlayShowing, snapshotOverlays, type Overlay } from './moment-script.js';
import { classOf, diffOverlays } from './moment-logic.js';
import { hidePinned, restorePinned, type BlockInfo } from './page-script.js';
import { changedAnywhere, pressSelector, recordFrames, sliderCrop, step, withLimit, type ClipEnv, type Control, type RawClip } from './clips.js';
import type { Placement } from './clip-script.js';

/** Times are page time (slow motion stretches them), except candidateMs. */
export const PRODUCT_THRESHOLDS = {
  candidateMs: 60_000,
  leadMs: 600,
  gapMs: 1600,
  tailMs: 800,
  /** Size guide: before the press, how long to wait for the panel, and how long to keep recording once it is there. */
  sizeLeadMs: 500,
  sizeOpenMs: 2500,
  sizeHoldMs: 1200,
  /** Every interaction of one page and viewport together. */
  pageMs: 150_000,
};

/** A new block for a panel or area an interaction showed, already photographed into blocks/. */
export type ProductBlock = BlockInfo & { viewport: 'desktop' | 'mobile'; file: string };

export type ProductResult = { clips: RawClip[]; blocks: ProductBlock[]; notes: string[] };

export type ProductContext = {
  pageDir: string;
  vp: 'desktop' | 'mobile';
  quality: number;
  /** The index the first new block gets (after the page's blocks and any moment panels). */
  firstIndex: number;
  /** Blocks that already have a clip. */
  skip: Set<string>;
};

/** A picture that is nearly one flat colour (a panel that had not drawn yet) is not a block. */
async function blank(file: string): Promise<boolean> {
  const st = await sharp(file).stats().catch(() => null);
  if (!st) return true;
  return st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3 < 4;
}

const pathKey = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u;
  }
};

/** Records the three product-page interactions. Never throws. */
export async function recordProductClips(page: Page, env: ClipEnv, ctx: ProductContext): Promise<ProductResult> {
  const res: ProductResult = { clips: [], blocks: [], notes: [] };
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const phone = size.width < 768;
  const start = pathKey(page.url());
  let opened = false;
  let loaded = false;
  const onPage = (p: Page) => {
    opened = true;
    p.close().catch(() => {});
  };
  const onLoad = () => {
    loaded = true;
  };
  env.context.on('page', onPage);
  page.on('domcontentloaded', onLoad);
  // A variant change may rewrite ?variant= in the address (history API, same document): that is not leaving.
  const left = () => opened || loaded || pathKey(page.url()) !== start;
  const t0 = Date.now();
  let index = ctx.firstIndex;
  await mkdir(path.join(ctx.pageDir, 'blocks'), { recursive: true }).catch(() => {});
  try {
    const pb = await page.evaluate(productBlock).catch(() => null);

    // 1. The photo gallery's thumbnails, on the product block, unless it already has a clip.
    if (pb && !ctx.skip.has(pb.ref)) {
      const out: RawClip = { ref: pb.ref, index: Number(pb.ref.replace(/^b/, '')) || 0, motionHint: 'carousel', why: 'gallery', verdict: 'failed', ms: 0, pressed: true };
      const s = Date.now();
      await withLimit(PRODUCT_THRESHOLDS.candidateMs, out, (ctl) => gallery(page, env, pb.ref, path.join(env.framesRoot, `${pb.ref}-gallery`), ctl, out, s + PRODUCT_THRESHOLDS.candidateMs, left));
      out.ms = Date.now() - s;
      await page.evaluate(restorePinned).catch(() => {});
      if (out.verdict !== 'not-moving' || out.error !== 'no-thumbnails') res.clips.push(out);
      res.notes.push(`gallery ${out.verdict}${out.error ? ` (${out.error})` : ''}`);
      if (left()) return stop(res, out);
    }

    // 2. The product options, as a new "product-options" block.
    if (Date.now() - t0 < PRODUCT_THRESHOLDS.pageMs) {
      const ref = `b${index}`;
      const out: RawClip = { ref, index, motionHint: 'animation', why: 'options', verdict: 'failed', ms: 0, pressed: true };
      const s = Date.now();
      let block: ProductBlock | null = null;
      await withLimit(PRODUCT_THRESHOLDS.candidateMs, out, async (ctl) => {
        block = await options(page, env, ctx, ref, index, path.join(env.framesRoot, `${ref}-options`), ctl, out, s + PRODUCT_THRESHOLDS.candidateMs, left);
      });
      out.ms = Date.now() - s;
      res.notes.push(`options ${out.verdict}${out.error ? ` (${out.error})` : ''}`);
      if (left()) return stop(res, out);
      if (block && out.verdict === 'recorded') {
        res.blocks.push(block);
        res.clips.push(out);
        index++;
      }
    }

    // 3. The size guide, as a new "size-guide" block.
    if (Date.now() - t0 < PRODUCT_THRESHOLDS.pageMs) {
      const ref = `b${index}`;
      const out: RawClip = { ref, index, motionHint: 'animation', why: 'size guide', verdict: 'failed', ms: 0, pressed: true };
      const s = Date.now();
      let block: ProductBlock | null = null;
      await withLimit(PRODUCT_THRESHOLDS.candidateMs, out, async (ctl) => {
        block = await sizeGuide(page, env, ctx, pb?.ref ?? null, ref, index, phone, path.join(env.framesRoot, `${ref}-size`), ctl, out, s + PRODUCT_THRESHOLDS.candidateMs, left);
      });
      out.ms = Date.now() - s;
      res.notes.push(`size guide ${out.verdict}${out.error ? ` (${out.error})` : ''}`);
      if (left()) return stop(res, out);
      if (block && out.verdict === 'recorded') {
        res.blocks.push(block);
        res.clips.push(out);
        index++;
      }
    }
  } catch (e) {
    res.notes.push(`product step failed: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    env.context.off('page', onPage);
    page.off('domcontentloaded', onLoad);
  }
  return res;
}

/** The page went somewhere else: what was being recorded is dropped, and nothing more is tried. */
function stop(res: ProductResult, out: RawClip): ProductResult {
  out.verdict = 'failed';
  out.error = 'navigated';
  delete out.frames;
  res.clips = res.clips.filter((c) => c !== out);
  res.notes.push(`stopped: left the page during "${out.why}"`);
  return res;
}

async function gallery(page: Page, env: ClipEnv, ref: string, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<void> {
  const plan = await page.evaluate(findGallery, ref);
  out.why = plan.ok ? `gallery: ${plan.why}` : 'gallery';
  if (!plan.ok) {
    out.verdict = 'not-moving';
    out.error = plan.why;
    return;
  }
  await page.evaluate(hidePinned, { ref, rescan: true }).catch(() => 0);
  await page.evaluate(placeMarked, { ref, scroll: true });
  await step(ctl, page, 600);
  const placed = (await page.evaluate(placeMarked, { ref, scroll: false })) as Placement;
  if (!placed.ok) {
    out.error = 'not-on-screen';
    return;
  }
  const presses = Math.min(3, plan.thumbs - 1);
  const T = PRODUCT_THRESHOLDS;
  await recordFrames(page, env, framesDir, ctl, out, {
    placed,
    contentMs: T.leadMs + presses * T.gapMs + T.tailMs,
    normalSpeed: false,
    loop: true,
    deadline,
    during: async (wait) => {
      await wait(T.leadMs);
      for (let i = 1; i <= presses; i++) {
        const pressed = await pressSelector(page, env, `[data-secthumb="${i}"]`);
        if (left() || !pressed) break;
        await wait(T.gapMs);
      }
      if (!left()) await wait(T.tailMs);
    },
  });
  if (left()) return;
  const crop = await sliderCrop(out, placed.focus, placed.vh).catch(() => undefined);
  if (out.verdict === 'recorded' && out.frames && !(await changedAnywhere(framesDir, out.frames, crop).catch(() => false))) {
    out.verdict = 'not-moving';
    out.error = 'no-change';
    delete out.frames;
  }
}

async function options(page: Page, env: ClipEnv, ctx: ProductContext, ref: string, index: number, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<ProductBlock | null> {
  const plan = await page.evaluate(findOptions);
  out.why = plan.ok ? `options (${plan.how}): ${plan.group || plan.why}` : 'options';
  if (!plan.ok) {
    out.verdict = 'not-moving';
    out.error = plan.why;
    return null;
  }
  await page.evaluate(placeOptions);
  await step(ctl, page, 500);
  const at = await page.evaluate(placeOptions);
  if (!at.ok) {
    out.error = 'not-on-screen';
    return null;
  }
  // The still: the option pickers as they are before any choice. Written next to the frames first and moved into
  // blocks/ only if the block is kept, so a dropped interaction leaves no stray picture.
  const file = `blocks/${ctx.vp[0]}-${String(index).padStart(2, '0')}-product-options.jpg`;
  const temp = path.join(framesDir, '_still.jpg');
  await mkdir(framesDir, { recursive: true });
  await page.screenshot({ path: temp, type: 'jpeg', quality: ctx.quality, clip: { x: at.box.x, y: at.box.y, width: at.box.width, height: at.box.height }, timeout: 15_000 });
  const fields = await page.evaluate(describeOptions, ref);
  if (!fields) {
    out.error = 'options-gone';
    return null;
  }
  const vw = page.viewportSize()?.width || 1440;
  const vh = page.viewportSize()?.height || 900;
  const placed: Placement = { ok: true, rect: at.box, block: at.box, focus: at.box, vw, vh };
  const T = PRODUCT_THRESHOLDS;
  const choose = async (i: number) => (plan.how === 'select' ? page.selectOption('[data-secopt-select]', plan.values[i - 1]).then(() => true, () => false) : pressSelector(page, env, `[data-secopt="${i}"]`));
  await recordFrames(page, env, framesDir, ctl, out, {
    placed,
    contentMs: T.leadMs + plan.choices * T.gapMs + T.tailMs,
    normalSpeed: false,
    loop: true,
    deadline,
    during: async (wait) => {
      await wait(T.leadMs);
      for (let i = 1; i <= plan.choices; i++) {
        const ok = await choose(i);
        if (left() || !ok) break;
        await wait(T.gapMs);
      }
      if (!left()) await wait(T.tailMs);
    },
  });
  if (left()) return null;
  // The first choice comes back, so nothing about the page is left changed.
  if (plan.how === 'select' && plan.original !== null) await page.selectOption('[data-secopt-select]', plan.original).catch(() => {});
  else await pressSelector(page, env, '[data-secopt-orig]').catch(() => false);
  // A choice often changes little in this area (the picked size's border, the price), so compare finer.
  if (out.verdict === 'recorded' && out.frames && !(await changedAnywhere(framesDir, out.frames, undefined, { size: 200, share: 0.002 }).catch(() => false))) {
    out.verdict = 'not-moving';
    out.error = 'no-change';
    delete out.frames;
    return null;
  }
  if (out.verdict === 'recorded' && (await blank(temp))) {
    out.verdict = 'not-moving';
    out.error = 'blank-picture';
    delete out.frames;
  }
  if (out.verdict !== 'recorded' || !(await rename(temp, path.join(ctx.pageDir, file)).then(() => true, () => false))) return null;
  return { ...fields, ref, index, typeHint: 'product-options', parentType: null, top: at.top, height: Math.round(at.box.height), width: Math.round(at.box.width), viewport: ctx.vp, file };
}

async function sizeGuide(page: Page, env: ClipEnv, ctx: ProductContext, blockRef: string | null, ref: string, index: number, phone: boolean, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<ProductBlock | null> {
  const sg = await page.evaluate(findSizeGuide, blockRef);
  out.why = sg.ok ? `size guide: "${sg.label}"` : 'size guide';
  if (!sg.ok) {
    out.verdict = 'not-moving';
    out.error = sg.why;
    return null;
  }
  await page.evaluate(() => document.querySelector('[data-secsize]')?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })).catch(() => {});
  await step(ctl, page, 500);
  const vw = page.viewportSize()?.width || 1440;
  const vh = page.viewportSize()?.height || 900;
  const base: Overlay[] = await page.evaluate(snapshotOverlays).catch(() => []);
  const whole = { x: 0, y: 0, width: vw, height: vh };
  const placed: Placement = { ok: true, rect: whole, block: whole, focus: whole, vw, vh };
  let found: Overlay | null = null;
  const T = PRODUCT_THRESHOLDS;
  await recordFrames(page, env, framesDir, ctl, out, {
    placed,
    contentMs: T.sizeLeadMs + T.sizeOpenMs + T.sizeHoldMs,
    normalSpeed: false,
    loop: true,
    deadline,
    during: async (wait) => {
      await wait(T.sizeLeadMs);
      if (!(await pressSelector(page, env, '[data-secsize]'))) return;
      for (let t = 0; t < T.sizeOpenMs && !found; t += 250) {
        await wait(250);
        if (left()) return;
        const now: Overlay[] = await page.evaluate(snapshotOverlays).catch(() => []);
        const d = diffOverlays(base, now, vw, vh);
        const panels = d.found.filter((o) => {
          const c = classOf(o, vw, vh, phone, d.backdrop);
          return c === 'modal' || c === 'drawer';
        });
        if (panels.length) found = panels.sort((a, b) => b.w * b.h - a.w * a.h)[0];
      }
      if (found && !left()) await wait(T.sizeHoldMs);
    },
  });
  if (left()) return null;
  const close = async (key: string | null) => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    if (!key || !(await page.evaluate(overlayShowing, key).catch(() => false))) return;
    if (await page.evaluate(markPanelClose, key).catch(() => false)) {
      await pressSelector(page, env, '[data-secclose]').catch(() => false);
      await page.waitForTimeout(400);
    }
    if (await page.evaluate(overlayShowing, key).catch(() => false)) await page.evaluate(forceHide, key).catch(() => {});
  };
  const panel = found as Overlay | null;
  if (!panel) {
    await close(null);
    if (out.verdict === 'recorded') {
      out.verdict = 'not-moving';
      out.error = 'no-panel';
      delete out.frames;
    }
    return null;
  }
  // Measured again now that it has settled, and only kept if it reads like a size guide.
  const settled = await page.evaluate(sizePanel, panel.key).catch(() => ({ ok: false, box: { x: 0, y: 0, width: 0, height: 0 }, why: 'panel-gone' }));
  if (!settled.ok) {
    await close(panel.key);
    if (out.verdict === 'recorded') {
      out.verdict = 'not-moving';
      out.error = settled.why;
      delete out.frames;
    }
    return null;
  }
  // The still: the panel alone, while it is open. The clip is the whole screen, cut to the panel by the encoder.
  const box = settled.box;
  const file = `blocks/${ctx.vp[0]}-${String(index).padStart(2, '0')}-size-guide.jpg`;
  const temp = path.join(framesDir, '_still.jpg');
  await mkdir(framesDir, { recursive: true }).catch(() => {});
  const shot = await page
    .screenshot({ path: temp, type: 'jpeg', quality: ctx.quality, clip: box, timeout: 15_000 })
    .then(() => true, () => false);
  const fields = await page.evaluate(describePanel, { key: panel.key, ref }).catch(() => null);
  await close(panel.key);
  if (shot && out.verdict === 'recorded' && (await blank(temp))) {
    out.verdict = 'not-moving';
    out.error = 'blank-picture';
    delete out.frames;
    return null;
  }
  const moved = shot && !!fields && out.verdict === 'recorded' && (await rename(temp, path.join(ctx.pageDir, file)).then(() => true, () => false));
  if (!moved || !fields) {
    if (out.verdict === 'recorded') {
      out.verdict = 'failed';
      out.error = 'panel-shot-failed';
      delete out.frames;
    }
    return null;
  }
  out.rect = box;
  out.block = box;
  return { ...fields, ref, index, typeHint: 'size-guide', parentType: null, viewport: ctx.vp, file };
}
