// Functions in this file run INSIDE the captured web page (Playwright serialises them with page.evaluate).
// They must be self-contained: no imports, no closures over anything outside the function body.
// Stage 3 (Ben, 20 Nov 2026): videos that wait for a press. They find a section's own play button (or its paused
// video, or its YouTube / Vimeo frame), mark it, and read whether a video now plays and whether it opened in a
// popup. The pressing itself happens in play-clips.ts with a real click or tap. Nothing here follows a link,
// types or sends a form; the only thing it starts by itself is a paused video with no button at all (muted).

export type PlayBlock = { ref: string; index: number; why: string };

export type PlayBox = { x: number; y: number; width: number; height: number };

export type PlayPlan = {
  ok: boolean;
  /**
   * control = the section's own play button (marked data-secplay="go"); video = the paused <video> itself, which
   * shows the browser's own controls (data-secplay-video); frame = a YouTube, Vimeo or Wistia frame, pressed in its
   * middle where its play button is (data-secplay-frame); script = a paused video with no button and no controls,
   * started muted from inside the page.
   */
  how: 'control' | 'video' | 'frame' | 'script' | 'none';
  /**
   * What will play: native = a <video> of the store's own page (slow motion works); frame = a player inside
   * another site's frame (recorded at normal speed); unknown = cannot tell before the press.
   */
  player: 'native' | 'frame' | 'unknown';
  why: string;
};

export type PlayState = {
  /** A <video> of the page (in the section or in a popup it opened) is playing. */
  playing: boolean;
  /** Its playback rate, to check slow motion reached it. */
  rate: number;
  /** A player that appeared outside the section, in a layer over the page: what a popup shows. */
  popup: { box: PlayBox; frame: boolean } | null;
};

/** What a player frame (YouTube, Vimeo, Wistia...) shows, read from inside it. */
export type FrameVideoState = { found: boolean; playing: boolean; rate: number; ad: boolean; wall: boolean };

/**
 * Sections that hold a video waiting for a press: a paused <video> of a decent size, a YouTube / Vimeo / Wistia
 * frame, a video placeholder that loads one (lite-youtube, Shopify's deferred-media, a theme's own video element),
 * or a play button. In page order, at most `max`, leaving out `skip` (sections that already have a clip).
 */
