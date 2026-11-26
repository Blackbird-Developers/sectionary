// Stage 4 (Ben, 20 Nov 2026): FAQs and accordions, quick view, hover and filters. After the stills, moments and
// the stage 1-3 steps, a few sections per page get one interaction each while they are recorded in slow motion
// like every clip (src/clips.ts, src/time-warp.ts):
//   - faq: the first question (or a product page's "Description", "Ingredients"...) is opened; the clip stays on
//     the section, inside its box, and the question is closed again after;
//   - hover (desktop): the mouse rests on up to three product cards, which show their second photo; clip on the
//     section;
//   - quickview: a product card's quick view button is pressed (on desktop the card is hovered first, as many
//     themes only show the button then); the panel that opens becomes a new block, "quick-view", then it is closed;
//   - filters (collection pages): the filter button is pressed, or a filter group opened; the panel becomes a new
//     block, "filter-panel", then it is closed. A filter is never applied.
// Never a link to another page, an add to cart, a form or a menu (src/interact-script.ts). While this step runs
// the page may not load another document, and any request that would change the cart is stopped. If the page
// loads, changes address or opens a tab, it stops at once and keeps nothing from that section.
import type { Page, Route } from 'playwright';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import sharp from 'sharp';
import {
  cardPoints,
  closeToggle,
  groupPanel,
  interactBlocks,
  interactOpened,
  markInteractClose,
  overlayPanel,
  placeInteract,
  planInteract,
  quickCardPoint,
  type InteractBox,
  type InteractKind,
  type InteractTarget,
} from './interact-script.js';
import { describePanel, forceHide, overlayShowing, snapshotOverlays, type Overlay } from './moment-script.js';
import { classOf, diffOverlays } from './moment-logic.js';
import { hidePinned, restorePinned } from './page-script.js';
import { changedAnywhere, pressSelector, recordFrames, sliderCrop, step, withLimit, type ClipEnv, type Control, type RawClip } from './clips.js';
import type { ProductBlock } from './product-clips.js';

/** Times are page time (slow motion stretches them), except candidateMs and pageMs. */
export const INTERACT_THRESHOLDS = {
  maxPerPage: 4,
  candidateMs: 60_000,
  pageMs: 150_000,
  /** The section as it was, before the press. */
  leadMs: 600,
  /** How long an answer or a panel may take to open. */
  openMs: 2500,
  /** How long it is held open once it is. */
  holdMs: 1400,
  /** The mouse rests this long on each product card. */
  hoverMs: 1300,
  /** After the mouse leaves the last card. */
  tailMs: 600,
  pollMs: 250,
};

export type InteractResult = { clips: RawClip[]; blocks: ProductBlock[]; notes: string[] };

export type InteractContext = {
  pageDir: string;
  vp: 'desktop' | 'mobile';
  quality: number;
  /** The index the first new block (a quick view or filter panel) gets. */
  firstIndex: number;
  /** Blocks that already have a clip. */
  skip: Set<string>;
  /** home, collection, product, cart, ... (filters only on collection pages). */
  pageType: string;
  /**
   * Closes popups that opened late, by their close buttons, before each interaction (bybi.com, 20 Nov 2026: a timed
   * sign-up popup came up while a quick view was pressed and was taken for its panel).
   */
  tidy?: () => Promise<void>;
};

const NEW_TYPE: Record<InteractKind, string> = { faq: 'faq', hover: 'hover', quickview: 'quick-view', filters: 'filter-panel' };

const pathKey = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname + x.search;
  } catch {
    return u;
  }
};

/** A picture that is nearly one flat colour (a panel that had not drawn yet) is not a block. */
async function blank(file: string): Promise<boolean> {
  const st = await sharp(file).stats().catch(() => null);
  if (!st) return true;
  return st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3 < 4;
}

