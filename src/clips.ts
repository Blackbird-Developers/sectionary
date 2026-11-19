// Clips brief sections 6.3 and 6.4: for each block that may move by itself, test that it really does
// (two screenshots, a few seconds apart, compared in a tiny greyscale version) and record it.
// Recording: on desktop the Chromium DevTools screencast, on phones a screenshot loop of the block's on-screen
// part (the screencast only gives 390 px wide frames there; the loop gives 780). While it runs the page is
// slowed down (time-warp.ts), as much as this PC needs for about 30 pictures per second of clip; clip-encode.ts
// speeds the frames back up and turns them into an MP4 after the page is closed (Ben, 18 Nov 2026: phone clips
// recorded in real time came out at a median 8.5 new pictures per second on the worst pages).
// Frames are written under the output folder (the C: drive is full, so never the system temp folder).
// The clip step clicks nothing: the only traffic is the page's own playback. The slider step
// (recordSliderClips, after the block stills) presses a slider's own "next" arrow or dots, or scrolls or swipes
// its track, and records what happens. It never follows a link, never types and never sends a form.
import type { BrowserContext, CDPSession, Page } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  clickControl,
  controlPoint,
  hasGif,
  motionHints,
  placeBlock,
  placeSlider,
  planSlider,
  rewindVideos,
  scrollTrack,
  sliderBlocks,
  startVideo,
  trackBox,
  videoState,
  type MotionCandidate,
  type MotionHint,
  type Placement,
  type SliderBlock,
  type SliderPlan,
} from './clip-script.js';
import { hidePinned, restorePinned } from './page-script.js';
import { chooseSlowdown, setPageRate } from './time-warp.js';

/**
 * Starting values from the brief (6.2, 6.3). Tune in rollout steps 2 and 3 and note here which store drove each change.
 * areaShare is also written into clip-script.ts (in-page code cannot import).
 */
export const CLIP_THRESHOLDS = {
  /** A video, iframe or canvas must cover this share of the block to nominate it. */
  areaShare: 0.3,
  /** A pixel counts as changed when the 64 px greyscale versions differ by more than this (of 255). */
  diffLevel: 12,
  /** The block is moving when more than this share of pixels changed. */
  movingShare: 0.015,
  probeMs: 1500,
  /** A carousel that did not move is tested again this long after the first screenshot. */
  carouselRetestMs: [3000, 6000],
  settleMs: 600,
  maxPerPage: 4,
  /**
   * Slow motion makes a recording up to SLOWMO.maxRealMs (40 s) long, plus the motion test (up to 6 s) and the
   * wait for a video (up to 8 s). Was 16 s and 45 s when clips were recorded in real time.
   */
  candidateMs: 65_000,
  pageMs: 150_000,
  /** The speed test on desktop takes shots this wide (the encoder's maximum); phones at device resolution (780 px). */
  desktopFrameWidth: 1080,
};

/** Sliders that only move when pressed (Ben, 18 Nov 2026). Times are page time; slow motion stretches them. */
export const SLIDER_THRESHOLDS = {
  maxPerPage: 3,
  presses: 3,
  /** Before the first press, between presses, and after the last one. */
  leadMs: 700,
  gapMs: 1800,
  tailMs: 700,
  candidateMs: 60_000,
  pageMs: 130_000,
};

export type RawClip = {
  ref: string;
  index: number;
  motionHint: MotionHint;
  why: string;
  /** recorded = frames are on disk, waiting for the encoder. */
  verdict: 'recorded' | 'not-moving' | 'click-to-play' | 'failed';
  error?: string;
  framesDir?: string;
  frames?: { file: string; ts: number }[];
  recordedMs?: number;
  /** What was recorded: the block's on-screen part in viewport CSS pixels, and the whole block's box, same space. */
  rect?: Placement['rect'];
  block?: Placement['block'];
  viewportWidth?: number;
  /** Phone screenshot loop only: the part of the viewport (CSS px) the frames show. Absent = the whole viewport. */
  frameRegion?: { x: number; y: number; width: number; height: number };
  /** How many times slower than real the page ran while recorded (1 = normal speed); the encoder speeds it back up. */
  slowdown?: number;
  /** The slider step pressed this block's slider (it did not move by itself). */
  pressed?: boolean;
  /** Pictures per second this PC managed on the block just before recording (the slowdown is chosen from it). */
  captureFps?: number;
  /** Seconds the motion test and the recording took. */
  ms: number;
};