export function playBlocks(arg: { max: number; skip: string[] }): PlayBlock[] {
  const PLAYER_SRC = /youtube\.com\/embed|youtube-nocookie\.com|player\.vimeo\.com|videopress\.com\/embed|fast\.wistia\.(net|com)|wistia\.com\/embed|play\.vidyard\.com|loom\.com\/embed/i;
  const FACADE = 'lite-youtube, lite-vimeo, deferred-media, [data-youtube-id], [data-vimeo-id], [data-video-id][class*="video" i]';
  const THUMB = /i\.ytimg\.com|img\.youtube\.com|vumbnail\.com|i\.vimeocdn\.com|embed-ssl\.wistia\.com\/deliveries/i;
  const NOT = /autoplay|playlist|display|playground|slide|slideshow|carousel|rotation|marquee|gallery|playstation|google ?play|app ?store|replay|audio|podcast|music|sound|mute|unmute|volume|pause/i;
  // Class names join words with "-" or "__" (beatific.co's video-popup__play), so a word edge is anything but a letter or digit.
  const PLAY = /(^|[^a-z0-9])play([^a-z0-9]|$)|play[-_]*(button|btn|icon|video|trigger|overlay)|(btn|button|icon|video)[-_]*play|(^|[^a-z0-9])watch[^a-z0-9].{0,24}(video|film|trailer|movie|clip|story)|vjs-big-play|plyr__control--overlaid|deferred-media__poster|video[-_]*(trigger|popup|modal|lightbox)|popup[-_]*video|js-video/i;
  const VIDEO_LINK = /youtube\.com\/(watch|embed|shorts)|youtu\.be\/|vimeo\.com\/(\d|video)|wistia\.(com|net)|vidyard\.com|\.mp4(\?|#|$)/i;
  const LIGHTBOX = /data-(video-play|fancybox|lity|lightbox|popup|video-popup|video-id|video-type|youtube|vimeo|glightbox|venobox|magnific|modal)|popup|lightbox|modal|fancybox|magnific|glightbox|venobox|video[-_]*(play|btn|button|trigger)|play[-_]*(video|btn|button)|js-video/i;
  const skip = new Set(arg.skip);
  const shown = (e: Element, minW: number, minH: number): DOMRect | null => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    const r = e.getBoundingClientRect();
    return r.width >= minW && r.height >= minH ? r : null;
  };
  const said = (e: Element): string =>
    [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('class'), e.getAttribute('id'), (e.textContent || '').trim().slice(0, 40)].filter(Boolean).join(' ');
  const playWords = (e: Element): boolean => {
    const s = said(e);
    return !NOT.test(s) && PLAY.test(s);
  };
  // A link to YouTube or Vimeo that the store's own script opens in a popup (dadgrass.com's video-popup) is a play
  // button; any other link to another page is not. play-clips.ts also blocks the page from leaving while it presses.
  const lightbox = (a: Element): boolean => {
    if (!VIDEO_LINK.test(a.getAttribute('href') || '')) return false;
    for (let n: Element | null = a, i = 0; n && i < 4; n = n.parentElement, i++) {
      if (n.tagName.includes('-') && /VIDEO|MODAL|POPUP|LIGHTBOX/.test(n.tagName)) return true;
      if (LIGHTBOX.test(Array.from(n.attributes).map((x) => `${x.name}=${x.value.slice(0, 80)}`).join(' '))) return true;
    }
    return false;
  };
  const leaves = (e: Element): boolean => {
    const a = e.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h)) && !lightbox(a);
  };
  const customVideo = (e: Element) => e.tagName.includes('-') && /VIDEO|YOUTUBE|VIMEO|WISTIA/.test(e.tagName);
  const out: PlayBlock[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-secref]'))) {
    const ref = el.getAttribute('data-secref') || '';
    if (skip.has(ref)) continue;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.position === 'fixed' || cs.display === 'none' || box.height < 120 || box.width < 1) continue;
    const area = box.width * box.height;
    let why = '';
    for (const v of Array.from(el.querySelectorAll('video'))) {
      const r = shown(v, 120, 80);
      if (!r || (r.width * r.height < area * 0.12 && r.width * r.height < 240 * 135)) continue;
      if (!v.paused && !v.ended && v.currentTime > 0) continue;
      why = 'paused video';
      break;
    }
    if (!why) {
      for (const f of Array.from(el.querySelectorAll('iframe'))) {
        const src = f.getAttribute('src') || f.getAttribute('data-src') || '';
        if (PLAYER_SRC.test(src) && shown(f, 160, 90)) {
          why = 'video frame';
          break;
        }
      }
    }
    if (!why) {
      for (const f of [...Array.from(el.querySelectorAll(FACADE)), ...Array.from(el.querySelectorAll('*')).slice(0, 1500).filter(customVideo)]) {
        if (shown(f, 40, 40) && !leaves(f)) {
          why = 'video placeholder';
          break;
        }
      }
    }
    if (!why) {
      for (const img of Array.from(el.querySelectorAll('img'))) {
        if (THUMB.test(img.currentSrc || img.src || '') && shown(img, 120, 70)) {
          why = 'video thumbnail';
          break;
        }
      }
    }
    if (!why) {
      for (const c of Array.from(el.querySelectorAll('button, [role="button"], a, [class*="play" i], [aria-label*="play" i], [aria-label*="watch" i]')).slice(0, 300)) {
        if (!shown(c, 12, 12) || c.closest('form, nav, [role="navigation"], [role="menu"]') || leaves(c)) continue;
        if (playWords(c)) {
          why = 'play button';
          break;
        }
      }
    }
    if (!why) continue;
    out.push({ ref, index: Number(ref.replace(/^b/, '')) || 0, why });
    if (out.length >= arg.max) break;
  }
  return out;
}

/**
 * How to start the video of section `ref`, and what will play. Marks what it chose (data-secplay="go" on the
 * play button, data-secplay-video on a <video>, data-secplay-frame on a player frame) and the media to keep on
 * screen and judge (data-secplay-media). Every player already showing anywhere on the page gets
 * data-secplay-seen and every layer already over the page data-secplay-seenlayer, so a player or a popup that
 * appears after the press is known to be new. Never a link to another page (a YouTube or Vimeo link the store
 * opens in a popup is the exception), anything in a form or a menu, a disabled control, a slideshow's own play
 * button or a sound switch.
 */
