// Stage 3 (Ben, 20 Nov 2026): videos that wait for a press. After the stills, moments, sliders and product
// steps, each section whose video did not play by itself gets its own play button pressed (a real click, or a
// tap on phones) while it is recorded in slow motion like every clip (src/clips.ts, src/time-warp.ts):
//   - the video plays in the section: the clip goes on that section (poster, the press, the video playing);
//   - it opens in a popup over the page: a new block, "video-popup" (the player box), gets a still and the clip.
// Then the video is paused again and a popup closed, so the page is left as it was found.
// A player inside another site's frame (YouTube, Vimeo, Wistia) is recorded at normal speed: its own clock
// cannot be trusted to slow down. If a video still starts at normal speed in a slowed page, the clip is taken a
// second time at normal speed. Adverts, a player that asks to sign in or shows an error, and anything that does
// not play give no clip.
// Never a link to another page, never anything in a form or a menu (src/play-script.ts). If the page loads a new
// document, changes address or opens a tab, it stops at once and keeps nothing from that video.
import type { Frame, Page, Route } from 'playwright';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import sharp from 'sharp';
import {
  coverAtCentre,
  describePopup,
  frameVideoState,
  hidePopupLayer,
  markNewLayer,
  markPopupClose,
  pauseAll,
  popupControl,
  placePlay,
  planPlay,
  playBlocks,
  playState,
  popupBox,
  popupShowing,
  revealLayer,
  scriptPlay,
  type FrameVideoState,
  type PlayBlock,
  type PlayBox,
  type PlayPlan,
} from './play-script.js';
import { hasGif } from './clip-script.js';
import { hidePinned, restorePinned } from './page-script.js';
import { changedAnywhere, pressSelector, recordFrames, sliderCrop, step, withLimit, type ClipEnv, type Control, type RawClip } from './clips.js';
import { setPageRate } from './time-warp.js';
import type { ProductBlock } from './product-clips.js';

/** Times are page time (slow motion stretches them), except candidateMs and pageMs. */
export const PLAY_THRESHOLDS = {
  maxPerPage: 3,
  candidateMs: 75_000,
  pageMs: 150_000,
  /** After the media is centred: a theme that starts videos once they are on screen does it here. */
  settleMs: 1200,
  /** The poster on screen before the press. */
  leadMs: 600,
  /** How long a video may take to start after the press (and again after a popup's own play button). */
  startMs: 4000,
  /** Nothing plays this long after the press: a popup that opened is searched for a play button of its own. */
  secondMs: 1500,
  /** How long it is recorded once it plays. */
  playMs: 5000,
  pollMs: 250,
  /** Slow motion reached the video when its rate is within this share of the page's. */
  rateSlack: 0.15,
};

/** Player frames (YouTube, Vimeo, Wistia, ...): the page's address of the frame. */
const PLAYER_URL = /youtube\.com\/embed|youtube-nocookie\.com|player\.vimeo\.com|videopress\.com\/embed|fast\.wistia\.(net|com)|wistia\.com\/embed|play\.vidyard\.com|loom\.com\/embed/i;

export type PlayResult = { clips: RawClip[]; blocks: ProductBlock[]; notes: string[] };

export type PlayContext = {
  pageDir: string;
  vp: 'desktop' | 'mobile';
  quality: number;
  /** The index the first new block (a popup) gets. */
  firstIndex: number;
  /** Blocks that already have a clip. */
  skip: Set<string>;
};

/** What the polling saw during one recording. */
type Seen = { playing: boolean; inFrame: boolean; ad: boolean; wall: boolean; popup: { box: PlayBox; frame: boolean } | null; rates: number[] };

const pathKey = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname + x.search;
  } catch {
    return u;
  }
};

/** A picture that is nearly one flat colour (a player that had not drawn yet) is not a block. */
async function blank(file: string): Promise<boolean> {
  const st = await sharp(file).stats().catch(() => null);
  if (!st) return true;
  return st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3 < 4;
}

/** A promise that gives up (null) after `ms`: a frame that hangs must not hold the recording. */
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), ms))]);

/** The player frames the page asked to watch (data-secplay-watch on their iframe): the section's and a popup's. */
async function watchedFrames(page: Page): Promise<Frame[]> {
  const out: Frame[] = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !PLAYER_URL.test(f.url())) continue;
    const el = await within(f.frameElement(), 1000);
    if (!el) continue;
    if (await within(el.evaluate((e) => (e as Element).hasAttribute('data-secplay-watch')), 1000)) out.push(f);
  }
  return out;
}

