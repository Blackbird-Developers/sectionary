// Checks stage 3 (videos that wait for a press; src/play-clips.ts and src/play-script.ts) on local pages in
// Chromium. No network: every request is answered by Playwright, including the made-up player frames
// (player.vimeo.com, www.youtube.com). Needs ffmpeg on the PATH, like clips do.   npm run play-check
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeClip, runFfmpeg } from './clip-encode.js';
import { planPlay, playBlocks } from './play-script.js';
import { recordPlayClips, type PlayResult } from './play-clips.js';
import { TIME_WARP_SCRIPT } from './time-warp.js';

const ORIGIN = 'https://shop.test';
const DIR = path.resolve('_tmp/play-check');
const results: { name: string; ok: boolean; said: string }[] = [];
const note = (name: string, ok: boolean, said: string) => {
  results.push({ name, ok, said });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} -> ${said}`);
};

let video: Buffer = Buffer.alloc(0);
/** Every address the test pages asked for (the guard's aborted visits never get here). */
const asked: string[] = [];

async function newContext(browser: Browser, pages: Record<string, string>, phone = false): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, reducedMotion: 'no-preference' });
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  await context.addInitScript(TIME_WARP_SCRIPT);
  // Every request, from the page and from its frames: the pages given (by path on the shop, by full address
  // elsewhere), the test video on any host, a picture for YouTube thumbnails, and 404 for anything else.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    asked.push(u.href);
    if (u.pathname.endsWith('.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: video });
    if (/ytimg\.com$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="#c00"/></svg>' });
    const body = u.origin === ORIGIN ? pages[u.pathname] : pages[u.origin + u.pathname];
    return body === undefined ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  return context;
}

async function open(context: BrowserContext, first: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${first}`);
  await page.waitForTimeout(500);
  return page;
}