export function planPlay(ref: string): PlayPlan {
  const none: PlayPlan = { ok: false, how: 'none', player: 'unknown', why: '' };
  const el = document.querySelector(`[data-secref="${ref}"]`);
  if (!el) return { ...none, why: 'no-block' };
  for (const m of Array.from(document.querySelectorAll('[data-secplay], [data-secplay-video], [data-secplay-frame], [data-secplay-media], [data-secplay-pop], [data-secplay-layer], [data-secplay-popframe]'))) {
    m.removeAttribute('data-secplay-popframe');
    m.removeAttribute('data-secplay');
    m.removeAttribute('data-secplay-video');
    m.removeAttribute('data-secplay-frame');
    m.removeAttribute('data-secplay-media');
    m.removeAttribute('data-secplay-pop');
    m.removeAttribute('data-secplay-layer');
  }
  const PLAYER_SRC = /youtube\.com\/embed|youtube-nocookie\.com|player\.vimeo\.com|videopress\.com\/embed|fast\.wistia\.(net|com)|wistia\.com\/embed|play\.vidyard\.com|loom\.com\/embed/i;
  const FRAME_HINT = /youtube|youtu\.be|ytimg|vimeo|vumbnail|wistia|vidyard|videopress|loom\.com/i;
  const FACADE = 'lite-youtube, lite-vimeo, deferred-media, [data-youtube-id], [data-vimeo-id], [data-video-id][class*="video" i]';
  const NOT = /autoplay|playlist|display|playground|slide|slideshow|carousel|rotation|marquee|gallery|playstation|google ?play|app ?store|replay|audio|podcast|music|sound|mute|unmute|volume|pause/i;
  const PLAY = /(^|[^a-z0-9])play([^a-z0-9]|$)|play[-_]*(button|btn|icon|video|trigger|overlay)|(btn|button|icon|video)[-_]*play|(^|[^a-z0-9])watch[^a-z0-9].{0,24}(video|film|trailer|movie|clip|story)|vjs-big-play|plyr__control--overlaid|deferred-media__poster|video[-_]*(trigger|popup|modal|lightbox)|popup[-_]*video|js-video|lecture|abspielen|reproducir|riproduci|afspelen/i;
  const VIDEO_LINK = /youtube\.com\/(watch|embed|shorts)|youtu\.be\/|vimeo\.com\/(\d|video)|wistia\.(com|net)|vidyard\.com|\.mp4(\?|#|$)/i;
  const LIGHTBOX = /data-(video-play|fancybox|lity|lightbox|popup|video-popup|video-id|video-type|youtube|vimeo|glightbox|venobox|magnific|modal)|popup|lightbox|modal|fancybox|magnific|glightbox|venobox|video[-_]*(play|btn|button|trigger)|play[-_]*(video|btn|button)|js-video/i;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const shown = (e: Element, minW: number, minH: number): DOMRect | null => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    const r = e.getBoundingClientRect();
    return r.width >= minW && r.height >= minH ? r : null;
  };
  // Every player on the page right now, so a new one after the press can be told apart.
  for (const v of Array.from(document.querySelectorAll('video, iframe'))) {
    if (v.tagName === 'IFRAME' && !PLAYER_SRC.test(v.getAttribute('src') || v.getAttribute('data-src') || '')) continue;
    if (shown(v, 2, 2)) v.setAttribute('data-secplay-seen', '1');
  }
  // And every layer already over the page (a pinned header, a chat window), for popupControl.
  for (const e of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && !(e.tagName === 'DIALOG' && (e as HTMLDialogElement).open)) continue;
    const r = e.getBoundingClientRect();
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width * r.height >= vw * vh * 0.15) e.setAttribute('data-secplay-seenlayer', '1');
  }
  const lightbox = (a: Element): boolean => {
    if (!VIDEO_LINK.test(a.getAttribute('href') || '')) return false;
    for (let n: Element | null = a, i = 0; n && i < 4; n = n.parentElement, i++) {
      if (n.tagName.includes('-') && /VIDEO|MODAL|POPUP|LIGHTBOX/.test(n.tagName)) return true;
      if (LIGHTBOX.test(Array.from(n.attributes).map((x) => `${x.name}=${x.value.slice(0, 80)}`).join(' '))) return true;
    }
    return false;
  };
  const leaves = (e: Element): boolean => {
    const a = e.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h.startsWith('#') || /^javascript:/i.test(h)) && !lightbox(a);
  };
  const customVideo = (e: Element) => e.tagName.includes('-') && /VIDEO|YOUTUBE|VIMEO|WISTIA/.test(e.tagName);
  const isFacade = (e: Element) => e.matches(FACADE) || customVideo(e);
  const off = (e: Element): boolean => e.matches(':disabled, [aria-disabled="true"]') || /(^|\s)(disabled|is-disabled)(\s|$)/i.test(e.getAttribute('class') || '');
  const said = (e: Element): string =>
    [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('class'), e.getAttribute('id'), e.getAttribute('data-action'), (e.textContent || '').trim().slice(0, 40)].filter(Boolean).join(' ');
  const icon = (e: Element): boolean =>
    !!e.querySelector('svg[class*="play" i], svg [class*="play" i], use[href*="play" i], i[class*="play" i], span[class*="play" i], img[src*="play" i], img[alt*="play" i], [class*="icon-play" i], [data-icon*="play" i]');
  const strong = (e: Element): boolean => {
    const s = said(e);
    if (NOT.test(s)) return false;
    return PLAY.test(s) || /^\s*(▶|►|⏵)\s*$/.test((e.textContent || '').trim());
  };
  const safe = (e: Element): boolean =>
    !!shown(e, 12, 12) && !off(e) && !leaves(e) && !e.closest('form, nav, [role="navigation"], [role="menu"]') && !NOT.test(said(e));

  // The section's media: the biggest visible <video>, player frame or placeholder.
  type Media = { el: Element; kind: 'video' | 'frame' | 'facade'; r: DOMRect };
  const media: Media[] = [];
  for (const v of Array.from(el.querySelectorAll('video'))) {
    const r = shown(v, 120, 80);
    if (r) media.push({ el: v, kind: 'video', r });
  }
  for (const f of Array.from(el.querySelectorAll('iframe'))) {
    const r = PLAYER_SRC.test(f.getAttribute('src') || f.getAttribute('data-src') || '') ? shown(f, 160, 90) : null;
    if (r) media.push({ el: f, kind: 'frame', r });
  }
  for (const f of [...Array.from(el.querySelectorAll(FACADE)), ...Array.from(el.querySelectorAll('*')).slice(0, 1500).filter(customVideo)]) {
    const r = shown(f, 40, 40);
    if (r && !media.some((m) => m.el === f)) media.push({ el: f, kind: 'facade', r });
  }
  const area = (r: DOMRect) => r.width * r.height;
  media.sort((a, b) => area(b.r) - area(a.r));
  const main = media[0] || null;
  const hintText = (e: Element): string => {
    const parts: string[] = [];
    for (const n of [e, ...Array.from(e.querySelectorAll('*')).slice(0, 200)]) {
      for (const at of Array.from(n.attributes)) if (/src|href|video|youtube|vimeo|url|data-/i.test(at.name)) parts.push(at.value);
      if (n.tagName === 'TEMPLATE') parts.push((n as HTMLTemplateElement).innerHTML.slice(0, 2000));
    }
    return parts.join(' ');
  };
  const frameHinted = FRAME_HINT.test(hintText(el));

  // 1. The section's own play button: a control that says play (words, class or a play icon). Of controls inside
  // one another the innermost: a press on it reaches every wrapper around it too.
  const CONTROLS =
    'button, [role="button"], a, [tabindex], [class*="play" i], [id*="play" i], [aria-label*="play" i], [title*="play" i], [aria-label*="watch" i], deferred-media, lite-youtube, lite-vimeo, [class*="video-trigger" i], [class*="video-popup" i], [class*="video-modal" i], [class*="video-lightbox" i], [data-video-popup], [data-video-play], [data-fancybox], [data-lity]';
  const candidates = [...Array.from(el.querySelectorAll(CONTROLS)).slice(0, 400), ...Array.from(el.querySelectorAll('*')).slice(0, 1500).filter(customVideo)];
  const controls = candidates.filter((c, i) => candidates.indexOf(c) === i && safe(c) && (strong(c) || ((c.matches('button, [role="button"]') || isFacade(c)) && icon(c)) || (isFacade(c) && !!main)));
  const inner = controls.filter((c) => !controls.some((o) => o !== c && c.contains(o)));
  // Nearest the media first (on it beats beside it), then buttons before anything else.
  const score = (c: Element): number => {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let s = 0;
    if (main) {
      const m = main.r;
      if (cx >= m.left && cx <= m.right && cy >= m.top && cy <= m.bottom) s += 4;
      else s -= Math.min(3, Math.hypot(cx - (m.left + m.width / 2), cy - (m.top + m.height / 2)) / Math.max(200, m.width));
    }
    if (c.closest('button, [role="button"]')) s += 2;
    if (strong(c)) s += 1;
    return s;
  };
  inner.sort((a, b) => score(b) - score(a));
  const pick = inner[0];
  if (pick) {
    pick.setAttribute('data-secplay', 'go');
    const target = main ? main.el : pick;
    target.setAttribute('data-secplay-media', '1');
    const player: PlayPlan['player'] = main?.kind === 'frame' || !!pick.closest('lite-youtube, lite-vimeo') || frameHinted ? 'frame' : main?.kind === 'video' ? 'native' : 'unknown';
    return { ok: true, how: 'control', player, why: said(pick).replace(/\s+/g, ' ').slice(0, 60) || pick.tagName.toLowerCase() };
  }
  if (!main) return { ...none, why: 'no-player' };
  main.el.setAttribute('data-secplay-media', '1');
  // 2. A paused video that shows the browser's own controls: pressed in its middle.
  if (main.kind === 'video') {
    const v = main.el as HTMLVideoElement;
    // Started by itself since the sections were listed (a theme that plays videos once they are on screen):
    // play-clips.ts sees it playing and records it without a press; the muted play() is never needed.
    if (!v.paused && v.currentTime > 0) {
      v.setAttribute('data-secplay-video', '1');
      return { ok: true, how: 'script', player: 'native', why: 'already playing' };
    }
    if (v.controls) {
      v.setAttribute('data-secplay-video', '1');
      return { ok: true, how: 'video', player: 'native', why: 'video controls' };
    }
    // 4. No button and no controls: started from inside the page, muted (what an autoplay would have done).
    if (area(main.r) >= Math.max(240 * 135, area(el.getBoundingClientRect()) * 0.12)) {
      v.setAttribute('data-secplay-video', '1');
      return { ok: true, how: 'script', player: 'native', why: 'paused video, no button' };
    }
    return { ...none, why: 'small-video' };
  }
  // 3. A player frame: its play button sits in its middle.
  if (main.kind === 'frame') {
    main.el.setAttribute('data-secplay-frame', '1');
    const src = main.el.getAttribute('src') || '';
    return { ok: true, how: 'frame', player: 'frame', why: (src.match(/youtube|vimeo|wistia|vidyard|videopress|loom/i) || ['player'])[0].toLowerCase() + ' frame' };
  }
  // A placeholder with no button found: the placeholder itself is pressed.
  if (safe(main.el)) {
    main.el.setAttribute('data-secplay', 'go');
    return { ok: true, how: 'control', player: frameHinted || main.el.matches('lite-youtube, lite-vimeo') ? 'frame' : 'unknown', why: main.el.tagName.toLowerCase() };
  }
  return { ...none, why: 'no-control' };
}