/** Reads the page and the watched player frames once, adding what it saw to `seen`. */
async function look(page: Page, ref: string, seen: Seen): Promise<void> {
  const st = await within(page.evaluate(playState, ref), 2000);
  if (st) {
    if (st.popup && !seen.popup) {
      seen.popup = st.popup;
      await page.evaluate(revealLayer).catch(() => {});
    }
    if (st.playing) {
      seen.playing = true;
      seen.rates.push(st.rate);
    }
  }
  for (const f of await watchedFrames(page)) {
    const s: FrameVideoState | null = await within(f.evaluate(frameVideoState), 1500);
    if (!s) continue;
    if (s.ad) seen.ad = true;
    if (s.wall) seen.wall = true;
    if (s.playing) {
      seen.playing = true;
      seen.inFrame = true;
      seen.rates.push(s.rate);
    }
  }
}

/** Presses what planPlay marked: a real click (desktop) or tap (phones) when it is on screen and uncovered. */
async function press(page: Page, env: ClipEnv, plan: PlayPlan, second?: string): Promise<boolean> {
  if (plan.how === 'script' && !second) return page.evaluate(scriptPlay).catch(() => false);
  const sel = second || (plan.how === 'control' ? '[data-secplay="go"]' : plan.how === 'video' ? '[data-secplay-video]' : '[data-secplay-frame]');
  const pressed = await pressSelector(page, env, sel);
  // A YouTube or Vimeo player keeps its controls and a "Pause" label up while the mouse rests on it
  // (avocadogreenmattress.com, 20 Nov 2026): the mouse moves off to the screen's bottom-left corner.
  // A store's own <video> stays as it is (some cards play only while the mouse is on them).
  if (pressed && !env.touch && (second || plan.player !== 'native')) {
    const vh = page.viewportSize()?.height || 900;
    await page.mouse.move(2, vh - 2).catch(() => {});
  }
  return pressed;
}

/**
 * Pauses every video of the page and of its player frames; closes a popup, or any layer that opened over the
 * page since the press (Escape, its close button, else hidden).
 */
async function putBack(page: Page, env: ClipEnv, popup: boolean): Promise<void> {
  await within(page.evaluate(pauseAll), 2000);
  for (const f of page.frames()) if (f !== page.mainFrame() && PLAYER_URL.test(f.url())) await within(f.evaluate(pauseAll), 1500);
  if (!popup && !(await page.evaluate(markNewLayer).catch(() => false))) return;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  if (!(await page.evaluate(popupShowing).catch(() => false))) return;
  if (await page.evaluate(markPopupClose).catch(() => false)) {
    await pressSelector(page, env, '[data-secplay-close]').catch(() => false);
    await page.waitForTimeout(400);
  }
  if (await page.evaluate(popupShowing).catch(() => false)) await page.evaluate(hidePopupLayer).catch(() => {});
}