export type ClipEnv = {
  context: BrowserContext;
  /** Where frames go: <out>/_frames/<host>/<slug>/<d|m>/ . */
  framesRoot: string;
  maxClips: number;
  /** Phones: sliders are tapped and swiped rather than clicked. */
  touch?: boolean;
  log: (line: string) => void;
};

const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

/** A screenshot of the rectangle, as 64 px wide greyscale pixels. */
async function grey(page: Page, rect: Placement['rect']): Promise<Buffer> {
  const png = await page.screenshot({ clip: { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) }, type: 'png', scale: 'css', timeout: 10_000 });
  return sharp(png).resize({ width: 64 }).greyscale().raw().toBuffer();
}

/** Share of pixels that differ by more than the threshold. Both buffers have the same size. */
export function diffShare(a: Buffer, b: Buffer, level = CLIP_THRESHOLDS.diffLevel): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > level) diff++;
  return diff / n;
}

export type Control = { aborted: boolean };

export async function step(ctl: Control, page: Page, ms: number): Promise<void> {
  if (ctl.aborted) throw new Error('aborted');
  await sleep(page, ms);
  if (ctl.aborted) throw new Error('aborted');
}

/** Brief 6.3: is the block really moving? Carousels are tested again at 3 s and 6 s. */
async function movingTest(page: Page, rect: Placement['rect'], hint: MotionHint, ctl: Control): Promise<{ moving: boolean; share: number }> {
  const first = await grey(page, rect);
  await step(ctl, page, CLIP_THRESHOLDS.probeMs);
  let share = diffShare(first, await grey(page, rect));
  if (share > CLIP_THRESHOLDS.movingShare) return { moving: true, share };
  if (hint !== 'carousel') return { moving: false, share };
  let elapsed = CLIP_THRESHOLDS.probeMs;
  for (const at of CLIP_THRESHOLDS.carouselRetestMs) {
    await step(ctl, page, at - elapsed);
    elapsed = at;
    share = Math.max(share, diffShare(first, await grey(page, rect)));
    if (share > CLIP_THRESHOLDS.movingShare) return { moving: true, share };
  }
  return { moving: false, share };
}

/** The recording length in page time for the kind (brief 6.4 table). Carousels may be extended while recording. */
function recordMs(hint: MotionHint, videoSeconds: number): number {
  if (hint === 'video' || hint === 'embed') return videoSeconds >= 3 && videoSeconds <= 8 ? Math.round(videoSeconds * 1000) : 5000;
  if (hint === 'carousel') return 7000;
  if (hint === 'marquee') return 4000;
  return 5000;
}

export type RecordPlan = {
  placed: Placement;
  /** The clip's planned length in page time. */
  contentMs: number;
  /** The longest it may get (an autoplaying carousel waits for a slide change): the slowdown is chosen from this. */
  maxContentMs?: number;
  /** Things the warp cannot slow (embeds, animated GIFs) are recorded at normal speed. */
  normalSpeed: boolean;
  deadline: number;
  /** Runs once the speed is set, right before the first frame (videos rewind here). */
  beforeStart?: () => Promise<void>;
  /** Autoplaying carousels: carry on (up to 10 s of page time) until one slide change was seen, plus 1 s. */
  untilChange?: boolean;
  /** Runs once the recording has started; wait(ms) waits that long in page time. The recording stops when it returns. */
  during?: (wait: (pageMs: number) => Promise<void>) => Promise<void>;
  /** Use the screenshot loop on desktop too (a picture every time, even while nothing moves): interactions. */
  loop?: boolean;
};

/**
 * Records the block: on desktop with the screencast (the whole viewport, cropped by the encoder), on phones with
 * a screenshot loop of the block's on-screen part plus 8 px (780 px wide frames). First it times three shots of
 * that part to see how fast this PC takes them here, then slows the page enough for about 30 pictures per
 * second of clip (time-warp.ts) and puts the speed back after, whatever happens. The screencast is at least as
 * fast as those shots, so on desktop the slowdown errs on the safe side. Fills `out` when frames were recorded.
 */
