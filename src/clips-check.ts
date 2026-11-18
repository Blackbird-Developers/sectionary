// Checks slow-motion clips and pressed sliders (src/time-warp.ts, src/clips.ts) on local pages in Chromium.
// No network: pages are served from a made-up origin by Playwright. Needs ffmpeg on the PATH, like clips do.
//   npm run clips-check
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeClip, runFfmpeg } from './clip-encode.js';
import { hasGif, placeSlider, planSlider, scrollTrack, type SliderPlan } from './clip-script.js';
import { recordClips, recordSliderClips, type RawClip } from './clips.js';
import { chooseSlowdown, setPageRate, TIME_WARP_SCRIPT } from './time-warp.js';

const ORIGIN = 'https://shop.test';
const DIR = path.resolve('_tmp/clips-check');
const results: { name: string; ok: boolean; said: string }[] = [];
const note = (name: string, ok: boolean, said: string) => {
  results.push({ name, ok, said });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} -> ${said}`);
};

async function newContext(browser: Browser, phone = false): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: 'no-preference',
  });
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  await context.addInitScript(TIME_WARP_SCRIPT);
  return context;
}

/** Serves `pages` (path -> body) under ORIGIN and opens the first. */
async function open(context: BrowserContext, pages: Record<string, string>): Promise<Page> {
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    const body = pages[p];
    if (body === undefined) return route.fulfill({ status: 404, body: 'not here' });
    return route.fulfill({ status: 200, contentType: p.endsWith('.mp4') ? 'video/mp4' : 'text/html', body });
  });
  await page.goto(`${ORIGIN}${Object.keys(pages)[0]}`);
  await page.waitForTimeout(300);
  return page;
}

const doc = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif}</style></head><body>${body}</body></html>`;
const filler = '<section style="height:500px;padding:40px"><h2>Our story</h2><p>Soft, warm socks.</p></section>';
const colours = ['#e63946', '#2a9d8f', '#e9c46a', '#264653'];
/** A slider: 4 slides in a track that slides by transform. `controls` goes inside the slider. */
const slider = (controls: string, extra = '') => `
<section data-secref="b1" class="slideshow-section" style="padding:24px 0">
  <div class="slideshow" style="position:relative;overflow:hidden;height:420px">
    <div id="track" style="display:flex;height:100%;transition:transform .5s ease">
      ${colours.map((c, i) => `<div class="slideshow__slide" style="flex:0 0 100%;background:${c};display:flex;align-items:center;justify-content:center;color:#fff;font-size:64px">Slide ${i + 1}</div>`).join('')}
    </div>
    ${controls}
  </div>
  ${extra}
</section>
<script>var at=0;function go(i){at=(i+4)%4;document.getElementById('track').style.transform='translateX('+(-100*at)+'%)'}</script>`;

/** How far a value is from what was wanted, as a share. */
const near = (got: number, want: number, share: number) => Math.abs(got - want) <= want * share;

async function timeWarp(browser: Browser): Promise<void> {
  const context = await newContext(browser);
  const video = await readFile(path.join(DIR, 'test.mp4'));
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (route) =>
    route.request().url().endsWith('.mp4')
      ? route.fulfill({ status: 200, contentType: 'video/mp4', body: video })
      : route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: doc(`<style>@keyframes s{to{transform:translateX(900px)}}#a{width:40px;height:40px;background:red;animation:s 10s linear infinite}</style><div id=a></div>
<video id=v muted loop autoplay playsinline src="/test.mp4"></video>
<script>window.ticks=0;setInterval(function(){window.ticks++},100);window.fr=0;(function f(){window.fr++;requestAnimationFrame(f)})();</script>`),
        }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.waitForTimeout(1200);
  const cdp = await context.newCDPSession(page);
  const read = () =>
    page.evaluate(() => ({
      anim: Number(document.getElementById('a')!.getAnimations()[0].currentTime),
      ticks: (window as unknown as { ticks: number }).ticks,
      fr: (window as unknown as { fr: number }).fr,
      perf: performance.now(),
      date: Date.now(),
      video: (document.getElementById('v') as HTMLVideoElement).currentTime * 1000,
    }));
  const measure = async (rate: number) => {
    await setPageRate(page, cdp, rate);
    const a = await read();
    await page.waitForTimeout(2000);
    const b = await read();
    return { anim: b.anim - a.anim, ticks: b.ticks - a.ticks, fr: b.fr - a.fr, perf: b.perf - a.perf, date: b.date - a.date, video: b.video - a.video };
  };
  const normal = await measure(1);
  const slow = await measure(0.25);
  await setPageRate(page, cdp, 1);
  const back = await measure(1);
  for (const key of ['anim', 'ticks', 'fr', 'perf', 'date', 'video'] as const) {
    note(`slow motion x4: ${key}`, near(slow[key], normal[key] / 4, 0.25), `normal ${Math.round(normal[key])}, slowed ${Math.round(slow[key])}`);
  }
  note('slow motion: back to normal afterwards', near(back.perf, normal.perf, 0.1) && near(back.anim, normal.anim, 0.15), `page clock +${Math.round(back.perf)} ms in 2 s`);
  await context.close();
}

