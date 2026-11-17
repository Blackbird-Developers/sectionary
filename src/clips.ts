// Clips brief sections 6.3 and 6.4: for each block that may move by itself, test that it really does
// (two screenshots, a few seconds apart, compared in a tiny greyscale version) and record it with the
// Chromium DevTools screencast (phones: a screenshot loop, see below). Frames are written to disk under the output folder (the C: drive is full,
// so never the system temp folder); clip-encode.ts turns them into an MP4 after the page is closed.
// Nothing here clicks, types or fetches: the only traffic is the page's own playback.
import type { BrowserContext, Page } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { motionHints, placeBlock, rewindVideos, startVideo, videoState, type MotionCandidate, type MotionHint, type Placement } from './clip-script.js';
import { hidePinned, restorePinned } from './page-script.js';

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
  candidateMs: 16_000,
  pageMs: 45_000,
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
  /** Phone screenshot loop only: the part of the viewport (CSS px) the frames show. Absent = whole viewport. */
  frameRegion?: { x: number; y: number; width: number; height: number };
  /** Seconds the motion test and the recording took. */
  ms: number;
};

export type ClipEnv = {
  context: BrowserContext;
  /** Where frames go: <out>/_frames/<host>/<slug>/<d|m>/ . */
  framesRoot: string;
  maxClips: number;
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

type Control = { aborted: boolean };

async function step(ctl: Control, page: Page, ms: number): Promise<void> {
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

/** The recording length for the kind (brief 6.4 table). Carousels may be extended while recording. */
function recordMs(hint: MotionHint, videoSeconds: number): number {
  if (hint === 'video' || hint === 'embed') return videoSeconds >= 3 && videoSeconds <= 8 ? Math.round(videoSeconds * 1000) : 5000;
  if (hint === 'carousel') return 7000;
  if (hint === 'marquee') return 4000;
  return 5000;
}

async function candidateInner(page: Page, env: ClipEnv, cand: MotionCandidate, framesDir: string, ctl: Control, out: RawClip, deadline: number): Promise<void> {
  const check = () => {
    if (ctl.aborted) throw new Error('aborted');
  };
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

  // 6.4: record. Videos start from their beginning.
  check();
  if (cand.hint === 'video' || cand.hint === 'embed') {
    const d = await page.evaluate(rewindVideos, cand.ref);
    if (d) videoSeconds = d;
  }
  placed = await page.evaluate(placeBlock, { ref: cand.ref, scroll: false });
  // Whatever the motion test used up, the candidate must end inside its 16 s (1.2 s left for stopping and writing).
  const room = deadline - 1200 - Date.now();
  const ms = Math.min(recordMs(cand.hint, videoSeconds), room);
  if (ms < 3000) {
    out.verdict = 'failed';
    out.error = 'no-time-left';
    return;
  }
  await mkdir(framesDir, { recursive: true });
  const size = page.viewportSize() || { width: 1440, height: 900 };
  // Device resolution (Ben, 17 Nov 2026: sharper clips): 2880x1800 desktop, 780x1688 mobile.
  const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  const cdp = await env.context.newCDPSession(page);
  const frames: { file: string; ts: number }[] = [];
  const writes: Promise<void>[] = [];
  // Phones use a screenshot loop instead of the screencast: in headless Chromium the screencast always sends
  // 390x844 frames on a phone viewport whatever the scale settings (measured 17 Nov 2026), which is too soft.
  // Page.captureScreenshot at clip scale = devicePixelRatio gives 780 px wide frames at 10 to 20 fps.
  const phone = size.width < 768 && dpr > 1;
  let stopLoop = false;
  let loop: Promise<void> = Promise.resolve();
  if (phone) {
    const off = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })).catch(() => ({ x: 0, y: 0 }));
    // Only the block (plus a small margin) is captured: smaller frames run faster (bogeyboys: 14 fps whole
    // viewport, 21 fps block only). The encoder gets the region through frameRegion.
    const m = 8;
    const x0 = Math.max(0, Math.floor(placed.rect.x) - m);
    const y0 = Math.max(0, Math.floor(placed.rect.y) - m);
    const x1 = Math.min(size.width, Math.ceil(placed.rect.x + placed.rect.width) + m);
    const y1 = Math.min(size.height, Math.ceil(placed.rect.y + placed.rect.height) + m);
    const region = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
    out.frameRegion = region;
    loop = (async () => {
      while (!stopLoop) {
        const r = (await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85, clip: { x: off.x + region.x, y: off.y + region.y, width: region.width, height: region.height, scale: dpr } }).catch(() => null)) as { data: string } | null;
        if (!r) {
          if (stopLoop) break;
          await new Promise((res) => setTimeout(res, 50));
          continue;
        }
        const file = `${String(frames.length).padStart(5, '0')}.jpg`;
        frames.push({ file, ts: Date.now() / 1000 });
        writes.push(writeFile(path.join(framesDir, file), Buffer.from(r.data, 'base64')));
      }
    })();
  } else {
    cdp.on('Page.screencastFrame', (ev: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
      cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      const file = `${String(frames.length).padStart(5, '0')}.jpg`;
      frames.push({ file, ts: ev.metadata?.timestamp ?? Date.now() / 1000 });
      writes.push(writeFile(path.join(framesDir, file), Buffer.from(ev.data, 'base64')));
    });
  }
  const t0 = Date.now();
  try {
    if (!phone) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(size.width * dpr), maxHeight: Math.round(size.height * dpr), everyNthFrame: 1 });
    await step(ctl, page, ms);
    if (cand.hint === 'carousel') {
      // Extended to at most 10 s until one slide change has been seen, plus 1 s.
      const limit = Math.min(t0 + 10_000, deadline - 1200);
      while (Date.now() < limit) {
        await Promise.all(writes);
        if (frames.length > 1 && (await changed(framesDir, frames))) {
          await step(ctl, page, 1000);
          break;
        }
        await step(ctl, page, 500);
      }
    }
  } finally {
    stopLoop = true;
    if (!phone) await cdp.send('Page.stopScreencast').catch(() => {});
    await loop.catch(() => {});
    await Promise.all(writes).catch(() => {});
    await cdp.detach().catch(() => {});
  }
  out.verdict = 'recorded';
  out.framesDir = framesDir;
  out.frames = frames.slice();
  out.recordedMs = Date.now() - t0;
  out.rect = placed.rect;
  out.block = placed.block;
  out.viewportWidth = size.width;
}