export async function recordFrames(page: Page, env: ClipEnv, framesDir: string, ctl: Control, out: RawClip, plan: RecordPlan): Promise<void> {
  const size = page.viewportSize() || { width: 1440, height: 900 };
  const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  const phone = size.width < 768;
  // The screenshot loop takes a picture whatever happens on screen; the screencast only when something changes,
  // which an instant popup can leave at one frame (spanx.com size guide, 18 Nov 2026). Interactions ask for the loop.
  const useLoop = phone || !!plan.loop;
  const m = 8;
  const r = plan.placed.rect;
  const x0 = Math.max(0, Math.floor(r.x) - m);
  const y0 = Math.max(0, Math.floor(r.y) - m);
  const x1 = Math.min(size.width, Math.ceil(r.x + r.width) + m);
  const y1 = Math.min(size.height, Math.ceil(r.y + r.height) + m);
  const region = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  // Device resolution on phones (Ben, 17 Nov 2026: 780 px); on desktop the encoder's 1080 px maximum.
  const scale = phone ? dpr : Math.min(dpr, CLIP_THRESHOLDS.desktopFrameWidth / size.width);
  const off = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })).catch(() => ({ x: 0, y: 0 }));
  const cdp: CDPSession = await env.context.newCDPSession(page);
  const shot = () =>
    cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: phone ? 85 : 90, clip: { x: off.x + region.x, y: off.y + region.y, width: region.width, height: region.height, scale } }) as Promise<{ data: string }>;
  let k = 1;
  try {
    // How fast does this PC take this picture? Three timed shots; the first only warms up.
    let fps = 0;
    try {
      await shot();
      const t = Date.now();
      await shot();
      await shot();
      fps = 2000 / Math.max(1, Date.now() - t);
    } catch {
      fps = 0;
    }
    out.captureFps = Math.round(fps * 10) / 10;
    k = plan.normalSpeed ? 1 : chooseSlowdown(fps, plan.maxContentMs ?? plan.contentMs);
    // Whatever the test used up, the recording must end before the deadline (1.5 s left for stopping and writing).
    const room = plan.deadline - 1500 - Date.now();
    if (plan.contentMs * k > room) k = Math.max(1, Math.floor(room / plan.contentMs));
    const contentMs = Math.min(plan.contentMs, Math.floor(room / k));
    if (contentMs < 3000) {
      out.verdict = 'failed';
      out.error = 'no-time-left';
      return;
    }
    await mkdir(framesDir, { recursive: true });
    const frames: { file: string; ts: number }[] = [];
    const writes: Promise<void>[] = [];
    let stop = false;
    if (k > 1) await setPageRate(page, cdp, 1 / k);
    if (plan.beforeStart) await plan.beforeStart();
    const t0 = Date.now();
    let loop: Promise<void> = Promise.resolve();
    if (useLoop) {
      loop = (async () => {
        while (!stop) {
          const res = await shot().catch(() => null);
          if (!res) {
            if (stop) break;
            await new Promise((res2) => setTimeout(res2, 50));
            continue;
          }
          const file = `${String(frames.length).padStart(5, '0')}.jpg`;
          frames.push({ file, ts: Date.now() / 1000 });
          writes.push(writeFile(path.join(framesDir, file), Buffer.from(res.data, 'base64')));
        }
      })();
    } else {
      cdp.on('Page.screencastFrame', (ev: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
        cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
        if (stop) return;
        const file = `${String(frames.length).padStart(5, '0')}.jpg`;
        frames.push({ file, ts: ev.metadata?.timestamp ?? Date.now() / 1000 });
        writes.push(writeFile(path.join(framesDir, file), Buffer.from(ev.data, 'base64')));
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(size.width * dpr), maxHeight: Math.round(size.height * dpr), everyNthFrame: 1 });
    }
    const wait = (pageMs: number) => step(ctl, page, Math.round(pageMs * k));
    try {
      if (plan.during) await plan.during(wait);
      else {
        await wait(contentMs);
        if (plan.untilChange) {
          // Up to 10 s of page time until one slide change has been seen, plus 1 s.
          const limit = Math.min(t0 + 10_000 * k, plan.deadline - 1500);
          while (Date.now() < limit) {
            await Promise.all(writes);
            if (frames.length > 1 && (await changed(framesDir, frames))) {
              await wait(1000);
              break;
            }
            await wait(500);
          }
        }
      }
    } finally {
      stop = true;
      if (!useLoop) await cdp.send('Page.stopScreencast').catch(() => {});
      await loop.catch(() => {});
      await Promise.all(writes).catch(() => {});
    }
    out.verdict = 'recorded';
    out.framesDir = framesDir;
    out.frames = frames.slice();
    out.recordedMs = Date.now() - t0;
    out.rect = plan.placed.rect;
    out.block = plan.placed.block;
    out.viewportWidth = size.width;
    if (useLoop) out.frameRegion = region;
    out.slowdown = k;
  } finally {
    if (k > 1) await setPageRate(page, cdp, 1).catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

async function candidateInner(page: Page, env: ClipEnv, cand: MotionCandidate, framesDir: string, ctl: Control, out: RawClip, deadline: number): Promise<void> {
  // Pinned headers, chat bubbles and dialogs stay out of the recording, as for the block's still.
  await page.evaluate(hidePinned, { ref: cand.ref, rescan: true }).catch(() => 0);
  let placed = await page.evaluate(placeBlock, { ref: cand.ref, scroll: true });
  await step(ctl, page, CLIP_THRESHOLDS.settleMs);
  placed = await page.evaluate(placeBlock, { ref: cand.ref, scroll: false });
  if (!placed.ok) {
    out.verdict = 'failed';
    out.error = 'not-on-screen';
    return;
  }

  // 6.3 step 3: a video must be playing; a muted autoplay one the browser held back gets one play().
  let videoSeconds = 0;
  if (cand.hint === 'video') {
    let st = await page.evaluate(videoState, cand.ref);
    if (st.found && st.error) {
      out.verdict = 'failed';
      out.error = 'codec';
      return;
    }
    const ready = (s: typeof st) => s.readyState >= 3 && !s.paused;
    const until = Date.now() + 4000;
    while (st.found && !ready(st) && Date.now() < until) {
      await step(ctl, page, 300);
      st = await page.evaluate(videoState, cand.ref);
      if (st.error) {
        out.verdict = 'failed';
        out.error = 'codec';
        return;
      }
    }
    if (st.found && !ready(st)) {
      if (!st.autoplay) {
        out.verdict = 'click-to-play';
        return;
      }
      if (st.paused && (await page.evaluate(startVideo, cand.ref))) {
        const until2 = Date.now() + 4000;
        while (!ready(st) && Date.now() < until2) {
          await step(ctl, page, 300);
          st = await page.evaluate(videoState, cand.ref);
          if (st.error) {
            out.verdict = 'failed';
            out.error = 'codec';
            return;
          }
        }
      }
    }
    videoSeconds = st.duration;
  }

  // 6.3 steps 4 and 5: the pixel test.
  const test = await movingTest(page, placed.rect, cand.hint, ctl);
  if (!test.moving) {
    out.verdict = 'not-moving';
    return;
  }
  if (ctl.aborted) throw new Error('aborted');
  placed = await page.evaluate(placeBlock, { ref: cand.ref, scroll: false });
  // 6.4: record, slowed down. Embeds (their inside is another site's frame) and animated GIFs cannot be slowed.
  const normalSpeed = cand.hint === 'embed' || (await page.evaluate(hasGif, cand.ref).catch(() => false));
  await recordFrames(page, env, framesDir, ctl, out, {
    placed,
    contentMs: recordMs(cand.hint, videoSeconds),
    maxContentMs: cand.hint === 'carousel' ? 10_000 : undefined,
    normalSpeed,
    deadline,
    untilChange: cand.hint === 'carousel',
    // Videos start from their beginning (6.4 step 3), already at the slowed speed.
    beforeStart:
      cand.hint === 'video' || cand.hint === 'embed'
        ? async () => {
            await page.evaluate(rewindVideos, cand.ref).catch(() => 0);
          }
        : undefined,
  });
}

/** Has the picture changed since the first frame? Compares the first and the newest frame, 64 px greyscale. */
async function changed(dir: string, frames: { file: string }[]): Promise<boolean> {
  const small = async (f: string) => sharp(await readFile(path.join(dir, f))).resize({ width: 64 }).greyscale().raw().toBuffer();
  const a = await small(frames[0].file);
  const b = await small(frames[frames.length - 1].file);
  return diffShare(a, b) > CLIP_THRESHOLDS.movingShare;
}

/**
 * Did the picture change at any point? The first frame against frames at a quarter, half, three quarters and
 * the end (a slider pressed three times can come back to its first slide). `crop` (frame pixels) limits it to
 * the slider itself, so something else moving in the block (abelfragrance.com's drifting colour gradient,
 * 18 Nov 2026) does not count as the slider moving.
 */
export async function changedAnywhere(
  dir: string,
  frames: { file: string }[],
  crop?: { left: number; top: number; width: number; height: number },
  /** Small changes matter for some interactions (a price, a selected option): compare finer, with a lower bar. */
  fine?: { size: number; share: number },
): Promise<boolean> {
  if (frames.length < 2) return false;
  const px = fine?.size ?? 64;
  const bar = fine?.share ?? CLIP_THRESHOLDS.movingShare;
  const small = async (f: string) => {
    let img = sharp(await readFile(path.join(dir, f)));
    if (crop) img = img.extract(crop);
    return img.resize({ width: px, height: px, fit: 'fill' }).greyscale().raw().toBuffer();
  };
  const a = await small(frames[0].file);
  for (const q of [0.25, 0.5, 0.75, 1]) {
    const f = frames[Math.min(frames.length - 1, Math.max(1, Math.round((frames.length - 1) * q)))];
    if (diffShare(a, await small(f.file)) > bar) return true;
  }
  return false;
}

/** Runs one candidate inside its time limit; on timeout it is aborted and marked failed. */
export async function withLimit(limitMs: number, out: RawClip, run: (ctl: Control) => Promise<void>): Promise<void> {
  const ctl: Control = { aborted: false };
  const work = run(ctl).catch((e: Error) => {
    if (e.message !== 'aborted') {
      out.verdict = 'failed';
      out.error = e.message.split('\n')[0];
    }
  });
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), limitMs);
  });
  const r = await Promise.race([work.then(() => 'done' as const), limit]);
  if (timer) clearTimeout(timer);
  if (r === 'timeout') {
    ctl.aborted = true;
    await Promise.race([work, new Promise((res) => setTimeout(res, 3000))]);
    out.verdict = 'failed';
    out.error = 'candidate-timeout';
    delete out.frames;
  }
}