function slowdownCases(): void {
  note('chooseSlowdown: 7.5 shots/s for a 5 s clip', chooseSlowdown(7.5, 5000) === 4, `x${chooseSlowdown(7.5, 5000)}`);
  note('chooseSlowdown: fast PC (40 shots/s) records at normal speed', chooseSlowdown(40, 5000) === 1, `x${chooseSlowdown(40, 5000)}`);
  note('chooseSlowdown: capped at x8', chooseSlowdown(2, 4000) === 8, `x${chooseSlowdown(2, 4000)}`);
  note('chooseSlowdown: a 10 s clip never runs past 40 s', chooseSlowdown(2, 10_000) === 4, `x${chooseSlowdown(2, 10_000)}`);
  note('chooseSlowdown: speed unknown', chooseSlowdown(0, 5000) === 4, `x${chooseSlowdown(0, 5000)}`);
}

type PlanCase = { name: string; html: string; phone?: boolean; want: SliderPlan['how']; check?: string };
const planCases: PlanCase[] = [
  { name: 'its "next" arrow', html: slider('<button class="swiper-button-next" aria-label="Next slide" onclick="go(at+1)" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button>'), want: 'next' },
  {
    name: 'the button, not the icon inside it',
    html: slider('<button aria-label="Next slide" onclick="go(at+1)" style="position:absolute;right:12px;top:180px;width:48px;height:48px"><svg class="icon icon-arrow-right" width="20" height="20"></svg></button>'),
    want: 'next',
    check: "document.querySelector('[data-secslide=next]').tagName === 'BUTTON'",
  },
  {
    name: 'an arrow that links to another page is never used',
    html: slider('<a href="/collections/all" class="arrow-next" style="position:absolute;right:12px;top:180px;width:48px;height:48px">Next</a><div class="slick-dots" style="position:absolute;bottom:8px;left:45%"><button>1</button><button>2</button><button>3</button></div>'),
    want: 'dots',
    check: '!document.querySelector("[data-secslide=next]")',
  },
  { name: 'only dots: the 2nd to 4th are marked', html: slider(`<div class="slick-dots" style="position:absolute;bottom:8px;left:45%">${[0, 1, 2, 3].map((i) => `<button onclick="go(${i})">${i + 1}</button>`).join('')}</div>`), want: 'dots', check: "document.querySelectorAll('[data-secslide-dot]').length === 3" },
  {
    name: 'a disabled arrow is skipped; a sideways track is scrolled',
    html: `<section data-secref="b1" class="product-slider"><button class="slider-button--next swiper-button-disabled" aria-label="Next" disabled style="width:40px;height:40px">›</button><ul class="slider" style="display:flex;overflow-x:auto;gap:16px;list-style:none;padding:0;margin:0">${Array.from({ length: 8 }, (_, i) => `<li class="slider__slide" style="flex:0 0 320px;height:300px;background:${colours[i % 4]}"></li>`).join('')}</ul></section>`,
    want: 'scroll',
  },
  { name: 'a "next" button inside a form is never used', html: slider('<form action="/search"><button aria-label="Next" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button></form>'), want: 'none' },
  {
    name: 'a slide whose text ends in an arrow is never pressed',
    html: `<section data-secref="b1" class="product-slider"><div class="swiper" style="height:300px;overflow:hidden"><div class="swiper-wrapper" style="display:flex">${[1, 2, 3].map((i) => `<div class="swiper-slide" role="group" aria-label="${i} / 3" style="flex:0 0 400px;height:300px"><a href="/products/p${i}">Cookie dough ${i}</a> <span>Shop now →</span></div>`).join('')}</div></div></section>`,
    want: 'none',
  },
  { name: 'desktop: nothing to press', html: slider(''), want: 'none' },
  { name: 'phone: nothing to press, so a swipe', html: slider(''), phone: true, want: 'swipe' },
];