/**
 * After a press that started nothing: a layer that has opened over the page since planPlay (a popup the store
 * shows its video in) and that holds a play button or a video placeholder of its own (burton.com's "Watch Video":
 * the popup shows the video's poster and a second play button). Marks that button data-secplay="go2" and the
 * layer data-secplay-layer. First takes hidePinned's transparency off any new layer, so a popup that existed
 * already, shown by its opacity, can be seen. Returns what the button says, or null.
 */
export function popupControl(): string | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const NOT = /autoplay|playlist|display|playground|slide|slideshow|carousel|rotation|marquee|gallery|playstation|google ?play|app ?store|replay|audio|podcast|music|sound|mute|unmute|volume|pause|close/i;
  const PLAY = /(^|[^a-z0-9])play([^a-z0-9]|$)|play[-_]*(button|btn|icon|video|trigger|overlay)|(btn|button|icon|video)[-_]*play|vjs-big-play|plyr__control--overlaid|deferred-media__poster/i;
  const FACADE = 'lite-youtube, lite-vimeo, deferred-media, [data-youtube-id], [data-vimeo-id], [data-video-id]';
  const w = window as unknown as { __secHidden?: [HTMLElement, string, string][] };
  if (w.__secHidden) {
    w.__secHidden = w.__secHidden.filter(([e, value, priority]) => {
      if (e.closest('[data-secplay-seenlayer]')) return true;
      const keep = e.style.getPropertyValue('opacity');
      const keepPriority = e.style.getPropertyPriority('opacity');
      if (value) e.style.setProperty('opacity', value, priority);
      else e.style.removeProperty('opacity');
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width * r.height >= vw * vh * 0.15) return false;
      e.style.setProperty('opacity', keep, keepPriority);
      return true;
    });
  }
  const shown = (e: Element, min: number): DOMRect | null => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    const r = e.getBoundingClientRect();
    return r.width >= min && r.height >= min && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw ? r : null;
  };
  const layers = Array.from(document.querySelectorAll('body *')).filter((e) => {
    if (e.hasAttribute('data-secplay-seenlayer') || e.closest('[data-secplay-seenlayer]')) return false;
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && !(e.tagName === 'DIALOG' && (e as HTMLDialogElement).open)) return false;
    const r = shown(e, 1);
    return !!r && r.width * r.height >= vw * vh * 0.15;
  });
  for (const layer of layers) {
    const said = (e: Element) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('class'), (e.textContent || '').trim().slice(0, 30)].filter(Boolean).join(' ');
    const icon = (e: Element) => !!e.querySelector('svg[class*="play" i], use[href*="play" i], [class*="icon-play" i]');
    const found = Array.from(layer.querySelectorAll('button, [role="button"], [class*="play" i], [aria-label*="play" i], ' + FACADE))
      .concat(Array.from(layer.querySelectorAll('*')).filter((e) => e.tagName.includes('-') && /VIDEO|YOUTUBE|VIMEO|WISTIA/.test(e.tagName)))
      .filter((c) => {
        if (!shown(c, 12) || c.closest('form') || c.closest('a[href]:not([href^="#"]):not([href=""])')) return false;
        const s = said(c);
        return !NOT.test(s) && (PLAY.test(s) || icon(c) || c.matches(FACADE) || (c.tagName.includes('-') && /VIDEO|YOUTUBE|VIMEO|WISTIA/.test(c.tagName)));
      });
    const inner = found.filter((c) => !found.some((o) => o !== c && c.contains(o)));
    if (!inner.length) continue;
    inner.sort((a, b) => {
      const d = (e: Element) => {
        const r = e.getBoundingClientRect();
        return Math.hypot(r.left + r.width / 2 - vw / 2, r.top + r.height / 2 - vh / 2);
      };
      return d(a) - d(b);
    });
    document.querySelectorAll('[data-secplay="go2"]').forEach((x) => x.removeAttribute('data-secplay'));
    inner[0].setAttribute('data-secplay', 'go2');
    layer.setAttribute('data-secplay-layer', '1');
    return said(inner[0]).replace(/\s+/g, ' ').slice(0, 60) || inner[0].tagName.toLowerCase();
  }
  return null;
}