const describe = (c: RawClip) =>
  `${c.verdict}${c.error ? ' ' + c.error : ''}${c.frames ? ` · ${c.frames.length} frames` : ''}${c.slowdown ? ` · slowed x${c.slowdown}` : ''}${c.captureFps ? ` (${c.captureFps} shots/s)` : ''} · ${(c.ms / 1000).toFixed(1)}s`;

/** The slider's own box in frame pixels, for changedAnywhere; undefined when it cannot be worked out. */
export async function sliderCrop(out: RawClip, focus: Placement['focus'], vh: number): Promise<{ left: number; top: number; width: number; height: number } | undefined> {
  if (!focus || !out.frames?.length || !out.framesDir || !out.viewportWidth) return undefined;
  const meta = await sharp(path.join(out.framesDir, out.frames[0].file)).metadata();
  const fw = meta.width || 0;
  const fh = meta.height || 0;
  const reg = out.frameRegion || { x: 0, y: 0, width: out.viewportWidth, height: vh };
  if (!fw || !fh || !reg.width) return undefined;
  const s = fw / reg.width;
  const left = Math.max(0, Math.round((focus.x - reg.x) * s));
  const top = Math.max(0, Math.round((focus.y - reg.y) * s));
  const width = Math.min(fw - left, Math.round(focus.width * s));
  const height = Math.min(fh - top, Math.round(focus.height * s));
  return width >= 16 && height >= 16 ? { left, top, width, height } : undefined;
}

