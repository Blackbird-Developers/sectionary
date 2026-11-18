// Functions in this file run INSIDE the captured web page (Playwright serialises them with page.evaluate).
// They must be self-contained: no imports, no closures over anything outside the function body.
// Clips brief (video-sections-brief.md), sections 6.2 and 6.3. They only read the page and, for a muted
// autoplay video the browser held back, call play() once. Nothing here types.
// Sliders (Ben, 18 Nov 2026): planSlider finds and marks a slider's own "next" arrow, dots or scrolling track,
// and scrollTrack moves such a track by one slide; clips.ts does the pressing.

export type MotionHint = 'video' | 'embed' | 'carousel' | 'marquee' | 'animation';

export type MotionCandidate = { ref: string; index: number; hint: MotionHint; why: string };

export type BoxInfo = { x: number; y: number; width: number; height: number };

export type Placement = {
  ok: boolean;
  /** The part of the block that is on screen, in viewport CSS pixels: the block's box cut to the viewport. */
  rect: BoxInfo;
  /** The whole block in viewport CSS pixels (its top-left is the origin of the manifest's clip.rect). */
  block: BoxInfo;
  /** placeSlider only: the slider itself, cut to the viewport (whether a press changed anything is judged here). */
  focus?: BoxInfo;
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

/**
 * Animated GIFs (an <img> or a CSS background) cannot be slowed down: in a slowed recording they would play too
 * fast. A block whose on-screen part is at least a quarter GIF is therefore recorded at normal speed
 * (time-warp.ts). Smaller ones (icons, a loading spinner, one product photo among many) are not worth a choppy
 * clip of everything else: allmatters.com's gallery and elavi.co's 72 px Instagram icon, 18 Nov 2026.
 */
export function hasGif(ref: string): boolean {
  const el = document.querySelector(`[data-secref="${ref}"]`);
  if (!el) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const seen = (b: DOMRect) => Math.max(0, Math.min(vw, b.right) - Math.max(0, b.left)) * Math.max(0, Math.min(vh, b.bottom) - Math.max(0, b.top));
  const area = seen(el.getBoundingClientRect());
  if (area < 1) return false;
  let gif = 0;
  const GIF = /\.gif(\?|#|$)|^data:image\/gif/i;
  for (const img of Array.from(el.querySelectorAll('img'))) {
    if (GIF.test(img.currentSrc || img.src || '')) gif += seen(img.getBoundingClientRect());
  }
  for (const d of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 400)]) {
    const bg = getComputedStyle(d).backgroundImage;
    if (bg && bg !== 'none' && /\.gif["')?#]/i.test(bg)) gif += seen(d.getBoundingClientRect());
  }
  return gif / area >= 0.25;
}

export type SliderBlock = { ref: string; index: number };

/**
 * Blocks that look like sliders: a slider class, id or descendant class, and at least two slide-like
 * elements (the same test as motionHints' carousel). In page order, at most `max`.
 */
export function sliderBlocks(max: number): SliderBlock[] {
  const CAROUSEL = /slideshow|slider|carousel|swiper|splide|flickity|slick|glide|embla/i;
  const SLIDES =
    '[class*="slide" i], [class*="carousel-item" i], [class*="carousel__item" i], [class*="carousel-cell" i], [class*="flickity-cell" i], [class*="glide__slide" i], [class*="embla__slide" i], [aria-roledescription="slide"]';
  const out: SliderBlock[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-secref]'))) {
    const ref = el.getAttribute('data-secref') || '';
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.position === 'fixed' || cs.display === 'none' || box.height < 120 || box.width < 1) continue;
    let named = CAROUSEL.test((el.getAttribute('id') || '') + ' ' + (el.getAttribute('class') || ''));
    if (!named) {
      for (const d of Array.from(el.querySelectorAll('[class]')).slice(0, 800)) {
        if (CAROUSEL.test(d.getAttribute('class') || '')) {
          named = true;
          break;
        }
      }
    }
    if (!named || el.querySelectorAll(SLIDES).length < 2) continue;
    out.push({ ref, index: Number(ref.replace(/^b/, '')) || 0 });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Like placeBlock, but centres the slider itself rather than the whole block, so a slider in the middle of a
 * tall block is on screen. Two elements matter: the outermost one named like a slider that holds two slides
 * (marked data-secslider: its arrows and dots are searched inside it, and it is centred), and the innermost one
 * (marked data-sectrack: the slides' own box, where a press must change something; `focus`). The rectangle is
 * still the block's on-screen part.
 */
export function placeSlider(arg: { ref: string; scroll: boolean }): Placement {
  const empty: BoxInfo = { x: 0, y: 0, width: 0, height: 0 };
  const el = document.querySelector(`[data-secref="${arg.ref}"]`);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el) return { ok: false, rect: empty, block: empty, vw, vh };
  const cut = (b: DOMRect): BoxInfo => {
    const x0 = Math.max(0, b.left);
    const y0 = Math.max(0, b.top);
    return { x: x0, y: y0, width: Math.max(0, Math.min(vw, b.right) - x0), height: Math.max(0, Math.min(vh, b.bottom) - y0) };
  };
  if (arg.scroll) {
    const CAROUSEL = /slideshow|slider|carousel|swiper|splide|flickity|slick|glide|embla/i;
    const SLIDES =
      '[class*="slide" i], [class*="carousel-item" i], [class*="carousel__item" i], [class*="carousel-cell" i], [class*="flickity-cell" i], [class*="glide__slide" i], [class*="embla__slide" i], [aria-roledescription="slide"]';
    const sliders = [el, ...Array.from(el.querySelectorAll('[class]')).slice(0, 800)].filter(
      (c) => CAROUSEL.test(c.getAttribute('class') || '') && c.querySelectorAll(SLIDES).length >= 2 && c.getBoundingClientRect().height >= 80,
    );
    const outer = sliders[0] || el;
    outer.setAttribute('data-secslider', '1');
    const r0 = outer.getBoundingClientRect();
    const absTop = r0.top + window.scrollY;
    const top = r0.height < vh ? absTop - (vh - r0.height) / 2 : absTop;
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' as ScrollBehavior });
    // The slides' own box: the smallest slider-named element inside the outer one, if it is not a sliver of it.
    const seen = (e: Element) => {
      const b = cut(e.getBoundingClientRect());
      return b.width * b.height;
    };
    let inner: Element = outer;
    for (const c of sliders) if (outer.contains(c) && seen(c) < seen(inner) && seen(c) >= 0.25 * seen(outer)) inner = c;
    inner.setAttribute('data-sectrack', '1');
  }
  const r = el.getBoundingClientRect();
  const rect = cut(r);
  const t = el.matches('[data-sectrack]') ? el : el.querySelector('[data-sectrack]');
  const focus = t ? cut(t.getBoundingClientRect()) : rect;
  return { ok: rect.width > 1 && rect.height > 1, rect, block: { x: r.left, y: r.top, width: r.width, height: r.height }, focus, vw, vh };
}

export type SliderPlan = {
  ok: boolean;
  /** next = its "next" arrow; dots = its pagination dots; scroll = a track that scrolls sideways; swipe = phones only, a swipe on the slider. */
  how: 'next' | 'dots' | 'scroll' | 'swipe' | 'none';
  /** dots: how many dots the group has. */
  dots: number;
  why: string;
};

/**
 * How to move the slider in block `ref` to its next slide without leaving the page: its own "next" arrow,
 * else its dots, else a sideways-scrolling track, else (phones) a swipe. What it finds is marked with
 * data-secslide ("next", "track") or data-secslide-dot (1, 2, 3 = the 2nd, 3rd and 4th dot).
 * Never a link to another page, never anything inside a form, never a disabled control.
 */
export function planSlider(arg: { ref: string; touch: boolean }): SliderPlan {
  const none: SliderPlan = { ok: false, how: 'none', dots: 0, why: '' };
  const el = document.querySelector(`[data-secref="${arg.ref}"]`);
  if (!el) return { ...none, why: 'no-block' };
  // The slider placeSlider found: the block itself or something inside it.
  const marked = el.matches('[data-secslider]') ? el : el.querySelector('[data-secslider]');
  const root = marked || el;
  const NEXT = /(\bnext\b|\bforward\b|suivant|weiter|nächste|siguiente|successivo|volgende|próximo|›|»|→|❯|chevron[-_]?right|arrow[-_]?right|right[-_]?arrow|arrow--right|icon-right|--next|__next|[-_]next\b|\bnext[-_])/i;
  const PREV = /(\bprev(ious)?\b|\bback\b|précédent|zurück|anterior|precedente|vorige|‹|«|←|❮|chevron[-_]?left|arrow[-_]?left|left[-_]?arrow|arrow--left|icon-left|--prev|__prev|[-_]prev\b|\bprev[-_])/i;
  const shown = (e: Element): DOMRect | null => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return null;
    const r = e.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8 ? r : null;
  };
  const leaves = (e: Element): boolean => {
    const a = e.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h));
  };
  const off = (e: Element): boolean =>
    e.matches(':disabled, [aria-disabled="true"]') || /(^|\s)(disabled|is-disabled|swiper-button-disabled|slick-disabled|flickity-button-disabled)(\s|$)/i.test(e.getAttribute('class') || '');
  const inForm = (e: Element): boolean => !!e.closest('form');
  // "Next product", "Next page", "Next article": arrows to somewhere else, not to the next slide.
  const ELSEWHERE = /\b(product|article|post|page|chapter|story|collection|step)\b/i;
  const said = (e: Element): string =>
    [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('class'), e.getAttribute('id'), e.getAttribute('data-action'), e.getAttribute('name'), (e.textContent || '').trim().slice(0, 30)]
      .filter(Boolean)
      .join(' ');
  // A slide or a product card is never a control, even when its label says "2 / 3" and its text ends in an arrow
  // (elavi.co and us.dryrobe.com, 18 Nov 2026: pressing one opened the product). Nor is anything holding a link
  // to another page, or anything bigger than a small part of the slider.
  const SLIDE = '[aria-roledescription="slide"], .swiper-slide, .splide__slide, .slick-slide, .flickity-cell, .glide__slide, .embla__slide, [class*="carousel-item" i], [class*="carousel__item" i]';
  const holdsLink = (e: Element): boolean =>
    Array.from(e.querySelectorAll('a[href]')).some((a) => {
      const h = (a.getAttribute('href') || '').trim();
      return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h));
    });
  const sb = root.getBoundingClientRect();
  const small = (e: Element): boolean => {
    const r = e.getBoundingClientRect();
    return r.width <= Math.max(120, sb.width * 0.4) && r.height <= Math.max(120, sb.height * 0.6);
  };
  const safe = (e: Element): boolean => !!shown(e) && !off(e) && !leaves(e) && !inForm(e) && !e.closest(SLIDE) && !holdsLink(e) && small(e);

  // 1. The slider's own "next" arrow. The outermost matching control wins over an icon inside it.
  const CONTROLS = 'button, [role="button"], a, [aria-label], [class*="next" i], [class*="arrow" i], [class*="chevron" i]';
  const nexts = Array.from(root.querySelectorAll(CONTROLS)).filter((e) => safe(e) && NEXT.test(said(e)) && !PREV.test(said(e)) && !ELSEWHERE.test(said(e)));
  const outer = nexts.filter((e) => !nexts.some((o) => o !== e && o.contains(e)));
  const pick = outer.find((e) => e.matches('button, [role="button"], a')) || outer[0];
  if (pick) {
    pick.setAttribute('data-secslide', 'next');
    return { ok: true, how: 'next', dots: 0, why: said(pick).replace(/\s+/g, ' ').slice(0, 60) };
  }

  // 2. Its pagination dots: a group of at least two siblings; the 2nd, 3rd and 4th are pressed.
  const DOTS =
    '.swiper-pagination-bullet, .slick-dots button, .slick-dots li, .flickity-page-dot, .flickity-page-dots .dot, .splide__pagination__page, .glide__bullet, .embla__dot, [role="tab"], button[aria-label*="slide" i], button[class*="dot" i], li[class*="dot" i], span[class*="dot" i]';
  const groups = new Map<Element, Element[]>();
  for (const d of Array.from(root.querySelectorAll(DOTS))) {
    if (!safe(d) || !d.parentElement) continue;
    const g = groups.get(d.parentElement) || [];
    if (!g.some((x) => x.contains(d) || d.contains(x))) g.push(d);
    groups.set(d.parentElement, g);
  }
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    g.slice(1, 4).forEach((d, i) => d.setAttribute('data-secslide-dot', String(i + 1)));
    return { ok: true, how: 'dots', dots: g.length, why: `${g.length} dots` };
  }

  // 3. A track that scrolls sideways (themes like Dawn build sliders this way).
  const bw = el.getBoundingClientRect().width;
  for (const t of [root, ...Array.from(root.querySelectorAll('*')).slice(0, 600)]) {
    const he = t as HTMLElement;
    if (he.scrollWidth <= he.clientWidth + 40 || he.clientWidth < bw * 0.4) continue;
    const ox = getComputedStyle(he).overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    if (!shown(he)) continue;
    he.setAttribute('data-secslide', 'track');
    return { ok: true, how: 'scroll', dots: 0, why: 'scrolling track' };
  }

  // 4. Phones: a swipe across the slider itself.
  if (arg.touch && marked) {
    root.setAttribute('data-secslide', 'track');
    return { ok: true, how: 'swipe', dots: 0, why: 'swipe' };
  }
  return { ...none, why: 'no-control' };
}