async function planChecks(browser: Browser): Promise<void> {
  for (const c of planCases) {
    const context = await newContext(browser, c.phone);
    const page = await open(context, { '/': doc(filler + c.html + filler) });
    await page.evaluate(placeSlider, { ref: 'b1', scroll: true });
    const plan = await page.evaluate(planSlider, { ref: 'b1', touch: !!c.phone });
    const extra = c.check ? await page.evaluate(c.check).catch(() => false) : true;
    note(`slider plan: ${c.name}`, plan.how === c.want && !!extra, `${plan.how}${plan.why ? ` (${plan.why})` : ''}`);
    await context.close();
  }
  // The track really moves by one slide.
  const context = await newContext(browser);
  const page = await open(context, { '/': doc(planCases[4].html) });
  await page.evaluate(planSlider, { ref: 'b1', touch: false });
  const before = await page.evaluate(() => (document.querySelector('[data-secslide=track]') as HTMLElement).scrollLeft);
  await page.evaluate(scrollTrack);
  const after = await page.evaluate(() => (document.querySelector('[data-secslide=track]') as HTMLElement).scrollLeft);
  note('scrollTrack: moves to the next slide', after - before >= 300 && after - before <= 340, `${Math.round(before)} -> ${Math.round(after)} px`);
  // A block that is mostly an animated GIF is recorded at normal speed; a small GIF in a big block is not.
  const gifSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  await page.setContent(doc(`<section data-secref="b2" style="width:420px"><img src="${gifSrc}" style="width:400px;height:300px"></section>`));
  note('hasGif: a block that is mostly a GIF', await page.evaluate(hasGif, 'b2'), 'normal speed');
  await page.setContent(doc(`<section data-secref="b3" style="height:600px;background:#eee"><img src="${gifSrc}" style="width:72px;height:72px"></section>`));
  note('hasGif: a small GIF icon does not count', !(await page.evaluate(hasGif, 'b3')), 'slowed as usual');
  await context.close();
}

/**
 * Pictures per second of clip while something moves: from the frame times (page time), the median gap between
 * frames that come less than 0.25 s apart. (The desktop screencast sends nothing while the picture stands still,
 * so frames over clip seconds would undercount.)
 */
const clipFps = (c: RawClip) => {
  if (!c.frames || c.frames.length < 3) return 0;
  const k = c.slowdown || 1;
  const gaps = c.frames
    .slice(1)
    .map((f, i) => (f.ts - c.frames![i].ts) / k)
    .filter((g) => g > 0 && g < 0.25)
    .sort((a, b) => a - b);
  return gaps.length ? 1 / gaps[Math.floor(gaps.length / 2)] : 0;
};

async function encode(c: RawClip, name: string): Promise<{ ok: boolean; ms: number }> {
  if (c.verdict !== 'recorded' || !c.frames || !c.framesDir || !c.rect) return { ok: false, ms: 0 };
  const res = await encodeClip({ framesDir: c.framesDir, frames: c.frames, rect: c.rect, viewportWidth: c.viewportWidth || 1440, frameRegion: c.frameRegion, recordedMs: c.recordedMs || 0, slowdown: c.slowdown, outFile: path.join(DIR, `${name}.mp4`) });
  return res.ok ? { ok: true, ms: res.durationMs } : { ok: false, ms: 0 };
}