/**
 * Centres the section's media (data-secplay-media) when it fits the screen, else puts its top at the top, and
 * says which part of the section is on screen (rect), the whole section (block) and the media cut to the screen
 * (focus: where a press must change something). Call it again after the scroll has settled.
 */
export function placePlay(arg: { ref: string; scroll: boolean }): { ok: boolean; rect: PlayBox; block: PlayBox; focus: PlayBox; vw: number; vh: number } {
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  const el = document.querySelector(`[data-secref="${arg.ref}"]`);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el) return { ok: false, rect: empty, block: empty, focus: empty, vw, vh };
  const cut = (b: DOMRect): PlayBox => {
    const x0 = Math.max(0, b.left);
    const y0 = Math.max(0, b.top);
    return { x: x0, y: y0, width: Math.max(0, Math.min(vw, b.right) - x0), height: Math.max(0, Math.min(vh, b.bottom) - y0) };
  };
  const target = el.querySelector('[data-secplay-media]') || el.querySelector('[data-secplay="go"]') || el;
  if (arg.scroll) {
    const r0 = target.getBoundingClientRect();
    const absTop = r0.top + window.scrollY;
    window.scrollTo({ top: Math.max(0, r0.height < vh ? absTop - (vh - r0.height) / 2 : absTop), left: 0, behavior: 'instant' as ScrollBehavior });
  }
  const r = el.getBoundingClientRect();
  const rect = cut(r);
  const focus = cut(target.getBoundingClientRect());
  return { ok: rect.width > 1 && rect.height > 1 && focus.width > 1 && focus.height > 1, rect, block: { x: r.left, y: r.top, width: r.width, height: r.height }, focus, vw, vh };
}