/**
 * Candidates of one page and viewport: find, verify, record. Never throws; a failed candidate carries its
 * error and the next one goes on.
 */
export async function recordClips(page: Page, env: ClipEnv): Promise<RawClip[]> {
  const results: RawClip[] = [];
  let cands: MotionCandidate[] = [];
  try {
    cands = await page.evaluate(motionHints, Math.min(env.maxClips, CLIP_THRESHOLDS.maxPerPage));
  } catch (e) {
    env.log(`  motion hints failed: ${(e as Error).message.split('\n')[0]}`);
    return results;
  }
  const pageStart = Date.now();
  for (const cand of cands) {
    const out: RawClip = { ref: cand.ref, index: cand.index, motionHint: cand.hint, why: cand.why, verdict: 'failed', ms: 0 };
    results.push(out);
    if (Date.now() - pageStart > CLIP_THRESHOLDS.pageMs) {
      out.error = 'budget';
      continue;
    }
    const t0 = Date.now();
    await withLimit(CLIP_THRESHOLDS.candidateMs, out, (ctl) => candidateInner(page, env, cand, path.join(env.framesRoot, cand.ref), ctl, out, t0 + CLIP_THRESHOLDS.candidateMs));
    out.ms = Date.now() - t0;
    await page.evaluate(restorePinned).catch(() => {});
    env.log(`  ${cand.ref} ${cand.hint} (${cand.why}): ${describe(out)}`);
  }
  return results;
}

