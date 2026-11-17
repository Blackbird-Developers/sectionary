// Functions in this file run INSIDE the captured web page (Playwright serialises them with page.evaluate).
// They must be self-contained: no imports, no closures over anything outside the function body.
// Clips brief (video-sections-brief.md), sections 6.2 and 6.3. They only read the page and, for a muted
// autoplay video the browser held back, call play() once. Nothing here clicks or types.

export type MotionHint = 'video' | 'embed' | 'carousel' | 'marquee' | 'animation';

export type MotionCandidate = { ref: string; index: number; hint: MotionHint; why: string };

export type BoxInfo = { x: number; y: number; width: number; height: number };

export type Placement = {
  ok: boolean;
  /** The part of the block that is on screen, in viewport CSS pixels: the block's box cut to the viewport. */
  rect: BoxInfo;
  /** The whole block in viewport CSS pixels (its top-left is the origin of the manifest's clip.rect). */
  block: BoxInfo;
  vw: number;
  vh: number;
};

export type VideoState = {
  found: boolean;
  readyState: number;
  paused: boolean;
  /** MediaError code (1 aborted, 2 network, 3 decode, 4 source not supported), or null. */
  error: number | null;
  duration: number;
  autoplay: boolean;
  muted: boolean;
};

/**
 * Brief 6.2. Reads the blocks collectBlocks already tagged with data-secref and nominates the ones that may
 * move by themselves. A hint only nominates; the pixel test in clips.ts decides. First match wins, in the
 * order video, embed, carousel, marquee, animation. At most `maxPerPage`, video and embed first, then
 * carousel, marquee, animation, each group in page order; the answer is in page order.
 * The 30% share is the brief's starting value (keep it in step with CLIP_THRESHOLDS.areaShare in clips.ts).
 */
export function motionHints(maxPerPage: number): MotionCandidate[] {
  const AREA_SHARE = 0.3;
  const CAROUSEL = /slideshow|slider|carousel|swiper|splide|flickity|slick|glide|embla/i;
  const MARQUEE = /\bmarquee\b|\bticker\b|scrolling-(text|banner)/i;
  const SLIDES =
    '[class*="slide" i], [class*="carousel-item" i], [class*="carousel__item" i], [class*="carousel-cell" i], [class*="flickity-cell" i], [class*="glide__slide" i], [class*="embla__slide" i], [aria-roledescription="slide"]';
  const LOTTIE = 'lottie-player, dotlottie-player, dotlottie-wc, lottie-animation';

  const visible = (el: Element): DOMRect | null => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const classText = (el: Element): string => {
    const c = el.getAttribute('class') || '';
    return (el.getAttribute('id') || '') + ' ' + c;
  };

  const found: MotionCandidate[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-secref]'))) {
    const ref = el.getAttribute('data-secref') || '';
    const index = Number(ref.replace(/^b/, '')) || 0;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.position === 'fixed' || cs.display === 'none' || box.height < 120 || box.width < 1) continue;
    const area = box.width * box.height;
    const big = (r: DOMRect | null) => !!r && (r.width * r.height) / area >= AREA_SHARE;

    let hint: MotionHint | null = null;
    let why = '';

    // video: autoplay attribute, or already playing, covering at least 30% of the block.
    for (const v of Array.from(el.querySelectorAll('video'))) {
      const r = visible(v);
      if (big(r) && (v.hasAttribute('autoplay') || !v.paused)) {
        hint = 'video';
        why = v.hasAttribute('autoplay') ? 'video[autoplay]' : 'video playing';
        break;
      }
    }
    // A video inside slide structure (several slides, or a slider class) is a carousel: the video is one slide.
    if (hint === 'video') {
      let named = CAROUSEL.test(classText(el));
      if (!named) {
        for (const d of Array.from(el.querySelectorAll('[class]')).slice(0, 800)) {
          if (CAROUSEL.test(d.getAttribute('class') || '')) {
            named = true;
            break;
          }
        }
      }
      if (named || el.querySelectorAll(SLIDES).length >= 2) {
        hint = 'carousel';
        why = 'video + slides';
      }
    }
    // embed: YouTube / Vimeo / VideoPress iframe set to play by itself.
    if (!hint) {
      for (const f of Array.from(el.querySelectorAll('iframe'))) {
        const src = f.getAttribute('src') || f.getAttribute('data-src') || '';
        if (!/youtube|vimeo|videopress/i.test(src) || !/autoplay=1|background=1/i.test(src)) continue;
        if (big(visible(f))) {
          hint = 'embed';
          why = 'iframe autoplay';
          break;
        }
      }
    }
    // carousel: a slider class, id or descendant class, and at least two slide-like children.
    if (!hint) {
      let named = CAROUSEL.test(classText(el));
      if (!named) {
        for (const d of Array.from(el.querySelectorAll('[class]')).slice(0, 800)) {
          if (CAROUSEL.test(d.getAttribute('class') || '')) {
            named = true;
            break;
          }
        }
      }
      if (named && el.querySelectorAll(SLIDES).length >= 2) {
        hint = 'carousel';
        why = 'slider class + slides';
      }
    }
    // marquee / animation: a running CSS animation that never ends, or the marquee class names.
    let infinite: { moves: boolean } | null = null;
    if (!hint) {
      const anims = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }) : [];
      for (const a of anims) {
        if (!(typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation)) continue;
        if (a.playState !== 'running') continue;
        const eff = a.effect as KeyframeEffect | null;
        if (!eff || eff.getComputedTiming().iterations !== Infinity) continue;
        const target = eff.target;
        if (!target || !visible(target)) continue;
        let moves = /marquee|scroll|ticker|slide/i.test(a.animationName || '');
        try {
          for (const k of eff.getKeyframes()) {
            const t = String((k as Record<string, unknown>).transform || '') + String((k as Record<string, unknown>).translate || '');
            if (/translate/i.test(t)) moves = true;
          }
        } catch {
          /* keyframes unreadable */
        }
        infinite = { moves };
        if (moves) break;
      }
      let marqueeName = MARQUEE.test(classText(el));
      if (!marqueeName) {
        for (const d of Array.from(el.querySelectorAll('[class]')).slice(0, 800)) {
          if (MARQUEE.test(d.getAttribute('class') || '')) {
            marqueeName = true;
            break;
          }
        }
      }
      if (el.querySelector('marquee')) marqueeName = true;
      if (marqueeName || (infinite && infinite.moves)) {
        hint = 'marquee';
        why = marqueeName ? 'marquee class' : 'infinite translate animation';
      } else if (infinite) {
        hint = 'animation';
        why = 'infinite css animation';
      } else if (el.querySelector(LOTTIE)) {
        hint = 'animation';
        why = 'lottie';
      } else {
        for (const c of Array.from(el.querySelectorAll('canvas'))) {
          if (big(visible(c))) {
            hint = 'animation';
            why = 'canvas';
            break;
          }
        }
      }
    }
    if (hint) found.push({ ref, index, hint, why });
  }

  const rank = (h: MotionHint) => (h === 'video' || h === 'embed' ? 0 : h === 'carousel' ? 1 : h === 'marquee' ? 2 : 3);
  const picked = found
    .slice()
    .sort((a, b) => rank(a.hint) - rank(b.hint) || a.index - b.index)
    .slice(0, maxPerPage);
  return picked.sort((a, b) => a.index - b.index);
}