/**
 * Is a video of section `ref` playing now, or one that appeared in a layer over the page (a popup)? Marks the
 * player frames it should watch (in the section or the popup) with data-secplay-watch, the popup's player box
 * with data-secplay-pop and the layer that holds it with data-secplay-layer.
 */
export function playState(ref: string): PlayState {
  const PLAYER_SRC = /youtube\.com\/embed|youtube-nocookie\.com|player\.vimeo\.com|videopress\.com\/embed|fast\.wistia\.(net|com)|wistia\.com\/embed|play\.vidyard\.com|loom\.com\/embed/i;
  const el = document.querySelector(`[data-secref="${ref}"]`);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const res: PlayState = { playing: false, rate: 1, popup: null };
  if (!el) return res;
  const shown = (e: Element): DOMRect | null => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 ? r : null;
  };
  const plays = (v: HTMLVideoElement) => !v.paused && !v.ended && v.readyState >= 2 && v.currentTime > 0.05;
  // The outermost layer over the page that holds the element: a fixed element or an open dialog.
  const layerOf = (e: Element): Element | null => {
    let top: Element | null = null;
    for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || (n.tagName === 'DIALOG' && (n as HTMLDialogElement).open)) top = n;
    }
    return top;
  };
  // A popup: a player that was not showing before the press, in a layer that opened since (outside the section,
  // or inside its markup: burton.com keeps its "Watch Video" popups in the section), big enough.
  const minArea = vw * vh * (vw < 768 ? 0.1 : 0.06);
  const popupLayer = (p: Element): Element | null => {
    if (p.hasAttribute('data-secplay-seen')) return null;
    const layer = layerOf(p);
    if (!layer || layer.closest('[data-secplay-seenlayer]')) return null;
    return layer;
  };
  for (const v of Array.from(el.querySelectorAll('video'))) {
    if (!popupLayer(v) && shown(v) && plays(v)) {
      res.playing = true;
      res.rate = v.playbackRate;
    }
  }
  for (const f of Array.from(el.querySelectorAll('iframe'))) {
    if (PLAYER_SRC.test(f.getAttribute('src') || '')) f.setAttribute('data-secplay-watch', '1');
  }
  for (const p of Array.from(document.querySelectorAll('video, iframe'))) {
    const isFrame = p.tagName === 'IFRAME';
    if (isFrame && !PLAYER_SRC.test(p.getAttribute('src') || '')) continue;
    const layer = popupLayer(p);
    if (!layer) continue;
    const r = shown(p);
    if (!r) continue;
    const seen = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (seen < minArea) continue;
    // The popup's box: the highest wrapper of the player that is still well short of the whole screen.
    let box: Element = p;
    for (let n = p.parentElement; n && n !== layer && n !== document.body; n = n.parentElement) {
      const b = n.getBoundingClientRect();
      if (b.width * b.height > vw * vh * 0.7) break;
      box = n;
    }
    document.querySelectorAll('[data-secplay-pop]').forEach((x) => x.removeAttribute('data-secplay-pop'));
    document.querySelectorAll('[data-secplay-layer]').forEach((x) => x.removeAttribute('data-secplay-layer'));
    document.querySelectorAll('[data-secplay-popframe]').forEach((x) => x.removeAttribute('data-secplay-popframe'));
    box.setAttribute('data-secplay-pop', '1');
    layer.setAttribute('data-secplay-layer', '1');
    if (isFrame) {
      p.setAttribute('data-secplay-watch', '1');
      // Its middle is where a second press goes when the player does not start by itself (beatific.co).
      p.setAttribute('data-secplay-popframe', '1');
    } else if (plays(p as HTMLVideoElement)) {
      res.playing = true;
      res.rate = (p as HTMLVideoElement).playbackRate;
    }
    const b = box.getBoundingClientRect();
    const x0 = Math.max(0, b.left);
    const y0 = Math.max(0, b.top);
    res.popup = { box: { x: x0, y: y0, width: Math.max(0, Math.min(vw, b.right) - x0), height: Math.max(0, Math.min(vh, b.bottom) - y0) }, frame: isFrame };
    break;
  }
  return res;
}