/** Has the picture changed since the first frame? Compares the first and the newest frame, 64 px greyscale. */
async function changed(dir: string, frames: { file: string }[]): Promise<boolean> {
  const small = async (f: string) => sharp(await readFile(path.join(dir, f))).resize({ width: 64 }).greyscale().raw().toBuffer();
  const a = await small(frames[0].file);
  const b = await small(frames[frames.length - 1].file);
  return diffShare(a, b) > CLIP_THRESHOLDS.movingShare;
}

/**
 * Candidates of one page and viewport: find, verify, record. Never throws; a failed candidate carries its
 * error and the next one goes on. 16 s for each candidate, 45 s for the page.
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
    const ctl: Control = { aborted: false };
    const framesDir = path.join(env.framesRoot, cand.ref);
    const work = candidateInner(page, env, cand, framesDir, ctl, out, t0 + CLIP_THRESHOLDS.candidateMs).catch((e: Error) => {
      if (e.message !== 'aborted') {
        out.verdict = 'failed';
        out.error = e.message.split('\n')[0];
      }
    });
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CLIP_THRESHOLDS.candidateMs);
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
    out.ms = Date.now() - t0;
    await page.evaluate(restorePinned).catch(() => {});
    env.log(`  ${cand.ref} ${cand.hint} (${cand.why}): ${out.verdict}${out.error ? ' ' + out.error : ''}${out.frames ? ` · ${out.frames.length} frames` : ''} · ${(out.ms / 1000).toFixed(1)}s`);
  }
  return results;
}