/** Records the videos that wait for a press, on one page and viewport. Never throws. */
export async function recordPlayClips(page: Page, env: ClipEnv, ctx: PlayContext): Promise<PlayResult> {
  const res: PlayResult = { clips: [], blocks: [], notes: [] };
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
  // While this step runs, the page and any tab it opens may not load another document: a play button that is a
  // link to YouTube or Vimeo is pressed only because the store's own script turns it into a popup, and if that
  // script does not, the visit to the other site is stopped before it starts.
  const guard = (route: Route) => {
    let leaving = false;
    try {
      const req = route.request();
      leaving = req.isNavigationRequest() && req.frame().parentFrame() === null;
    } catch {
      leaving = false;
    }
    return (leaving ? route.abort('aborted') : route.fallback()).catch(() => {});
  };
  await env.context.route('**/*', guard).catch(() => {});
  const left = () => opened || loaded || pathKey(page.url()) !== start;
  const t0 = Date.now();
  let index = ctx.firstIndex;
  await mkdir(path.join(ctx.pageDir, 'blocks'), { recursive: true }).catch(() => {});
  try {
    const blocks: PlayBlock[] = await page.evaluate(playBlocks, { max: PLAY_THRESHOLDS.maxPerPage, skip: [...ctx.skip] }).catch(() => []);
    for (const b of blocks) {
      if (Date.now() - t0 > PLAY_THRESHOLDS.pageMs) {
        res.notes.push(`${b.ref} skipped (time)`);
        continue;
      }
      const out: RawClip = { ref: b.ref, index: b.index, motionHint: 'video', why: `play: ${b.why}`, verdict: 'failed', ms: 0, pressed: true };
      const newRef = `b${index}`;
      const s = Date.now();
      let block: ProductBlock | null = null;
      await withLimit(PLAY_THRESHOLDS.candidateMs, out, async (ctl) => {
        block = await playOne(page, env, ctx, b, newRef, index, path.join(env.framesRoot, `${b.ref}-play`), ctl, out, s + PLAY_THRESHOLDS.candidateMs, left);
      });
      out.ms = Date.now() - s;
      await page.evaluate(restorePinned).catch(() => {});
      res.notes.push(`${b.ref} ${out.why}: ${out.verdict}${out.error ? ` (${out.error})` : ''}${out.slowdown ? ` x${out.slowdown}` : ''}${block ? ' (popup block)' : ''}`);
      if (left()) {
        out.verdict = 'failed';
        out.error = 'navigated';
        delete out.frames;
        res.notes.push('stopped: left the page');
        break;
      }
      // Only recorded videos travel on: a section whose video did not play keeps its still and its notes.
      if (out.verdict !== 'recorded') continue;
      if (block) {
        res.blocks.push(block);
        index++;
      }
      res.clips.push(out);
    }
  } catch (e) {
    res.notes.push(`play step failed: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    env.context.off('page', onPage);
    page.off('domcontentloaded', onLoad);
    await env.context.unroute('**/*', guard).catch(() => {});
  }
  return res;
}

async function playOne(page: Page, env: ClipEnv, ctx: PlayContext, b: PlayBlock, newRef: string, newIndex: number, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<ProductBlock | null> {
  const T = PLAY_THRESHOLDS;
  let plan = await page.evaluate(planPlay, b.ref);
  out.why = plan.ok ? `play (${plan.how}, ${plan.player}): ${plan.why}` : `play: ${b.why}`;
  if (!plan.ok) {
    out.verdict = 'not-moving';
    out.error = plan.why;
    return null;
  }
  await page.evaluate(hidePinned, { ref: b.ref, rescan: true }).catch(() => 0);
  await page.evaluate(placePlay, { ref: b.ref, scroll: true });
  await step(ctl, page, T.settleMs);
  const placed = await page.evaluate(placePlay, { ref: b.ref, scroll: false });
  if (!placed.ok) {
    out.error = 'not-on-screen';
    return null;
  }
  // A frame player that already shows a sign-in check or an error is left alone (pressing it could open a tab).
  if (plan.how === 'frame') {
    await page.evaluate(playState, b.ref).catch(() => null);
    for (const f of await watchedFrames(page)) {
      const s = await within(f.evaluate(frameVideoState), 1500);
      if (s?.wall) {
        out.verdict = 'not-moving';
        out.error = 'player-wall';
        return null;
      }
    }
  }
  // A theme that starts the video once it is on screen: it is recorded as it plays, without a press.
  const first = await within(page.evaluate(playState, b.ref), 2000);
  const already = !!first?.playing && !first.popup;
  if (already) out.why = `play: plays once on screen`;
  // A picture or play icon laid over a video with no button found: that is what a shopper would press.
  else if (plan.how === 'script' && (await page.evaluate(coverAtCentre).catch(() => 'none')) === 'control') {
    plan = { ...plan, how: 'control', why: `${plan.why}, picture over it pressed` };
    out.why = `play (control, native): ${plan.why}`;
  }
  const whole = { x: 0, y: 0, width: placed.vw, height: placed.vh };
  const seen: Seen = { playing: already, inFrame: false, ad: false, wall: false, popup: null, rates: [] };
  let mismatch = false;
  let second: string | null = null;
  const normalSpeed = plan.player === 'frame' || (await page.evaluate(hasGif, b.ref).catch(() => false));
  // The whole screen is recorded: where the video ends up (in the section or in a popup) is only known after.
  await recordFrames(page, env, framesDir, ctl, out, {
    placed: { ok: true, rect: whole, block: whole, vw: placed.vw, vh: placed.vh },
    contentMs: already ? T.playMs : T.leadMs + 1000 + T.playMs,
    maxContentMs: already ? T.playMs : T.leadMs + T.startMs + T.playMs,
    normalSpeed,
    deadline,
    during: async (wait, k) => {
      if (!already) {
        await wait(T.leadMs);
        if (!(await press(page, env, plan)) || left()) return;
        let limit = T.startMs;
        for (let t = 0; t < limit && !seen.playing; t += T.pollMs) {
          await wait(T.pollMs);
          if (left()) return;
          await look(page, b.ref, seen);
          if (seen.ad || seen.wall) return;
          // Nothing plays yet, but a popup opened with a play button of its own: pressed once too.
          if (!seen.playing && !seen.popup && second === null && t >= T.secondMs) {
            second = (await page.evaluate(popupControl).catch(() => null)) ?? '';
            if (second) {
              if (!(await press(page, env, plan, '[data-secplay="go2"]')) || left()) return;
              limit = t + T.startMs;
            }
          } else if (!seen.playing && seen.popup?.frame && second === null && t >= T.secondMs) {
            // A popup whose YouTube player waits for a press of its own (beatific.co: no autoplay in its address).
            second = 'the popup player';
            if (!(await press(page, env, plan, '[data-secplay-popframe]')) || left()) return;
            limit = t + T.startMs;
          }
        }
        // The browser's own controls did not start it: what a press on them does, from inside the page, muted.
        if (!seen.playing && plan.how === 'video' && !left()) {
          await page.evaluate(scriptPlay).catch(() => false);
          for (let t = 0; t < 2000 && !seen.playing; t += T.pollMs) {
            await wait(T.pollMs);
            await look(page, b.ref, seen);
          }
        }
        if (!seen.playing || left()) return;
      }
      if (k > 1) {
        // A video that started after the page was slowed (a new player, a new source) is slowed now too; if
        // it will not slow down, this take is dropped and the video is recorded again at normal speed.
        await setPageRate(page, null, 1 / k);
        await wait(300);
        seen.rates = [];
        await look(page, b.ref, seen);
        if (seen.rates.some((r) => Math.abs(r - 1 / k) > (1 / k) * T.rateSlack)) {
          mismatch = true;
          return;
        }
      }
      await wait(T.playMs);
      await look(page, b.ref, seen);
    },
  });
  if (left()) return null;
  if (second) out.why += ` · popup's play button pressed (${second})`;
  if (mismatch && out.verdict === 'recorded' && !seen.ad) {
    out.why += ' · again at normal speed';
    await recordFrames(page, env, `${framesDir}-n`, ctl, out, {
      placed: { ok: true, rect: whole, block: whole, vw: placed.vw, vh: placed.vh },
      contentMs: T.playMs,
      normalSpeed: true,
      deadline,
      during: async (wait) => {
        await wait(T.playMs);
        await look(page, b.ref, seen);
      },
    });
    if (left()) return null;
  }
  const drop = (error: string): null => {
    out.verdict = 'not-moving';
    out.error = error;
    delete out.frames;
    return null;
  };
  try {
    if (out.verdict !== 'recorded') return null;
    if (seen.ad) return drop('advert');
    if (seen.wall) return drop('player-wall');
    if (!seen.playing) return drop('no-play');
    out.motionHint = seen.inFrame || plan.player === 'frame' ? 'embed' : 'video';
    const vh = placed.vh;
    if (seen.popup) {
      // In a popup: the player box, measured again now that it has settled, becomes its own block.
      const box = (await page.evaluate(popupBox).catch(() => null)) || seen.popup.box;
      const crop = await sliderCrop(out, box, vh).catch(() => undefined);
      if (!(await changedAnywhere(out.framesDir!, out.frames!, crop).catch(() => false))) return drop('no-change');
      const file = `blocks/${ctx.vp[0]}-${String(newIndex).padStart(2, '0')}-video-popup.jpg`;
      const temp = path.join(out.framesDir!, '_still.jpg');
      const shot = await page.screenshot({ path: temp, type: 'jpeg', quality: ctx.quality, clip: box, timeout: 15_000 }).then(() => true, () => false);
      if (!shot || (await blank(temp))) return drop('blank-picture');
      const fields = await page.evaluate(describePopup, newRef).catch(() => null);
      if (!fields || !(await rename(temp, path.join(ctx.pageDir, file)).then(() => true, () => false))) return drop('popup-shot-failed');
      out.ref = newRef;
      out.index = newIndex;
      out.rect = box;
      out.block = box;
      return { ...fields, ref: newRef, index: newIndex, typeHint: 'video-popup', parentType: null, viewport: ctx.vp, file };
    }
    // In the section: the clip covers the section's on-screen part; the change must happen on the media itself.
    const crop = await sliderCrop(out, placed.focus, vh).catch(() => undefined);
    if (!(await changedAnywhere(out.framesDir!, out.frames!, crop).catch(() => false))) return drop('no-change');
    out.rect = placed.rect;
    out.block = placed.block;
    return null;
  } finally {
    await putBack(page, env, !!seen.popup || !!second);
  }
}