const sameDoc = (u: string) => u.split('#')[0];

/**
 * A real click (desktop) or tap (phones) on the element matching `sel` when it is fully on screen and nothing
 * covers it, else a click from inside the page (no scrolling, no hover). False when it is gone.
 */
export async function pressSelector(page: Page, env: ClipEnv, sel: string): Promise<boolean> {
  const at = await page.evaluate(controlPoint, sel).catch(() => null);
  if (at) {
    if (env.touch) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    return true;
  }
  return page.evaluate(clickControl, sel).catch(() => false);
}

/**
 * Presses the slider once: a real click (desktop) or tap (phones) on its arrow or dot when it is on screen and
 * uncovered, else a click from inside the page; or scrolls its track by one slide; or (phones) swipes it.
 * Returns false when there was nothing left to press.
 */
async function press(page: Page, env: ClipEnv, plan: SliderPlan, i: number, wait: (pageMs: number) => Promise<void>, touch: () => Promise<CDPSession>): Promise<boolean> {
  if (plan.how === 'scroll') return page.evaluate(scrollTrack).catch(() => false);
  if (plan.how === 'swipe') {
    const box = await page.evaluate(trackBox).catch(() => null);
    const vh = page.viewportSize()?.height || 844;
    if (!box) return false;
    const cdp = await touch();
    const y = Math.min(vh - 10, Math.max(10, box.y + box.height / 2));
    const xa = box.x + box.width * 0.8;
    const xb = box.x + box.width * 0.2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xa, y }] });
    for (let s = 1; s <= 8; s++) {
      await wait(35);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: xa + ((xb - xa) * s) / 8, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return true;
  }
  const sel = plan.how === 'next' ? '[data-secslide="next"]' : `[data-secslide-dot="${i}"]`;
  const at = await page.evaluate(controlPoint, sel).catch(() => null);
  if (at) {
    if (env.touch) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    return true;
  }
  return page.evaluate(clickControl, sel).catch(() => false);
}