/** Records the interactions of one page and viewport. Never throws. */
export async function recordInteractClips(page: Page, env: ClipEnv, ctx: InteractContext): Promise<InteractResult> {
  const res: InteractResult = { clips: [], blocks: [], notes: [] };
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
  // The page may not load another document, and nothing may change the cart: a quick add that fires anyway is
  // stopped before it reaches the store.
  const guard = (route: Route) => {
    let stop = false;
    try {
      const req = route.request();
      stop = (req.isNavigationRequest() && req.frame().parentFrame() === null) || (req.method() !== 'GET' && /\/cart(\/(add|change|update|clear)|\.js|\.json)?(\?|$|\/)/i.test(new URL(req.url()).pathname));
    } catch {
      stop = false;
    }
    return (stop ? route.abort('aborted') : route.fallback()).catch(() => {});
  };
  await env.context.route('**/*', guard).catch(() => {});
  const left = () => opened || loaded || pathKey(page.url()) !== start;
  const t0 = Date.now();
  let index = ctx.firstIndex;
  await mkdir(path.join(ctx.pageDir, 'blocks'), { recursive: true }).catch(() => {});
  try {
    const targets: InteractTarget[] = await page
      .evaluate(interactBlocks, { max: INTERACT_THRESHOLDS.maxPerPage, skip: [...ctx.skip], desktop: !env.touch, pageType: ctx.pageType })
      .catch(() => []);
    for (const t of targets) {
      if (Date.now() - t0 > INTERACT_THRESHOLDS.pageMs) {
        res.notes.push(`${t.ref} ${t.kind} skipped (time)`);
        continue;
      }
      await ctx.tidy?.().catch(() => {});
      const out: RawClip = { ref: t.ref, index: t.index, motionHint: 'animation', why: `${t.kind}: ${t.why}`, verdict: 'failed', ms: 0, pressed: true };
      const newRef = `b${index}`;
      const s = Date.now();
      let block: ProductBlock | null = null;
      await withLimit(INTERACT_THRESHOLDS.candidateMs, out, async (ctl) => {
        const framesDir = path.join(env.framesRoot, `${t.ref}-${t.kind}`);
        block =
          t.kind === 'faq' || t.kind === 'hover'
            ? await inSection(page, env, t, framesDir, ctl, out, s + INTERACT_THRESHOLDS.candidateMs, left)
            : await panel(page, env, ctx, t, newRef, index, framesDir, ctl, out, s + INTERACT_THRESHOLDS.candidateMs, left);
      });
      out.ms = Date.now() - s;
      await page.evaluate(restorePinned).catch(() => {});
      res.notes.push(`${t.ref} ${out.why}: ${out.verdict}${out.error ? ` (${out.error})` : ''}${out.slowdown ? ` x${out.slowdown}` : ''}${block ? ` (${NEW_TYPE[t.kind]} block)` : ''}`);
      if (left()) {
        out.verdict = 'failed';
        out.error = 'navigated';
        delete out.frames;
        res.notes.push('stopped: left the page');
        break;
      }
      if (out.verdict !== 'recorded') continue;
      if (block) {
        res.blocks.push(block);
        index++;
      }
      res.clips.push(out);
    }
  } catch (e) {
    res.notes.push(`interaction step failed: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    env.context.off('page', onPage);
    page.off('domcontentloaded', onLoad);
    await env.context.unroute('**/*', guard).catch(() => {});
  }
  return res;
}

function drop(out: RawClip, error: string): null {
  out.verdict = 'not-moving';
  out.error = error;
  delete out.frames;
  return null;
}

/** A question opened, or product cards hovered: the clip stays on the section, inside its box. */
async function inSection(page: Page, env: ClipEnv, t: InteractTarget, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<null> {
  const T = INTERACT_THRESHOLDS;
  const plan = await page.evaluate(planInteract, { ref: t.ref, kind: t.kind });
  if (!plan.ok) return drop(out, plan.why);
  if (t.kind === 'faq') out.why = `faq: ${t.why.startsWith('accordion') ? 'accordion' : 'question'} ${plan.why}`;
  await page.evaluate(hidePinned, { ref: t.ref, rescan: true }).catch(() => 0);
  await page.evaluate(placeInteract, { ref: t.ref, kind: t.kind, scroll: true });
  await step(ctl, page, 500);
  const placed = await page.evaluate(placeInteract, { ref: t.ref, kind: t.kind, scroll: false });
  if (!placed.ok || placed.rect.height < 40) return drop(out, 'not-on-screen');
  const whole = { x: 0, y: 0, width: placed.vw, height: placed.vh };
  const vh = placed.vh;
  let done = false;
  await recordFrames(page, env, framesDir, ctl, out, {
    placed: { ok: true, rect: whole, block: whole, vw: placed.vw, vh },
    contentMs: t.kind === 'hover' ? T.leadMs + 3 * T.hoverMs + T.tailMs : T.leadMs + T.openMs + T.holdMs,
    normalSpeed: false,
    loop: true,
    deadline,
    during: async (wait) => {
      await wait(T.leadMs);
      if (t.kind === 'hover') {
        const points = await page.evaluate(cardPoints, t.ref).catch(() => []);
        if (!points.length) return;
        for (const p of points) {
          await page.mouse.move(p.x, p.y, { steps: 6 });
          await wait(T.hoverMs);
          if (left()) return;
        }
        await page.mouse.move(2, vh - 2, { steps: 4 });
        await wait(T.tailMs);
        done = true;
        return;
      }
      if (!(await pressSelector(page, env, '[data-secint="go"]')) || left()) return;
      for (let s = 0; s < T.openMs && !done; s += T.pollMs) {
        await wait(T.pollMs);
        if (left()) return;
        done = await page.evaluate(interactOpened).catch(() => false);
      }
      if (done) await wait(T.holdMs);
    },
  });
  if (left()) return null;
  // Put back: the mouse off the cards, the question closed (a <details> directly, anything else pressed again).
  if (t.kind === 'hover') await page.mouse.move(2, vh - 2).catch(() => {});
  else if ((await page.evaluate(closeToggle).catch(() => 'none')) === 'press') {
    await pressSelector(page, env, '[data-secint="go"]').catch(() => false);
    await page.waitForTimeout(400);
  }
  if (out.verdict !== 'recorded') return null;
  if (!done) return drop(out, t.kind === 'hover' ? 'no-cards' : 'did-not-open');
  // The change must happen on the cards (hover) or inside the section's on-screen part (faq).
  const crop = await sliderCrop(out, t.kind === 'hover' ? placed.focus : placed.rect, vh).catch(() => undefined);
  // An answer of two lines in a tall section is a small change: compared finer (the page already said it opened).
  const fine = t.kind === 'faq' ? { size: 200, share: 0.002 } : undefined;
  if (!(await changedAnywhere(out.framesDir!, out.frames!, crop, fine).catch(() => false))) return drop(out, 'no-change');
  out.rect = placed.rect;
  out.block = placed.block;
  return null;
}

/**
 * A quick view or the filters: the panel that opens (over the page, or a filter group in place) becomes a new block
 * with its own still and the clip; then it is closed again.
 */
async function panel(page: Page, env: ClipEnv, ctx: InteractContext, t: InteractTarget, ref: string, index: number, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<ProductBlock | null> {
  const T = INTERACT_THRESHOLDS;
  const plan = await page.evaluate(planInteract, { ref: t.ref, kind: t.kind });
  if (!plan.ok) return drop(out, plan.why);
  const group = plan.mode === 'group';
  // No hidePinned here: it keeps hiding fixed layers that cover the section, and the panel that opens is one
  // (a phone's full-width filter drawer vanished the moment it opened, 20 Nov 2026).
  await page.evaluate(placeInteract, { ref: t.ref, kind: t.kind, scroll: true });
  await step(ctl, page, 500);
  const placed = await page.evaluate(placeInteract, { ref: t.ref, kind: t.kind, scroll: false });
  // A quick view button may sit off its card's visible part until hovered; the card itself must be on screen.
  if (!placed.ok && t.kind !== 'quickview') return drop(out, 'not-on-screen');
  const vw = placed.vw;
  const vh = placed.vh;
  // A phone stays a phone even when a page wider than the screen makes the browser zoom out (innerWidth grows).
  const phone = !!env.touch || vw < 768;
  const whole = { x: 0, y: 0, width: vw, height: vh };
  const base: Overlay[] = group ? [] : await page.evaluate(snapshotOverlays).catch(() => []);
  let found: Overlay | null = null;
  let openedInPlace = false;
  await recordFrames(page, env, framesDir, ctl, out, {
    placed: { ok: true, rect: whole, block: whole, vw, vh },
    contentMs: T.leadMs + T.openMs + T.holdMs,
    normalSpeed: false,
    loop: true,
    deadline,
    during: async (wait) => {
      await wait(T.leadMs);
      // Many themes show a card's quick view button only while the mouse is on the card.
      if (t.kind === 'quickview' && !env.touch) {
        const p = await page.evaluate(quickCardPoint).catch(() => null);
        if (p) {
          await page.mouse.move(p.x, p.y, { steps: 5 });
          await wait(450);
        }
      }
      if (!(await pressSelector(page, env, '[data-secint="go"]')) || left()) return;
      for (let s = 0; s < T.openMs && !found && !openedInPlace; s += T.pollMs) {
        await wait(T.pollMs);
        if (left()) return;
        if (group) {
          openedInPlace = await page.evaluate(interactOpened).catch(() => false);
          continue;
        }
        const now: Overlay[] = await page.evaluate(snapshotOverlays).catch(() => []);
        const d = diffOverlays(base, now, vw, vh);
        const panels = d.found.filter((o) => {
          const c = classOf(o, vw, vh, phone, d.backdrop);
          return c === 'modal' || c === 'drawer';
        });
        if (panels.length) found = panels.sort((a, b) => b.w * b.h - a.w * a.h)[0];
      }
      // A filter button that only opens a bar inside the page (antoniasaintny.com, 20 Nov 2026) gives no clip: the
      // box around it came out as a strip of the product grid moving down. It is closed again below.
      if ((found || openedInPlace) && !left()) await wait(T.holdMs);
    },
  });
  if (left()) return null;
  // Set inside the recording's callback, which TypeScript's flow analysis does not follow.
  const hit = found as Overlay | null;
  const inPlace = openedInPlace as boolean;
  const key = hit ? hit.key : `int-${t.ref}-${Date.now() % 100000}`;
  const close = async () => {
    if (inPlace) {
      if ((await page.evaluate(closeToggle).catch(() => 'none')) === 'press') {
        await pressSelector(page, env, '[data-secint="go"]').catch(() => false);
        await page.waitForTimeout(400);
      }
      return;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    // No layer: whatever the button opened inside the page is closed by pressing it again, if it says it is open.
    if (!hit) {
      if ((await page.evaluate(closeToggle).catch(() => 'none')) === 'press') {
        await pressSelector(page, env, '[data-secint="go"]').catch(() => false);
        await page.waitForTimeout(400);
      }
      return;
    }
    if (!(await page.evaluate(overlayShowing, key).catch(() => false))) return;
    if (await page.evaluate(markInteractClose, key).catch(() => false)) {
      await pressSelector(page, env, '[data-secint-close]').catch(() => false);
      await page.waitForTimeout(400);
    }
    if (await page.evaluate(overlayShowing, key).catch(() => false)) await page.evaluate(forceHide, key).catch(() => {});
  };
  if (!env.touch) await page.mouse.move(2, vh - 2).catch(() => {});
  if (!hit && !inPlace) {
    await close();
    return out.verdict === 'recorded' ? drop(out, 'no-panel') : null;
  }
  // Measured again now that it has settled, and only kept if it reads like a product (quick view) or filters.
  const settled: { ok: boolean; box: InteractBox; why: string } = inPlace
    ? await page.evaluate(groupPanel, key).catch(() => ({ ok: false, box: whole, why: 'panel-gone' }))
    : await page.evaluate(overlayPanel, { key, kind: t.kind }).catch(() => ({ ok: false, box: whole, why: 'panel-gone' }));
  if (!settled.ok) {
    await close();
    return out.verdict === 'recorded' ? drop(out, settled.why) : null;
  }
  const box = settled.box;
  const file = `blocks/${ctx.vp[0]}-${String(index).padStart(2, '0')}-${NEW_TYPE[t.kind]}.jpg`;
  const temp = path.join(framesDir, '_still.jpg');
  await mkdir(framesDir, { recursive: true }).catch(() => {});
  const shot = await page.screenshot({ path: temp, type: 'jpeg', quality: ctx.quality, clip: box, timeout: 15_000 }).then(() => true, () => false);
  const fields = await page.evaluate(describePanel, { key, ref }).catch(() => null);
  await close();
  if (out.verdict !== 'recorded') return null;
  if (!shot || (await blank(temp))) return drop(out, 'blank-picture');
  const crop = await sliderCrop(out, box, vh).catch(() => undefined);
  // A bar of small filter buttons opening in place is a small change in a wide box: compared finer.
  if (!(await changedAnywhere(out.framesDir!, out.frames!, crop, inPlace ? { size: 200, share: 0.002 } : undefined).catch(() => false))) return drop(out, 'no-change');
  if (!fields || !(await rename(temp, path.join(ctx.pageDir, file)).then(() => true, () => false))) {
    out.verdict = 'failed';
    out.error = 'panel-shot-failed';
    delete out.frames;
    return null;
  }
  out.ref = ref;
  out.index = index;
  out.rect = box;
  out.block = box;
  return { ...fields, ref, index, typeHint: NEW_TYPE[t.kind], parentType: null, viewport: ctx.vp, file };
}