/**
 * Brief 6.3 step 1: scroll so the block's top is at the viewport top, or centre it when it is shorter than
 * the viewport, and say which part is on screen. Call it again after the scroll has settled.
 */
export function placeBlock(arg: { ref: string; scroll: boolean }): Placement {
  const empty: BoxInfo = { x: 0, y: 0, width: 0, height: 0 };
  const el = document.querySelector(`[data-secref="${arg.ref}"]`);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el) return { ok: false, rect: empty, block: empty, vw, vh };
  if (arg.scroll) {
    const r0 = el.getBoundingClientRect();
    const absTop = r0.top + window.scrollY;
    const top = r0.height < vh ? absTop - (vh - r0.height) / 2 : absTop;
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' as ScrollBehavior });
  }
  const r = el.getBoundingClientRect();
  const x0 = Math.max(0, r.left);
  const y0 = Math.max(0, r.top);
  const x1 = Math.min(vw, r.right);
  const y1 = Math.min(vh, r.bottom);
  const rect = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  return { ok: rect.width > 1 && rect.height > 1, rect, block: { x: r.left, y: r.top, width: r.width, height: r.height }, vw, vh };
}

/** The biggest visible <video> of the block: what the brief's step 3 reads. */
export function videoState(ref: string): VideoState {
  const el = document.querySelector(`[data-secref="${ref}"]`);
  const none: VideoState = { found: false, readyState: 0, paused: true, error: null, duration: 0, autoplay: false, muted: false };
  if (!el) return none;
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of Array.from(el.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    if (r.width * r.height > bestArea) {
      best = v;
      bestArea = r.width * r.height;
    }
  }
  if (!best) return none;
  return {
    found: true,
    readyState: best.readyState,
    paused: best.paused,
    error: best.error ? best.error.code : null,
    duration: Number.isFinite(best.duration) ? best.duration : 0,
    autoplay: best.hasAttribute('autoplay'),
    muted: best.muted || best.hasAttribute('muted'),
  };
}

/**
 * Brief 6.3 step 3: a muted autoplay video the headless browser held back gets one play(), which is what a
 * real browser would have done. A video without the autoplay attribute is click-to-play: left alone.
 * Returns true when play() was called.
 */
export async function startVideo(ref: string): Promise<boolean> {
  const el = document.querySelector(`[data-secref="${ref}"]`);
  if (!el) return false;
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of Array.from(el.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    if (r.width * r.height > bestArea) {
      best = v;
      bestArea = r.width * r.height;
    }
  }
  if (!best || !best.paused || !best.hasAttribute('autoplay') || !(best.muted || best.hasAttribute('muted'))) return false;
  best.muted = true;
  try {
    await best.play();
  } catch {
    /* blocked or failed: the caller reads the state again */
  }
  return true;
}

/** Brief 6.4 step 3: every video of the block starts from its beginning. Returns the longest duration (seconds). */
export function rewindVideos(ref: string): number {
  const el = document.querySelector(`[data-secref="${ref}"]`);
  if (!el) return 0;
  let longest = 0;
  for (const v of Array.from(el.querySelectorAll('video'))) {
    try {
      v.currentTime = 0;
    } catch {
      /* not seekable */
    }
    if (Number.isFinite(v.duration) && v.duration > longest) longest = v.duration;
  }
  return longest;
}