/** The popup's player box again, cut to the screen, once it has settled (null when it is gone). */
export function popupBox(): PlayBox | null {
  const e = document.querySelector('[data-secplay-pop]');
  if (!e) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const b = e.getBoundingClientRect();
  const x0 = Math.max(0, b.left);
  const y0 = Math.max(0, b.top);
  const box = { x: x0, y: y0, width: Math.max(0, Math.min(vw, b.right) - x0), height: Math.max(0, Math.min(vh, b.bottom) - y0) };
  return box.width > 40 && box.height > 40 ? box : null;
}

/**
 * hidePinned made every pinned layer outside the section transparent; a popup layer that already existed
 * (shown by changing its opacity) would stay invisible. Puts the opacity back on the popup's layer and its
 * relatives.
 */
export function revealLayer(): void {
  const w = window as unknown as { __secHidden?: [HTMLElement, string, string][] };
  const pop = document.querySelector('[data-secplay-pop]');
  if (!pop || !w.__secHidden) return;
  w.__secHidden = w.__secHidden.filter(([e, value, priority]) => {
    if (!(e.contains(pop) || pop.contains(e))) return true;
    if (value) e.style.setProperty('opacity', value, priority);
    else e.style.removeProperty('opacity');
    return false;
  });
}

/**
 * For a paused video planPlay found no button for, once it is on screen: what sits on the video's middle. A
 * picture or play icon laid over it (amplifyeme.com, 20 Nov 2026: its small play icon stayed over the playing
 * video when the video was started from inside the page) is the play button after all: it is marked
 * data-secplay="go" and "control" is returned. "video" when the video itself is on top, "none" when anything
 * else is there (a link to another page, a form) or the middle is off screen.
 */
export function coverAtCentre(): 'control' | 'video' | 'none' {
  const v = document.querySelector('[data-secplay-video]');
  if (!v) return 'none';
  const r = v.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'none';
  const hit = document.elementFromPoint(x, y);
  if (!hit) return 'none';
  if (hit === v) return 'video';
  const a = hit.closest('a[href]');
  const h = a ? (a.getAttribute('href') || '').trim() : '';
  if ((a && !(h === '' || h.startsWith('#') || /^javascript:/i.test(h))) || hit.closest('form, nav, [role="navigation"], [role="menu"]')) return 'none';
  // Laid over the video: inside its box (a few pixels of slack), not a wrapper far bigger than it.
  const b = hit.getBoundingClientRect();
  const s = 8;
  if (b.left < r.left - s || b.top < r.top - s || b.right > r.right + s || b.bottom > r.bottom + s) return 'none';
  hit.setAttribute('data-secplay', 'go');
  return 'control';
}

/** Starts the marked video from inside the page, muted (no button and no controls to press). */
export async function scriptPlay(): Promise<boolean> {
  const v = document.querySelector('[data-secplay-video]') as HTMLVideoElement | null;
  if (!v) return false;
  v.muted = true;
  try {
    await v.play();
  } catch {
    /* blocked or failed: the caller reads the state again */
  }
  return true;
}

