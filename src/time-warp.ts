// Slow motion for clips (Ben, 18 Nov 2026: "some of them are very laggy"). The recorder can only take pictures
// as fast as the PC allows: the 17-18 Nov backfill measured a median of 20 pictures per second on desktop and
// 14 on phones (the phone loop takes a full 780 px screenshot per frame), so a clip recorded in real time
// stutters. Instead the page is slowed down while it is recorded, and the encoder speeds the frames back up:
// a page slowed 4 times gives 4 times as many pictures per second of clip.
//
// What is slowed: the page's JavaScript clock (timers, requestAnimationFrame, performance.now, Date), its CSS
// animations and transitions (DevTools' Animation.setPlaybackRate) and its <video> and <audio> elements
// (playbackRate). Things that cannot be slowed (animated GIFs, the inside of YouTube or Vimeo embeds) would play
// too fast in the clip, so clips.ts records those blocks at normal speed.
//
// Nothing here clicks, types or fetches. It only changes how fast time passes inside our own browser.
import type { CDPSession, Page } from 'playwright';

/** All slow-motion limits in one place. */
export const SLOWMO = {
  /** Pictures per second of clip we aim for (the encoder writes 30 fps). */
  targetFps: 30,
  /** Never slow a page more than this: longer recordings, and video decoders dislike very low rates. */
  maxSlowdown: 8,
  /** A slowed recording never runs longer than this in real time. */
  maxRealMs: 40_000,
  /** Used when the capture rate could not be measured. */
  unknownSlowdown: 4,
};

/**
 * How much to slow the page: enough that the measured capture rate (`fps`, pictures per real second) gives
 * targetFps pictures per clip second, within the limits. `contentMs` is the clip's length in page time.
 */
export function chooseSlowdown(fps: number, contentMs: number, limits: typeof SLOWMO = SLOWMO): number {
  const room = Math.max(1, Math.floor(limits.maxRealMs / Math.max(1, contentMs)));
  const want = fps > 0 ? Math.ceil(limits.targetFps / fps) : limits.unknownSlowdown;
  return Math.max(1, Math.min(want, limits.maxSlowdown, room));
}

/**
 * Installed with context.addInitScript when clips are on, so it runs in every frame before the page's own
 * scripts. It replaces the page's clock with one whose speed can change: setTimeout, setInterval,
 * requestAnimationFrame, performance.now and Date all read it. At speed 1 (always, except while a clip is being
 * recorded) everything behaves as before. window.__secWarp.setRate(r) changes the speed; pending timers keep
 * their due time in page time and are rescheduled. While slowed, requestAnimationFrame callbacks run once per
 * 1/60 s of page time, so animations that count frames instead of reading the clock slow down too.
 */