async function sliderInner(page: Page, env: ClipEnv, b: SliderBlock, framesDir: string, ctl: Control, out: RawClip, deadline: number, left: () => boolean): Promise<void> {
  await page.evaluate(hidePinned, { ref: b.ref, rescan: true }).catch(() => 0);
  let placed = await page.evaluate(placeSlider, { ref: b.ref, scroll: true });
  await step(ctl, page, CLIP_THRESHOLDS.settleMs);
  placed = await page.evaluate(placeSlider, { ref: b.ref, scroll: false });
  if (!placed.ok) {
    out.error = 'not-on-screen';
    return;
  }
  const plan = await page.evaluate(planSlider, { ref: b.ref, touch: !!env.touch });
  out.pressed = true;
  out.why = plan.ok ? `slider ${plan.how}: ${plan.why}` : 'slider';
  if (!plan.ok) {
    out.verdict = 'not-moving';
    out.error = plan.why || 'no-control';
    return;
  }
  const presses = plan.how === 'dots' ? Math.max(1, Math.min(SLIDER_THRESHOLDS.presses, plan.dots - 1)) : SLIDER_THRESHOLDS.presses;
  const contentMs = SLIDER_THRESHOLDS.leadMs + presses * SLIDER_THRESHOLDS.gapMs + SLIDER_THRESHOLDS.tailMs;
  const normalSpeed = await page.evaluate(hasGif, b.ref).catch(() => false);
  let touchCdp: CDPSession | null = null;
  const touch = async () => (touchCdp ??= await env.context.newCDPSession(page));
  try {
    await recordFrames(page, env, framesDir, ctl, out, {
      placed,
      contentMs,
      normalSpeed,
      deadline,
      during: async (wait) => {
        await wait(SLIDER_THRESHOLDS.leadMs);
        for (let i = 1; i <= presses; i++) {
          const pressed = await press(page, env, plan, i, wait, touch);
          if (left() || !pressed) break;
          await wait(SLIDER_THRESHOLDS.gapMs);
        }
        if (!left()) await wait(SLIDER_THRESHOLDS.tailMs);
      },
    });
  } finally {
    if (touchCdp) await (touchCdp as CDPSession).detach().catch(() => {});
  }
  if (left()) return;
  // A press that did nothing to the slider itself (the arrow was decorative or belonged to something else, the
  // slider was at its end) leaves no clip.
  const crop = await sliderCrop(out, placed.focus, page.viewportSize()?.height || 900).catch(() => undefined);
  if (out.verdict === 'recorded' && out.frames && !(await changedAnywhere(framesDir, out.frames, crop).catch(() => false))) {
    out.verdict = 'not-moving';
    out.error = 'no-change';
    delete out.frames;
  }
}

/**
 * Sliders that do not move by themselves (Ben, 18 Nov 2026): after the block stills, press each slider's own
 * "next" arrow (or its dots, or scroll its track, or swipe it on phones) a few times while recording, in slow
 * motion like every clip. `skip` = blocks that already have a clip. Never throws. If the page address changes
 * or a new tab opens, it stops at once and records nothing more (the new tab is closed).
 */
export async function recordSliderClips(page: Page, env: ClipEnv, skip: Set<string>): Promise<RawClip[]> {
  const results: RawClip[] = [];
  let blocks: SliderBlock[] = [];
  try {
    blocks = (await page.evaluate(sliderBlocks, 60)).filter((b) => !skip.has(b.ref)).slice(0, SLIDER_THRESHOLDS.maxPerPage);
  } catch (e) {
    env.log(`  sliders failed: ${(e as Error).message.split('\n')[0]}`);
    return results;
  }
  if (!blocks.length) return results;
  const startUrl = sameDoc(page.url());
  let opened = false;
  const onPage = (p: Page) => {
    opened = true;
    p.close().catch(() => {});
  };
  env.context.on('page', onPage);
  const left = () => opened || sameDoc(page.url()) !== startUrl;
  const pageStart = Date.now();
  try {
    for (const b of blocks) {
      const out: RawClip = { ref: b.ref, index: b.index, motionHint: 'carousel', why: 'slider', verdict: 'failed', ms: 0 };
      results.push(out);
      if (Date.now() - pageStart > SLIDER_THRESHOLDS.pageMs) {
        out.error = 'budget';
        continue;
      }
      const t0 = Date.now();
      await withLimit(SLIDER_THRESHOLDS.candidateMs, out, (ctl) => sliderInner(page, env, b, path.join(env.framesRoot, `${b.ref}-slider`), ctl, out, t0 + SLIDER_THRESHOLDS.candidateMs, left));
      out.ms = Date.now() - t0;
      if (left()) {
        out.verdict = 'failed';
        out.error = 'navigated';
        delete out.frames;
        env.log(`  ${b.ref} ${out.why}: left the page, sliders stopped`);
        break;
      }
      await page.evaluate(restorePinned).catch(() => {});
      env.log(`  ${b.ref} ${out.why}: ${describe(out)}`);
    }
  } finally {
    env.context.off('page', onPage);
  }
  return results;
}