/**
 * Where to press the marked control (its centre, viewport CSS px) when it is fully on screen and nothing
 * covers it, so the press can be a real mouse click or tap. null = off screen or covered: the caller clicks
 * it from inside the page instead.
 */
export function controlPoint(selector: string): { x: number; y: number } | null {
  const e = document.querySelector(selector);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  return hit && (hit === e || e.contains(hit)) ? { x, y } : null;
}

/** Clicks the marked control from inside the page (no scrolling, no hover). Returns false when it is gone. */
export function clickControl(selector: string): boolean {
  const e = document.querySelector(selector) as HTMLElement | null;
  if (!e) return false;
  e.click();
  return true;
}

/**
 * Scrolls the marked track to its next slide over 450 ms of page time (so slow motion slows it too), with
 * scroll snapping paused while it moves. Returns false at the end of the track.
 */
export function scrollTrack(): Promise<boolean> {
  const t = document.querySelector('[data-secslide="track"]') as HTMLElement | null;
  if (!t) return Promise.resolve(false);
  const start = t.scrollLeft;
  const tr = t.getBoundingClientRect();
  let target = start + t.clientWidth * 0.8;
  for (const k of Array.from(t.querySelectorAll(':scope > *'))) {
    const r = k.getBoundingClientRect();
    if (r.width < 20) continue;
    const left = r.left - tr.left + start;
    if (left > start + 8) {
      target = left;
      break;
    }
  }
  target = Math.min(target, t.scrollWidth - t.clientWidth);
  if (target <= start + 2) return Promise.resolve(false);
  const snap = t.style.scrollSnapType;
  const behavior = t.style.scrollBehavior;
  t.style.scrollSnapType = 'none';
  t.style.scrollBehavior = 'auto';
  const t0 = performance.now();
  const dur = 450;
  return new Promise((resolve) => {
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      t.scrollLeft = start + (target - start) * e;
      if (p < 1) requestAnimationFrame(step);
      else {
        t.style.scrollSnapType = snap;
        t.style.scrollBehavior = behavior;
        resolve(true);
      }
    };
    requestAnimationFrame(step);
  });
}

/** The marked track's box (viewport CSS px), for a swipe. */
export function trackBox(): BoxInfo | null {
  const t = document.querySelector('[data-secslide="track"]');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}