export const TIME_WARP_SCRIPT = `(() => {
  if (window.__secWarp) return;
  const W = window, P = W.performance;
  if (!P || typeof P.now !== 'function' || typeof W.setTimeout !== 'function') return;
  const realNow = P.now.bind(P);
  const RealDate = W.Date;
  const realST = W.setTimeout.bind(W), realCT = W.clearTimeout.bind(W);
  const realRAF = typeof W.requestAnimationFrame === 'function' ? W.requestAnimationFrame.bind(W) : null;
  let rate = 1, aReal = realNow(), aVirt = aReal;
  const virtAt = (t) => aVirt + (t - aReal) * rate;
  const virt = () => virtAt(realNow());
  const epoch = RealDate.now() - realNow();

  const timers = new Map();
  let seq = 0;
  const arm = (id, t) => { t.h = realST(fire, Math.max(0, (t.due - virt()) / rate), id); };
  const fire = (id) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.period === null) timers.delete(id);
    else { t.due = Math.max(t.due + t.period, virt()); arm(id, t); }
    if (typeof t.fn === 'function') t.fn.apply(W, t.args);
    else (0, eval)(String(t.fn));
  };
  const add = (fn, delay, args, periodic) => {
    const id = ++seq, d = Math.max(0, Number(delay) || 0);
    const t = { fn, args, period: periodic ? Math.max(4, d) : null, due: virt() + d, h: 0 };
    timers.set(id, t);
    arm(id, t);
    return id;
  };
  const clear = (id) => { const t = timers.get(id); if (t) { realCT(t.h); timers.delete(id); } };
  W.setTimeout = function setTimeout(fn, delay, ...args) { return add(fn, delay, args, false); };
  W.setInterval = function setInterval(fn, delay, ...args) { return add(fn, delay, args, true); };
  W.clearTimeout = function clearTimeout(id) { clear(id); };
  W.clearInterval = function clearInterval(id) { clear(id); };

  if (realRAF) {
    const queue = new Map();
    let rseq = 0, pending = false, lastV = -1e9;
    const pump = () => { if (!pending && queue.size) { pending = true; realRAF(tick); } };
    // The frame's own timestamp is not used: DevTools' Animation.setPlaybackRate already slows it, so mapping it
    // through the warp would slow animations twice (measured 18 Nov 2026: 7 frames in 2 s at rate 0.25, not 30).
    const tick = () => {
      pending = false;
      const v = virt();
      if (rate < 1 && v - lastV < 16) { pump(); return; }
      lastV = v;
      const due = Array.from(queue.values());
      queue.clear();
      for (const cb of due) { try { cb(v); } catch (e) { realST(() => { throw e; }, 0); } }
    };
    W.requestAnimationFrame = function requestAnimationFrame(cb) { const id = ++rseq; queue.set(id, cb); pump(); return id; };
    W.cancelAnimationFrame = function cancelAnimationFrame(id) { queue.delete(id); };
  }

  try { Object.defineProperty(P, 'now', { value: function now() { return virt(); }, configurable: true, writable: true }); } catch (e) {}

  const VDate = function Date(...a) {
    if (!new.target) return new RealDate(epoch + virt()).toString();
    return a.length ? new RealDate(...a) : new RealDate(epoch + virt());
  };
  VDate.prototype = RealDate.prototype;
  VDate.now = function now() { return Math.floor(epoch + virt()); };
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  try { RealDate.prototype.constructor = VDate; } catch (e) {}
  W.Date = VDate;

  const setRate = (r) => {
    r = Number(r);
    if (!(r > 0) || r === rate) return rate;
    const now = realNow();
    aVirt = virtAt(now);
    aReal = now;
    rate = r;
    for (const [id, t] of timers) { realCT(t.h); arm(id, t); }
    return rate;
  };
  Object.defineProperty(W, '__secWarp', { value: { setRate, rate: () => rate, now: virt }, configurable: false, enumerable: false });
})();`;

/**
 * Sets the speed of time in every frame of the page: the clock above, every <video> and <audio>, and (through
 * the DevTools session) every CSS animation and transition. rate 0.25 = four times slower; 1 = normal.
 * Never throws; a frame that does not answer within 2 s is left as it is.
 */
export async function setPageRate(page: Page, cdp: CDPSession | null, rate: number): Promise<void> {
  const inFrame = (r: number) => {
    const w = window as unknown as { __secWarp?: { setRate(r: number): number } };
    if (w.__secWarp) w.__secWarp.setRate(r);
    for (const m of Array.from(document.querySelectorAll('video, audio'))) {
      try {
        // The default too: a video that loads its source after this (a player started by a press) would
        // otherwise come back to normal speed (play-clips.ts).
        (m as HTMLMediaElement).defaultPlaybackRate = r;
        (m as HTMLMediaElement).playbackRate = r;
      } catch {
        /* a player that refuses the rate keeps its own */
      }
    }
  };
  await Promise.all(
    page.frames().map((f) => Promise.race([f.evaluate(inFrame, rate).catch(() => {}), new Promise((res) => setTimeout(res, 2000))])),
  );
  if (cdp) {
    await cdp.send('Animation.enable').catch(() => {});
    await cdp.send('Animation.setPlaybackRate', { playbackRate: rate }).catch(() => {});
  }
}