async function recordingChecks(browser: Browser): Promise<void> {
  const env = (context: BrowserContext, sub: string, phone = false) => ({ context, framesRoot: path.join(DIR, '_frames', sub), maxClips: 4, touch: phone, log: () => {} });

  // 1. A slider pressed three times: recorded slowed, sped back up to about 6.8 s, smooth.
  {
    const context = await newContext(browser);
    const page = await open(context, { '/': doc(filler + slider('<button aria-label="Next slide" onclick="go(at+1)" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button>') + filler) });
    const [c] = await recordSliderClips(page, env(context, 'slider'), new Set());
    const e = c ? await encode(c, 'slider') : { ok: false, ms: 0 };
    note('slider: pressed, recorded and encoded', !!c && c.verdict === 'recorded' && e.ok, c ? `${c.verdict}${c.error ? ' ' + c.error : ''} · ${c.why} · slowed x${c.slowdown} at ${c.captureFps} shots/s` : 'no clip');
    // 6.8 s of presses; the desktop screencast's last picture is held for at most 1 s, so 5.5 to 7.5 s.
    note('slider: plays at the page speed (about 6 to 7 s)', e.ms >= 5500 && e.ms <= 7500, `${(e.ms / 1000).toFixed(1)} s`);
    note('slider: smooth (20+ pictures per clip second)', !!c && clipFps(c) >= 20, `${c ? clipFps(c).toFixed(1) : 0} per second`);
    await context.close();
  }
  // 2. Phone: the same slider, tapped.
  {
    const context = await newContext(browser, true);
    const page = await open(context, { '/': doc(filler + slider('<button aria-label="Next slide" onclick="go(at+1)" style="position:absolute;right:8px;top:180px;width:44px;height:44px">›</button>').replace('height:420px', 'height:300px') + filler) });
    const [c] = await recordSliderClips(page, env(context, 'slider-phone', true), new Set());
    note('phone slider: tapped and recorded', !!c && c.verdict === 'recorded', c ? `${c.verdict}${c.error ? ' ' + c.error : ''} · slowed x${c.slowdown}` : 'no clip');
    await context.close();
  }
  // 3. An arrow that does nothing leaves no clip.
  {
    const context = await newContext(browser);
    const page = await open(context, { '/': doc(filler + slider('<button aria-label="Next slide" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button>') + filler) });
    const [c] = await recordSliderClips(page, env(context, 'dead-arrow'), new Set());
    note('slider: an arrow that does nothing leaves no clip', !!c && c.verdict === 'not-moving' && c.error === 'no-change', c ? `${c.verdict} ${c.error ?? ''}` : 'no clip');
    await context.close();
  }
  // 3b. A dead arrow beside something else that moves by itself (a drifting gradient) still leaves no clip.
  {
    const context = await newContext(browser);
    const gradient = '<style>@keyframes g{to{background-position:400px 0}}</style><div style="height:200px;background:linear-gradient(90deg,#0af,#f0a,#0af);background-size:400px 100%;animation:g 3s linear infinite"></div>';
    const page = await open(context, { '/': doc(filler + slider('<button aria-label="Next slide" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button>', gradient) + filler) });
    const [c] = await recordSliderClips(page, env(context, 'dead-arrow-gradient'), new Set());
    note('slider: a dead arrow beside a moving background leaves no clip', !!c && c.verdict === 'not-moving' && c.error === 'no-change', c ? `${c.verdict} ${c.error ?? ''}` : 'no clip');
    await context.close();
  }
  // 4. A press that leaves the page stops everything and keeps nothing.
  {
    const context = await newContext(browser);
    const page = await open(context, {
      '/': doc(filler + slider(`<button aria-label="Next slide" onclick="location.href='/elsewhere'" style="position:absolute;right:12px;top:180px;width:48px;height:48px">›</button>`) + filler),
      '/elsewhere': doc('<h1>Another page</h1>'),
    });
    const [c] = await recordSliderClips(page, env(context, 'leaves'), new Set());
    note('slider: a press that leaves the page stops, keeps nothing', !!c && c.verdict === 'failed' && c.error === 'navigated' && !c.frames, c ? `${c.verdict} ${c.error ?? ''}` : 'no clip');
    await context.close();
  }
  // 5. A block that moves by itself (a scrolling marquee) is recorded slowed and comes out at page speed.
  {
    const context = await newContext(browser);
    const page = await open(context, {
      '/': doc(
        filler +
          `<style>@keyframes m{to{transform:translateX(-50%)}}</style><section data-secref="b1" style="height:200px;overflow:hidden;background:#111;color:#fff"><div class="marquee" style="display:flex;gap:40px;width:max-content;font-size:48px;line-height:200px;animation:m 6s linear infinite">${'<span>FREE SHIPPING</span><span>NEW IN</span>'.repeat(8)}</div></section>` +
          filler,
      ),
    });
    const clips = await recordClips(page, env(context, 'marquee'));
    const c = clips.find((x) => x.ref === 'b1');
    const e = c ? await encode(c, 'marquee') : { ok: false, ms: 0 };
    note('marquee: recorded slowed, encoded at page speed (4 s)', !!c && c.verdict === 'recorded' && e.ok && near(e.ms, 4000, 0.2), c ? `${c.verdict} · slowed x${c.slowdown} at ${c.captureFps} shots/s · ${(e.ms / 1000).toFixed(1)} s` : 'no clip');
    note('marquee: smooth (20+ pictures per clip second)', !!c && clipFps(c) >= 20, `${c ? clipFps(c).toFixed(1) : 0} per second`);
    await context.close();
  }
}

async function main(): Promise<void> {
  await rm(DIR, { recursive: true, force: true });
  await mkdir(DIR, { recursive: true });
  const ff = await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(DIR, 'test.mp4')]);
  if (ff.code !== 0) {
    console.error(`ffmpeg is needed for clips and for this check: ${ff.stderr.trim()}`);
    process.exit(1);
  }
  slowdownCases();
  const browser = await chromium.launch();
  try {
    await timeWarp(browser);
    await planChecks(browser);
    await recordingChecks(browser);
  } finally {
    await browser.close();
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} of ${results.length} FAILED` : `all ${results.length} clip cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