const doc = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif}</style></head><body>${body}</body></html>`;
const poster = (c = '#264653') => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="100%" height="100%" fill="${c}"/><circle cx="400" cy="225" r="60" fill="#fff"/></svg>`)}`;
const more = '<section data-secref="b9" style="height:1000px;padding:40px"><h2>More</h2><p>Soft, warm socks.</p></section>';
const playIcon = '<svg class="icon icon-play" viewBox="0 0 10 10" width="40" height="40"><path d="M2 1l7 4-7 4z"/></svg>';
const MEDIA = 'position:relative;width:min(800px,100%);aspect-ratio:16/9';

/** A video with the store's own play button over it. `extra` goes in the page script. */
const overlayPage = (extra = '') =>
  doc(`<section data-secref="b1" class="video-section" style="padding:40px 0">
  <div class="media" style="${MEDIA}">
    <video id="v" src="/test.mp4" playsinline muted preload="auto" poster="${poster()}" style="width:100%;height:100%;object-fit:cover"></video>
    <button type="button" class="video__play-button" aria-label="Play video" style="position:absolute;left:calc(50% - 50px);top:calc(50% - 50px);width:100px;height:100px;border-radius:50%" onclick="this.style.display='none';document.getElementById('v').play()">${playIcon}</button>
  </div></section>${more}<script>${extra}</script>`);

/** Shopify's Dawn: a poster button that puts the template's video in its place. */
const deferredPage = doc(`<section data-secref="b1" style="padding:40px 0">
  <deferred-media class="deferred-media" style="display:block;${MEDIA}">
    <button type="button" class="deferred-media__poster" style="display:block;width:100%;height:100%;padding:0;border:0" onclick="var d=this.parentElement;d.appendChild(d.querySelector('template').content.cloneNode(true));this.remove()">
      <img src="${poster('#2a9d8f')}" alt="" style="width:100%;height:100%;object-fit:cover"><span class="deferred-media__poster-button" style="position:absolute;left:50%;top:50%">${playIcon}</span>
    </button>
    <template><video autoplay muted playsinline src="/test.mp4" style="width:100%;height:100%"></video></template>
  </deferred-media></section>${more}`);

/** A button that opens the video in a popup over the page. */
const popupPage = doc(`<section data-secref="b1" style="padding:40px">
  <img src="${poster('#e76f51')}" alt="" style="width:min(800px,100%)"><h2>Our story</h2>
  <button type="button" class="video-popup-trigger" onclick="openPop()">Watch the film</button></section>${more}
  <div id="pop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100">
    <div class="pop__box" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);aspect-ratio:16/9">
      <video id="pv" src="/test.mp4" muted playsinline style="width:100%;height:100%"></video>
      <button type="button" aria-label="Close" class="pop__close" style="position:absolute;right:0;top:-44px;width:40px;height:40px" onclick="closePop()">×</button>
    </div>
  </div>
  <script>function openPop(){document.getElementById('pop').style.display='block';document.getElementById('pv').play()}
  function closePop(){document.getElementById('pop').style.display='none';document.getElementById('pv').pause()}</script>`);

/** A player frame that starts by itself (what a popup loads with autoplay=1). */
const autoPlayer = doc(`<style>html,body{height:100%;margin:0;background:#000}</style><video autoplay muted playsinline loop src="/test.mp4" style="width:100%;height:100%"></video>`);
/** A fixed popup layer, hidden until opened, with `inner` in its centred box. */
const popupLayer = (inner: string) => `<div id="pop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100">
  <div class="pop__box" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);aspect-ratio:16/9">${inner}
    <button type="button" aria-label="Close" style="position:absolute;right:0;top:-44px;width:40px;height:40px" onclick="document.getElementById('pop').style.display='none'">×</button></div></div>`;
const openWith = (frame: string) => `var p=document.getElementById('pop');p.querySelector('.pop__box').insertAdjacentHTML('afterbegin','<iframe src="${frame}" style="border:0;width:100%;height:100%" allow="autoplay"></iframe>');p.style.display='block';`;

/** A player frame (another site): a click on its middle starts it. */
const framePlayer = (wrap: string) =>
  doc(`<style>html,body{height:100%;margin:0;background:#000}</style>${wrap.replace('VIDEO', `<video id="v" src="/test.mp4" playsinline muted style="width:100%;height:100%"></video><div id="ov" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:68px;height:48px;background:red;border-radius:12px"></div></div>`)}
  <script>window.clicks=0;document.getElementById('ov').addEventListener('click',function(){window.clicks++;this.remove();document.getElementById('v').play()})</script>`);
const framePage = (src: string) => doc(`<section data-secref="b1" style="padding:40px 0"><iframe src="${src}" title="Video" style="display:block;border:0;width:min(800px,100%);aspect-ratio:16/9" allow="autoplay"></iframe></section>${more}`);

type Run = { page: Page; context: BrowserContext; r: PlayResult };
async function run(browser: Browser, pages: Record<string, string>, sub: string, phone = false, skip: string[] = []): Promise<Run> {
  const context = await newContext(browser, pages, phone);
  const page = await open(context, Object.keys(pages)[0]);
  const env = { context, framesRoot: path.join(DIR, '_frames', sub), maxClips: 3, touch: phone, log: () => {} };
  const r = await recordPlayClips(page, env, { pageDir: path.join(DIR, sub), vp: phone ? 'mobile' : 'desktop', quality: 85, firstIndex: 10, skip: new Set(skip) });
  return { page, context, r };
}
const said = (r: PlayResult) => r.notes.join(' · ') || 'no notes';
const clipOf = (r: PlayResult, ref = 'b1') => r.clips.find((c) => c.ref === ref && c.verdict === 'recorded');

async function planChecks(browser: Browser): Promise<void> {
  const plan = async (html: string, name: string, test: (blocks: string[], how: string) => boolean) => {
    const context = await newContext(browser, { '/': html });
    const page = await open(context, '/');
    const blocks = (await page.evaluate(playBlocks, { max: 3, skip: [] })).map((b) => `${b.ref} ${b.why}`);
    const p = blocks.length ? await page.evaluate(planPlay, 'b1') : null;
    const how = p ? `${p.ok ? p.how : 'none'} ${p.player} ${p.why}` : 'not nominated';
    note(name, test(blocks, how), `${blocks.join(', ') || 'no blocks'} · ${how}`);
    await context.close();
  };
  await plan(overlayPage(), "plan: the section's own play button over its video", (b, h) => b.length === 1 && h.startsWith('control native'));
  await plan(doc(`<section data-secref="b1"><a href="https://www.youtube.com/watch?v=abc" class="video-link"><img src="https://i.ytimg.com/vi/abc/hqdefault.jpg" alt="" style="width:800px;height:450px"><span class="play-icon">▶</span></a></section>${more}`), 'plan: a thumbnail that links to YouTube is never pressed', (_b, h) => !h.startsWith('control') && !h.startsWith('frame'));
  await plan(doc(`<section data-secref="b1" class="slideshow"><div class="slideshow__slide" style="height:400px;background:#ccc">Slide</div><div class="slideshow__slide">2</div><button type="button" aria-label="Play slideshow">▶</button><button class="slideshow__autoplay" aria-label="Pause slideshow">II</button></section>${more}`), "plan: a slideshow's play button is not a video's", (b) => b.length === 0);
  await plan(doc(`<section data-secref="b1"><img src="${poster()}" alt=""><form action="/subscribe"><button type="submit" aria-label="Play video">▶</button></form></section>${more}`), 'plan: a play button inside a form is never pressed', (b) => b.length === 0);
  await plan(doc(`<section data-secref="b1" style="padding:40px"><video src="/test.mp4" controls playsinline style="width:800px;height:450px"></video></section>${more}`), "plan: a paused video with the browser's controls", (_b, h) => h.startsWith('video native'));
  await plan(framePage('https://player.vimeo.com/video/1'), 'plan: a Vimeo frame is pressed in its middle, at normal speed', (_b, h) => h.startsWith('frame frame'));
  await plan(deferredPage, "plan: Shopify's deferred-media poster button", (_b, h) => h.startsWith('control'));
}

async function recordChecks(browser: Browser): Promise<void> {
  // 1. The store's own play button over a native video: recorded on the section, slowed, paused again.
  {
    const { page, context, r } = await run(browser, { '/': overlayPage() }, 'overlay');
    const c = clipOf(r);
    note('own play button: the video is recorded on the section', !!c && c.motionHint === 'video', said(r));
    note('own play button: recorded in slow motion', !!c && (c.slowdown ?? 1) >= 1, c ? `slowed x${c.slowdown} (${c.captureFps} shots/s)` : 'no clip');
    const paused = await page.evaluate(() => (document.getElementById('v') as HTMLVideoElement).paused);
    note('own play button: the video is paused again afterwards', paused, paused ? 'paused' : 'still playing');
    if (c?.frames && c.framesDir && c.rect) {
      const e = await encodeClip({ framesDir: c.framesDir, frames: c.frames, rect: c.rect, viewportWidth: 1440, frameRegion: c.frameRegion, recordedMs: c.recordedMs || 0, slowdown: c.slowdown, outFile: path.join(DIR, 'overlay.mp4') });
      const want = c.rect.width / c.rect.height;
      note('own play button: the clip encodes, cut to the section', e.ok && e.width <= 1080 && Math.abs(e.width / e.height - want) < 0.1, e.ok ? `${e.width}x${e.height} ${(e.durationMs / 1000).toFixed(1)}s (section ${Math.round(c.rect.width)}x${Math.round(c.rect.height)})` : e.error);
    }
    await context.close();
  }
  // 2. The same on a phone: a tap, and the clip is cut from whole-screen frames.
  {
    const { context, r } = await run(browser, { '/': overlayPage() }, 'overlay-phone', true);
    const c = clipOf(r);
    let enc = 'no clip';
    let ok = false;
    if (c?.frames && c.framesDir && c.rect) {
      const e = await encodeClip({ framesDir: c.framesDir, frames: c.frames, rect: c.rect, viewportWidth: 390, frameRegion: c.frameRegion, recordedMs: c.recordedMs || 0, slowdown: c.slowdown, outFile: path.join(DIR, 'overlay-phone.mp4') });
      ok = e.ok && Math.abs(e.width / e.height - c.rect.width / c.rect.height) < 0.1;
      enc = e.ok ? `${e.width}x${e.height} slowed x${c.slowdown}` : e.error;
    }
    note('phone: the play button is tapped and the clip encodes', ok, `${enc} · ${said(r)}`);
    await context.close();
  }
  // 3. Dawn's deferred-media: the new video starts after the page was slowed, and is slowed too.
  {
    const { context, r } = await run(browser, { '/': deferredPage }, 'deferred');
    const c = clipOf(r);
    note("deferred-media: the video it puts in is recorded", !!c, said(r));
    note('deferred-media: slow motion reached the new video (no second take)', !!c && !c.why.includes('again'), c ? `${c.why} · x${c.slowdown}` : 'no clip');
    await context.close();
  }
  // 4. A popup: a new block for the player box, then the popup is closed and its video paused.
  {
    const { page, context, r } = await run(browser, { '/': popupPage }, 'popup');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    const c = r.clips.find((x) => x.verdict === 'recorded' && b && x.ref === b.ref);
    note('popup: a "video-popup" block with the clip, after the page\'s blocks', !!b && !!c && b.index === 10, `${b ? `${b.ref} ${b.index} ${b.width}x${b.height}` : 'no block'} · ${said(r)}`);
    const st = await page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('pop')!).display !== 'none', paused: (document.getElementById('pv') as HTMLVideoElement).paused }));
    note('popup: closed again and its video paused', !st.shown && st.paused, `popup ${st.shown ? 'still open' : 'closed'}, video ${st.paused ? 'paused' : 'playing'}`);
    await context.close();
  }
  // 5. A video that the page starts once it is on screen: recorded without a press.
  {
    const lazy = doc(`<section style="height:1200px"><h1>Top</h1></section><section data-secref="b1" style="padding:40px 0"><video id="v" src="/test.mp4" muted playsinline loop style="width:800px;height:450px"></video></section>${more}
      <script>new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.play();else e.target.pause()})},{threshold:0.5}).observe(document.getElementById('v'))</script>`);
    const { context, r } = await run(browser, { '/': lazy }, 'lazy');
    const c = clipOf(r);
    note('a video that starts once on screen: recorded, no press', !!c && c.why.includes('once on screen'), said(r));
    await context.close();
  }
  // 6. A paused video with no button and no controls: started muted from inside the page.
  {
    const bare = doc(`<section data-secref="b1" style="padding:40px 0"><video id="v" src="/test.mp4" playsinline preload="auto" style="width:800px;height:450px"></video></section>${more}`);
    const { context, r } = await run(browser, { '/': bare }, 'bare');
    const c = clipOf(r);
    note('a paused video with no button: started muted and recorded', !!c && c.why.includes('script'), said(r));
    await context.close();
  }
  // 6b. A plain icon laid over a paused video, with no play words anywhere: the icon is pressed, not play().
  {
    const iconOver = doc(`<section data-secref="b1" style="padding:40px 0"><div class="media" style="${MEDIA}" onclick="this.querySelector('.ov').remove();this.querySelector('video').play()">
      <video src="/test.mp4" playsinline muted preload="auto" style="width:100%;height:100%"></video>
      <div class="ov" style="position:absolute;left:calc(50% - 40px);top:calc(50% - 40px);width:80px;height:80px;border-radius:50%;background:#fff"></div></div></section>${more}`);
    const { page, context, r } = await run(browser, { '/': iconOver }, 'icon-over');
    const c = clipOf(r);
    const gone = await page.evaluate(() => !document.querySelector('.ov'));
    note('an icon over a paused video: the icon is pressed (it goes away)', !!c && c.why.includes('picture over it') && gone, `${gone ? 'icon gone' : 'icon still there'} · ${said(r)}`);
    await context.close();
  }
  // 7. A player frame from another site: a real click on its middle, recorded at normal speed.
  {
    const pages = { '/': framePage('https://player.vimeo.com/video/1'), 'https://player.vimeo.com/video/1': framePlayer('<div style="position:relative;width:100%;height:100%">VIDEO</div>') };
    const { page, context, r } = await run(browser, pages, 'frame');
    const c = clipOf(r);
    const f = page.frames().find((x) => x.url().includes('player.vimeo.com'));
    const clicks = f ? await f.evaluate(() => (window as unknown as { clicks: number }).clicks).catch(() => -1) : -1;
    note('Vimeo frame: clicked once, recorded at normal speed as an embed', !!c && c.motionHint === 'embed' && (c.slowdown ?? 1) === 1 && clicks === 1, `clicks ${clicks} · ${said(r)}`);
    await context.close();
  }
  // 8. A YouTube frame that plays an advert first: no clip.
  {
    const pages = { '/': framePage('https://www.youtube.com/embed/abc'), 'https://www.youtube.com/embed/abc': framePlayer('<div class="html5-video-player ad-showing" style="position:relative;width:100%;height:100%">VIDEO</div>') };
    const { context, r } = await run(browser, pages, 'advert');
    note('YouTube frame playing an advert: no clip', !clipOf(r) && r.notes.some((n) => n.includes('advert')), said(r));
    await context.close();
  }
  // 9. A YouTube frame that asks to sign in: left alone, never pressed.
  {
    const wall = doc(`<div id="ov" style="height:100vh;background:#222;color:#fff;display:flex;align-items:center;justify-content:center">Sign in to confirm you're not a bot</div><script>window.clicks=0;document.addEventListener('click',function(){window.clicks++})</script>`);
    const pages = { '/': framePage('https://www.youtube.com/embed/xyz'), 'https://www.youtube.com/embed/xyz': wall };
    const { page, context, r } = await run(browser, pages, 'wall');
    const f = page.frames().find((x) => x.url().includes('youtube.com/embed/xyz'));
    const clicks = f ? await f.evaluate(() => (window as unknown as { clicks: number }).clicks).catch(() => -1) : -1;
    note('YouTube frame asking to sign in: never pressed, no clip', !clipOf(r) && clicks === 0 && r.notes.some((n) => n.includes('player-wall')), `clicks ${clicks} · ${said(r)}`);
    await context.close();
  }
  // 10. A player that will not slow down: taken again at normal speed (phone, where slow motion is needed).
  {
    const stubborn = overlayPage(`var v=document.getElementById('v');v.addEventListener('ratechange',function(){if(v.playbackRate!==1)v.playbackRate=1})`);
    const { context, r } = await run(browser, { '/': stubborn }, 'stubborn', true);
    const c = clipOf(r);
    note('a video that will not slow down: recorded at normal speed', !!c && (c.slowdown ?? 1) === 1, c ? `${c.why} · x${c.slowdown}` : said(r));
    await context.close();
  }
  // 11. A play button that would leave the page: the visit is stopped before it starts, nothing is kept.
  {
    const leaves = doc(`<section data-secref="b1" style="padding:40px"><div style="${MEDIA}"><img src="${poster()}" alt="" style="width:100%"><button type="button" aria-label="Play video" style="position:absolute;left:45%;top:40%;width:80px;height:80px" onclick="location.href='/video'">${playIcon}</button></div></section>${more}`);
    asked.length = 0;
    const { page, context, r } = await run(browser, { '/': leaves, '/video': doc('<h1>Video page</h1>') }, 'leaves');
    const reached = asked.some((u) => u.endsWith('/video'));
    note('a play button that would leave the page: it stays, nothing kept', !reached && page.url() === `${ORIGIN}/` && !r.clips.length && !r.blocks.length, `/video ${reached ? 'VISITED' : 'not visited'} · ${said(r)}`);
    await context.close();
  }
  // 13. A theme's own popup element with a "video-popup__play" icon (beatific.co): opens a YouTube popup.
  {
    const page1 = doc(`<section data-secref="b1" style="position:relative;padding:40px"><img src="${poster('#6d597a')}" alt="" style="width:min(800px,100%)">
      <video-modal-popup class="video-popup__link content" data-video-type="youtube" style="display:block;padding:20px" onclick="${openWith('https://www.youtube.com/embed/pop1?autoplay=1').replace(/"/g, '&quot;')}"><span class="video-popup__play" style="display:inline-block;width:60px;height:60px;border-radius:50%;background:#fff"></span> Our story</video-modal-popup></section>${more}${popupLayer('')}`);
    const { context, r } = await run(browser, { '/': page1, 'https://www.youtube.com/embed/pop1': autoPlayer }, 'theme-popup');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    note('a theme popup element (video-popup__play): popup block recorded', !!b && r.clips.some((c) => c.ref === b.ref && c.motionHint === 'embed'), said(r));
    await context.close();
  }
  // 14. A link to Vimeo that the store opens in a popup (dadgrass.com): the popup is recorded.
  {
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><img src="${poster('#355070')}" alt="" style="width:min(800px,100%)">
      <video-popup class="hero__button"><a href="https://vimeo.com/341847294" class="btn image__video__play" data-video-play="vimeo" onclick="event.preventDefault();${openWith('https://player.vimeo.com/video/341847294?autoplay=1').replace(/"/g, '&quot;')}">${playIcon}</a></video-popup></section>${more}${popupLayer('')}`);
    const { page, context, r } = await run(browser, { '/': page1, 'https://player.vimeo.com/video/341847294': autoPlayer }, 'link-popup');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    note('a Vimeo link the store opens in a popup: popup block recorded', !!b && page.url() === `${ORIGIN}/`, said(r));
    await context.close();
  }
  // 15. The same link with no popup script: the visit to Vimeo is stopped before it starts, nothing is kept.
  {
    asked.length = 0;
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><img src="${poster('#355070')}" alt="" style="width:min(800px,100%)">
      <video-popup class="hero__button"><a href="https://vimeo.com/341847294" class="btn image__video__play" data-video-play="vimeo">${playIcon}</a></video-popup></section>${more}`);
    const { page, context, r } = await run(browser, { '/': page1, 'https://vimeo.com/341847294': doc('<h1>Vimeo</h1>') }, 'link-blocked');
    const reached = asked.some((u) => u.startsWith('https://vimeo.com/'));
    note('a video link the store does not open in a popup: Vimeo never visited', !reached && page.url() === `${ORIGIN}/` && !r.blocks.length && !r.clips.length, `vimeo ${reached ? 'VISITED' : 'not visited'} · page ${page.url()} · ${said(r)}`);
    await context.close();
  }
  // 16. A popup that shows a poster with a second play button (burton.com's "Watch Video"): pressed too.
  {
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><div class="card"><h3>Directional camber</h3>
      <button type="button" class="prd-TechGlossaryCard_Button" onclick="document.getElementById('pop').style.display='block'">Watch Video</button></div></section>${more}
      ${popupLayer(`<youtube-video class="vd-YoutubeVideo_Embed" data-video-id="cam1" style="display:block;position:relative;width:100%;height:100%;background:#333"><button type="button" class="vd-YoutubeVideo_Overlay" aria-label="Play video" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0" onclick="this.parentElement.innerHTML='<iframe src=&quot;https://www.youtube.com/embed/cam1?autoplay=1&quot; style=&quot;border:0;width:100%;height:100%&quot; allow=&quot;autoplay&quot;></iframe>'"></button></youtube-video>`)}`);
    const { context, r } = await run(browser, { '/': page1, 'https://www.youtube.com/embed/cam1': autoPlayer }, 'second-press');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    note("a popup with its own play button: both pressed, popup recorded", !!b && r.notes.some((n) => n.includes("popup's play button")), said(r));
    await context.close();
  }
  // 17. A play button that opens a popup with no video in it: no clip, and the popup is closed again.
  {
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><img src="${poster('#b56576')}" alt="" style="width:min(800px,100%)">
      <button type="button" class="video-trigger" aria-label="Play video" onclick="document.getElementById('pop').style.display='block'">${playIcon}</button></section>${more}
      ${popupLayer('<p style="color:#fff;font-size:32px">Coming soon</p>')}`);
    const { page, context, r } = await run(browser, { '/': page1 }, 'empty-popup');
    const open = await page.evaluate(() => getComputedStyle(document.getElementById('pop')!).display !== 'none');
    note('a popup with no video in it: no clip, closed again', !r.clips.length && !r.blocks.length && !open, `popup ${open ? 'STILL OPEN' : 'closed'} · ${said(r)}`);
    await context.close();
  }
  // 18. A popup whose YouTube player waits for its own press (beatific.co): its middle is pressed too.
  {
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><img src="${poster('#e56b6f')}" alt="" style="width:min(800px,100%)">
      <button type="button" class="video-trigger" aria-label="Play video" onclick="${openWith('https://www.youtube.com/embed/nostart').replace(/"/g, '&quot;')}">${playIcon}</button></section>${more}${popupLayer('')}`);
    const pages = { '/': page1, 'https://www.youtube.com/embed/nostart': framePlayer('<div style="position:relative;width:100%;height:100%">VIDEO</div>') };
    const { context, r } = await run(browser, pages, 'popup-frame-press');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    note('a popup player that waits for a press: pressed in its middle, recorded', !!b && r.notes.some((n) => n.includes('the popup player')), said(r));
    await context.close();
  }
  // 19. A popup kept inside the section's own markup (burton.com): still a popup, not the section.
  {
    const page1 = doc(`<section data-secref="b1" style="padding:40px"><h3>Directional camber</h3>
      <button type="button" class="video-trigger" onclick="document.getElementById('pop').style.display='block';document.getElementById('pv').play()">Watch Video</button>
      <div id="pop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);aspect-ratio:16/9"><video id="pv" src="/test.mp4" muted playsinline style="width:100%;height:100%"></video>
      <button type="button" aria-label="Close" style="position:absolute;right:0;top:-44px" onclick="document.getElementById('pop').style.display='none'">×</button></div></div></section>${more}`);
    const { context, r } = await run(browser, { '/': page1 }, 'popup-in-section');
    const b = r.blocks.find((x) => x.typeHint === 'video-popup');
    note("a popup inside the section's markup: recorded as a popup block", !!b && !clipOf(r, 'b1'), said(r));
    await context.close();
  }
  // 12. A section that already has a clip is left alone.
  {
    const { context, r } = await run(browser, { '/': overlayPage() }, 'skip', false, ['b1']);
    note('a section that already has a clip is not pressed', !r.clips.length && !r.notes.length, said(r));
    await context.close();
  }
}

async function main(): Promise<void> {
  await rm(DIR, { recursive: true, force: true });
  await mkdir(DIR, { recursive: true });
  const ff = await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(DIR, 'test.mp4')]);
  if (ff.code !== 0) {
    console.error(`ffmpeg is needed for clips and for this check: ${ff.stderr.trim()}`);
    process.exit(2);
  }
  video = await readFile(path.join(DIR, 'test.mp4'));
  const browser = await chromium.launch();
  try {
    await planChecks(browser);
    await recordChecks(browser);
  } finally {
    await browser.close();
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} of ${results.length} FAILED` : `all ${results.length} play cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