/** Pauses every video and audio of this frame (the page, or a player frame). Returns how many were playing. */
export function pauseAll(): number {
  let n = 0;
  const yt = document.getElementById('movie_player') as unknown as { pauseVideo?: () => void } | null;
  try {
    yt?.pauseVideo?.();
  } catch {
    /* not YouTube's player */
  }
  for (const m of Array.from(document.querySelectorAll('video, audio'))) {
    const v = m as HTMLMediaElement;
    if (!v.paused) n++;
    try {
      v.pause();
    } catch {
      /* ignore */
    }
  }
  return n;
}

/** Read from inside a player frame: its video, whether an advert plays, and whether it shows a check or an error. */
export function frameVideoState(): FrameVideoState {
  const v = document.querySelector('video');
  const player = document.querySelector('.html5-video-player');
  const ad = !!player && /\bad-(showing|interrupting)\b/.test(player.className);
  const text = (document.body?.innerText || '').slice(0, 2000);
  const wall = /sign in to confirm|not a bot|video unavailable|playback on other websites has been disabled|private video|age-restricted|an error occurred|verify (that )?you are human/i.test(text) && !(v && !v.paused && v.currentTime > 0);
  if (!v) return { found: false, playing: false, rate: 1, ad, wall };
  return { found: true, playing: !v.paused && !v.ended && v.currentTime > 0.05, rate: v.playbackRate, ad, wall };
}

/** The fields of a block for the popup's player box (as describePanel gives them), tagging it with data-secref. */
export function describePopup(ref: string): {
  tag: string; id: string | null; classes: string | null; top: number; height: number; width: number;
  text: string; textLength: number; headline: string | null; buttons: number; images: number; videos: number; bg: string;
} | null {
  const el = document.querySelector('[data-secplay-pop]') as HTMLElement | null;
  if (!el) return null;
  el.setAttribute('data-secref', ref);
  const r = el.getBoundingClientRect();
  const text = ((el.innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
  const head = el.querySelector('h1, h2, h3, h4, [role="heading"]');
  const transparent = (c: string) => c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
  let bg = getComputedStyle(el).backgroundColor;
  const layer = document.querySelector('[data-secplay-layer]');
  if (transparent(bg) && layer) bg = getComputedStyle(layer).backgroundColor;
  if (transparent(bg)) bg = getComputedStyle(document.body).backgroundColor;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute('id') || null,
    classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().slice(0, 200) : null,
    top: Math.round(r.top),
    height: Math.round(r.height),
    width: Math.round(r.width),
    text: text.slice(0, 2000),
    textLength: text.length,
    headline: head ? (head.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    buttons: el.querySelectorAll('button, [role="button"]').length,
    images: el.querySelectorAll('img, picture').length,
    videos: el.querySelectorAll('video, iframe').length || 1,
    bg,
  };
}

/**
 * A layer that opened over the page since planPlay (a popup, a dialog, its backdrop), whether or not a video was
 * found in it: the biggest is marked data-secplay-layer so it can be closed again (burton.com, 20 Nov 2026: a
 * popup left open put its dark backdrop over the next video's clip). False when none opened.
 */
export function markNewLayer(): boolean {
  if (document.querySelector('[data-secplay-layer]')) return true;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let best: Element | null = null;
  let bestArea = 0;
  for (const e of Array.from(document.querySelectorAll('body *'))) {
    if (e.closest('[data-secplay-seenlayer]')) continue;
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && !(e.tagName === 'DIALOG' && (e as HTMLDialogElement).open)) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    const r = e.getBoundingClientRect();
    const a = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (a >= vw * vh * 0.15 && a > bestArea) {
      best = e;
      bestArea = a;
    }
  }
  if (!best) return false;
  best.setAttribute('data-secplay-layer', '1');
  return true;
}

/** Marks the popup layer's close button (data-secplay-close). False when it has none. */
export function markPopupClose(): boolean {
  const layer = document.querySelector('[data-secplay-layer]');
  if (!layer) return false;
  const c = layer.querySelector('[aria-label*="close" i], [class*="close" i], [data-close], [data-dismiss], button[title*="close" i]');
  if (!c) return false;
  c.setAttribute('data-secplay-close', '1');
  return true;
}

/** Whether the popup layer still shows. */
export function popupShowing(): boolean {
  const el = document.querySelector('[data-secplay-layer]');
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0;
}

/** Last resort when a popup will not close: take its layer out of the page's picture. */
export function hidePopupLayer(): void {
  const el = document.querySelector('[data-secplay-layer]') as HTMLElement | null;
  if (el) el.style.setProperty('display', 'none', 'important');
}
