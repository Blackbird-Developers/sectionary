// A local test of clips (video-sections-brief.md): records short silent clips of blocks that move by
// themselves, for the pages given, and writes them under --out. Nothing is imported or uploaded.
//
//   npm run clips-try -- <url> [<url> ...] [--mobile] --out _tmp/clips-test
//
// Per page and viewport: one visit, clips recorded before motion is switched off, then the block stills
// (the posters) taken the way capture-page.ts takes them. Writes <out>/<host>/<slug>/blocks/<d|m>-<NN>-<type>.jpg
// (poster) and .mp4 (clip), <out>/<host>/<slug>/clips.json, and a review sheet <out>/_review/clips.jpg.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VIEWPORTS, pageSlug, type ViewportName } from './capture-page.js';
import { collectBlocks, detectWall, hidePinned, restorePinned, type BlockInfo } from './page-script.js';
import { Politeness } from './polite.js';
import type { MotionHint } from './clip-script.js';
import { recordClips, type RawClip } from './clips.js';
import { encodeClip, runFfmpeg } from './clip-encode.js';

// ---- copied from capture-page.ts (not exported there) ------------------------------------------

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'block';
}

const HIDE_CONSENT_CSS = `
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
#usercentrics-root, #usercentrics-cmp-ui, #uc-center-container,
#didomi-host, #didomi-notice, .didomi-popup-backdrop,
#truste-consent-track, .truste_overlay, .truste_box_overlay, #consent_blackbar, #teconsent,
#trustarc-banner-overlay, .truste-consent-content-wrapper, #truste-consent-content,
#shopify-pc__banner, .shopify-pc__banner__dialog,
#iubenda-cs-banner,
.cky-consent-container, .cky-overlay,
#cmplz-cookiebanner-container, .cmplz-cookiebanner,
#termly-code-snippet-support,
#qc-cmp2-container, .qc-cmp2-container,
[id^="sp_message_container"],
#cookiescript_injected, #cookiescript_injected_wrapper,
#BorlabsCookieBox,
#axeptio_overlay, .axeptio_mount,
.osano-cm-window, .osano-cm-dialog,
#klaro, .klaro,
#cookie-law-info-bar, .cli-modal-backdrop,
#hs-eu-cookie-confirmation,
#pandectes-banner, .pandectes-cookie-banner,
#cookie-notice, #cookieConsent, #cookie-consent, #cookie-banner, #cookiebanner, #cookie-bar,
.cookie-banner, .cookie-consent, .cookie-notice, .cookie-bar, .cc-window, .cc-banner,
#gdpr-cookie-message, .gdpr-cookie-notice
{ display: none !important; visibility: hidden !important; }
`;

// What capture-page.ts injects (with HIDE_CONSENT_CSS) before anything else; here it comes after the clips.
const ZERO_MOTION_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}';

async function dismissOverlays(page: Page, escape = true): Promise<void> {
  await page
    .evaluate(() => {
      for (const el of [document.documentElement, document.body]) {
        if (el && getComputedStyle(el).overflowY === 'hidden' && el.scrollHeight > window.innerHeight * 1.5) el.style.setProperty('overflow-y', 'auto', 'important');
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 1200 || el.querySelectorAll('a').length > 6) continue;
        if (/cookie|gdpr|consent/i.test(text) && /\b(accept|agree|ok|okay|got it|allow|decline|reject|understood|dismiss)\b/i.test(text)) el.style.setProperty('display', 'none', 'important');
      }
    })
    .catch(() => {});
  if (escape) await page.keyboard.press('Escape').catch(() => {});
  await page
    .evaluate(() => {
      const sels = [
        '[role="dialog"] button[aria-label*="close" i]',
        '[role="dialog"] [class*="close" i]',
        '.klaviyo-close-form',
        '[class*="klaviyo"] [aria-label*="close" i]',
        '[class*="popup" i] [class*="close" i]',
        '[class*="modal" i] [class*="close" i]',
        '[id*="popup" i] [class*="close" i]',
        '[class*="newsletter" i] [class*="close" i]',
        'button[aria-label="Close"]',
        'button[aria-label="Close dialog"]',
        '[data-testid="close"]',
        '#onetrust-reject-all-handler',
        '#CybotCookiebotDialogBodyButtonDecline',
        '.cc-btn.cc-dismiss',
        '[class*="cookie" i] button[class*="decline" i]',
        '[class*="cookie" i] button[class*="reject" i]',
      ];
      let clicked = 0;
      for (const s of sels) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(s))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && clicked < 4) {
            el.click();
            clicked++;
          }
        }
      }
      return clicked;
    })
    .catch(() => 0);
}

async function autoScroll(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const limit = Math.min(document.documentElement.scrollHeight, 60000);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 160));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

// ---- the test --------------------------------------------------------------------------------

type ClipEntry = {
  ref: string;
  index: number;
  typeHint: string;
  motionHint: MotionHint;
  viewport: ViewportName;
  /** Why it was nominated. */
  why: string;
  poster: string | null;
  /** recorded, not-moving, click-to-play or failed. */
  verdict: RawClip['verdict'];
  clip?: { kind: MotionHint; file: string; width: number; height: number; durationMs: number; bytes: number; rect: { x: number; y: number; width: number; height: number } };
  error?: string;
};

type ViewportSummary = { host: string; slug: string; viewport: ViewportName; candidates: number; recorded: number; errors: string[]; clipMs: number; encodeMs: number; totalMs: number; note?: string };

const MAX_CLIPS = 4;
const HARD_VIEWPORT_MS = 200_000;

async function runViewport(browser: Browser, url: string, vp: ViewportName, out: string, polite: Politeness, store: Map<string, ClipEntry[]>, phoneDpr?: number): Promise<ViewportSummary> {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const slug = pageSlug(u);
  const pageDir = path.join(out, host, slug);
  const summary: ViewportSummary = { host, slug, viewport: vp, candidates: 0, recorded: 0, errors: [], clipMs: 0, encodeMs: 0, totalMs: 0 };
  const t0 = Date.now();
  const v = VIEWPORTS[vp];
  const log = (s: string) => console.log(`[${host} ${vp}] ${s}`);

  const verdict = await polite.allowed(url);
  if (!verdict.ok) {
    summary.note = `skipped: ${verdict.reason}`;
    log(summary.note);
    return summary;
  }

  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    // --phone-dpr is a test-only switch for the phone viewport; the crawler itself uses v.deviceScaleFactor.
    deviceScaleFactor: vp === 'mobile' && phoneDpr ? phoneDpr : v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    userAgent: v.userAgent,
    locale: 'en-US',
    colorScheme: 'light',
    // Motion stays on while clips are recorded; it is switched off before the stills.
    reducedMotion: 'no-preference',
    ignoreHTTPSErrors: true,
  });
  let timer: NodeJS.Timeout | undefined;
  const hardStop = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), HARD_VIEWPORT_MS);
  });
  const framesRoot = path.join(out, '_frames', host, slug, vp[0]);
  const pending: { raw: RawClip; entry: ClipEntry; mp4: string }[] = [];
  try {
    const r = await Promise.race([inner(), hardStop]);
    if (r === 'timeout') summary.errors.push('viewport-timeout');
  } catch (e) {
    summary.errors.push((e as Error).message.split('\n')[0]);
    log(`FAILED ${summary.errors[summary.errors.length - 1]}`);
  } finally {
    if (timer) clearTimeout(timer);
    await context.close().catch(() => {});
  }

  // Encoding after the context is closed, so it never counts against the page.
  const te = Date.now();
  for (const p of pending) {
    const raw = p.raw;
    if (raw.verdict !== 'recorded' || !raw.frames || !raw.framesDir || !raw.rect || !raw.block || !raw.viewportWidth) continue;
    const res = await encodeClip({ framesDir: raw.framesDir, frames: raw.frames, rect: raw.rect, viewportWidth: raw.viewportWidth, frameRegion: raw.frameRegion, recordedMs: raw.recordedMs || 5000, outFile: p.mp4 });
    if (res.ok) {
      p.entry.clip = {
        kind: raw.motionHint,
        file: path.relative(pageDir, p.mp4).split(path.sep).join('/'),
        width: res.width,
        height: res.height,
        durationMs: res.durationMs,
        bytes: res.bytes,
        // CSS pixels relative to the block's top-left.
        rect: { x: Math.round(raw.rect.x - raw.block.x), y: Math.round(raw.rect.y - raw.block.y), width: Math.round(raw.rect.width), height: Math.round(raw.rect.height) },
      };
      summary.recorded++;
      log(`${p.entry.ref} ${raw.motionHint}: ${(res.durationMs / 1000).toFixed(1)}s ${Math.round(res.bytes / 1024)} KB ${res.width}x${res.height} crf ${res.crf}`);
    } else {
      p.entry.verdict = 'failed';
      p.entry.error = res.error;
      summary.errors.push(`${p.entry.ref}: ${res.error}`);
      log(`${p.entry.ref} ${raw.motionHint}: ENCODE FAILED ${res.error}`);
    }
  }
  summary.encodeMs = Date.now() - te;
  await rm(framesRoot, { recursive: true, force: true }).catch(() => {});

  const entries = store.get(pageDir) || [];
  await writeFile(path.join(pageDir, 'clips.json'), JSON.stringify({ url, host, slug, capturedAt: new Date().toISOString(), candidates: entries }, null, 2), 'utf8').catch(() => {});
  summary.totalMs = Date.now() - t0;
  return summary;

  async function inner(): Promise<'done'> {
    await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    // One navigation per second per host (or the site's Crawl-delay); robots.txt was checked above.
    await polite.waitFor(url);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const status = resp ? resp.status() : null;
    if (status !== null && status >= 400) throw new Error(`http-${status}`);
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // Only the consent-hiding rule: motion stays on until the clips are done.
    await page.addStyleTag({ content: HIDE_CONSENT_CSS }).catch(() => {});
    await page.waitForTimeout(1200);
    const wall = await page.evaluate(detectWall).catch(() => null);
    if (wall) throw new Error(`wall:${wall.kind}`);
    await dismissOverlays(page);
    await autoScroll(page);
    await page.waitForTimeout(600);
    await dismissOverlays(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const collected = await page.evaluate(collectBlocks, { minHeight: 80, maxBlocks: 40 });
    const blockOf = new Map<string, BlockInfo>(collected.blocks.map((b) => [b.ref, b]));
    log(`${collected.blocks.length} blocks (${collected.strategy})`);

    // ---- the clip step (brief section 6, step 7) ----
    const tc = Date.now();
    const raws = await recordClips(page, { context, framesRoot, maxClips: MAX_CLIPS, log: (s) => log(s.trim()) });
    summary.clipMs = Date.now() - tc;
    summary.candidates = raws.length;

    // ---- motion off, then the stills exactly as capture-page.ts takes them (steps 8 to 11) ----
    await page.emulateMedia({ reducedMotion: 'reduce' }).catch(() => {});
    await page.addStyleTag({ content: ZERO_MOTION_CSS }).catch(() => {});
    await page
      .evaluate((refs) => {
        for (const ref of refs) {
          const el = document.querySelector(`[data-secref="${ref}"]`);
          if (!el) continue;
          for (const vid of Array.from(el.querySelectorAll('video'))) {
            try {
              vid.currentTime = 0;
            } catch {
              /* not seekable */
            }
          }
        }
      }, raws.filter((r) => r.verdict === 'recorded').map((r) => r.ref))
      .catch(() => {});
    await page.waitForTimeout(800);
    // A video the browser cannot decode: show its poster picture instead, or nothing (as capture-page.ts).
    await page
      .evaluate(() => {
        for (const vid of Array.from(document.querySelectorAll('video'))) {
          if (!vid.error) continue;
          if (vid.poster) {
            const img = document.createElement('img');
            img.src = vid.poster;
            img.alt = '';
            const cs = getComputedStyle(vid);
            img.style.cssText = `display:block;width:${cs.width};height:${cs.height};object-fit:cover;object-position:${cs.objectPosition || 'center'}`;
            vid.replaceWith(img);
          } else {
            vid.style.setProperty('visibility', 'hidden', 'important');
          }
        }
      })
      .catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await mkdir(path.join(pageDir, 'blocks'), { recursive: true });
    await page.evaluate(() => window.scrollTo(0, Math.min(document.documentElement.scrollHeight / 2, 3000))).catch(() => {});
    await page.waitForTimeout(250);
    let rescan = true;
    const entries = (store.get(pageDir) || []).filter((e) => e.viewport !== vp);
    for (const raw of raws) {
      const b = blockOf.get(raw.ref);
      const typeHint = b ? b.typeHint : 'unknown';
      const stem = `blocks/${vp[0]}-${String(raw.index).padStart(2, '0')}-${slugify(typeHint)}`;
      const entry: ClipEntry = { ref: raw.ref, index: raw.index, typeHint, motionHint: raw.motionHint, viewport: vp, why: raw.why, poster: null, verdict: raw.verdict, ...(raw.error ? { error: raw.error } : {}) };
      entries.push(entry);
      const loc = page.locator(`[data-secref="${raw.ref}"]`).first();
      try {
        await page.evaluate(hidePinned, { ref: raw.ref, rescan }).catch(() => 0);
        rescan = false;
        await loc.scrollIntoViewIfNeeded({ timeout: 10_000 });
        await page
          .waitForFunction(
            (ref) => {
              const el = document.querySelector(`[data-secref="${ref}"]`);
              if (!el) return true;
              return Array.from(el.querySelectorAll('img')).every((img) => {
                const r = img.getBoundingClientRect();
                return r.width < 40 || r.height < 40 || img.complete;
              });
            },
            raw.ref,
            { timeout: 3000 },
          )
          .catch(() => {});
        await page.waitForTimeout(120);
        const file = `${stem}.jpg`;
        await loc.screenshot({ path: path.join(pageDir, file), type: 'jpeg', quality: 88, animations: 'disabled', timeout: 30_000 });
        if ((await stat(path.join(pageDir, file)).catch(() => null))?.size) entry.poster = file;
      } catch (e) {
        entry.error = entry.error || `poster: ${(e as Error).message.split('\n')[0]}`;
      }
      if (raw.verdict === 'recorded') pending.push({ raw, entry, mp4: path.join(pageDir, `${stem}.mp4`) });
      else if (raw.error) summary.errors.push(`${raw.ref}: ${raw.error}`);
    }
    await page.evaluate(restorePinned).catch(() => {});
    store.set(pageDir, entries);
    return 'done';
  }
}

// ---- the review sheet ------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type SheetRow = { host: string; slug: string; dir: string; entry: ClipEntry };

async function reviewSheet(out: string): Promise<string[]> {
  const rows: SheetRow[] = [];
  for (const host of readdirSync(out, { withFileTypes: true })) {
    if (!host.isDirectory() || host.name.startsWith('_')) continue;
    for (const slug of readdirSync(path.join(out, host.name), { withFileTypes: true })) {
      const f = path.join(out, host.name, slug.name, 'clips.json');
      if (!slug.isDirectory() || !existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, 'utf8')) as { candidates: ClipEntry[] };
      for (const entry of j.candidates) if (entry.clip) rows.push({ host: host.name, slug: slug.name, dir: path.join(out, host.name, slug.name), entry });
    }
  }
  const reviewDir = path.join(out, '_review');
  await mkdir(path.join(reviewDir, 'frames'), { recursive: true });
  if (!rows.length) {
    console.log('no clips recorded, no review sheet');
    return [];
  }
  const html: string[] = [];
  let n = 0;
  for (const r of rows) {
    n++;
    const c = r.entry.clip!;
    const mp4 = path.join(r.dir, c.file);
    const frames: string[] = [];
    for (let k = 0; k < 4; k++) {
      const t = (c.durationMs / 1000) * (0.1 + k * 0.27);
      const name = `${String(n).padStart(2, '0')}-${k}.jpg`;
      const res = await runFfmpeg(['-y', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', '-vf', 'scale=330:-2', '-q:v', '4', path.join(reviewDir, 'frames', name)]);
      if (res.code === 0) frames.push(`<figure><figcaption>${t.toFixed(1)}s</figcaption><img src="frames/${name}"></figure>`);
    }
    const poster = r.entry.poster ? `<figure><figcaption>poster</figcaption><img src="${path.relative(reviewDir, path.join(r.dir, r.entry.poster)).split(path.sep).join('/')}"></figure>` : '<figure><figcaption>no poster</figcaption></figure>';
    const label = `<b>${esc(r.host)}</b><br>${esc(r.slug)}<br>${r.entry.viewport}<br><span class="k">${esc(c.kind)}</span> · ${r.entry.ref} ${esc(r.entry.typeHint)}<br>${(c.durationMs / 1000).toFixed(1)}s · ${Math.round(c.bytes / 1024)} KB<br>${c.width}x${c.height}`;
    html.push(`<section><div class="label">${label}</div>${poster}${frames.join('')}</section>`);
  }
  const files: string[] = [];
  const browser = await chromium.launch();
  const sheetPage = await browser.newPage({ viewport: { width: 1840, height: 900 } });
  const perSheet = 8;
  for (let i = 0; i < html.length; i += perSheet) {
    const k = i / perSheet;
    const file = path.join(reviewDir, k === 0 ? 'clips.jpg' : `clips-${k + 1}.jpg`);
    const htmlFile = file.replace(/\.jpg$/, '.html');
    await writeFile(
      htmlFile,
      `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:12px;background:#111;color:#ddd;font:13px/1.35 system-ui,sans-serif;width:1816px}
      section{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #333}
      .label{width:150px;flex:none;word-break:break-word} .k{color:#9cf}
      figure{margin:0;width:330px;flex:none} figcaption{color:#999;margin-bottom:3px}
      img{width:330px;max-height:260px;object-fit:contain;object-position:top;background:#222;display:block}
      </style>${html.slice(i, i + perSheet).join('')}`,
      'utf8',
    );
    await sheetPage.goto('file:///' + path.resolve(htmlFile).split(path.sep).join('/'));
    await sheetPage.waitForLoadState('networkidle').catch(() => {});
    await sheetPage.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 82 });
    files.push(file);
  }
  await browser.close();
  return files;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1] : '_tmp/clips-test';
  const mobile = argv.includes('--mobile');
  const dprIdx = argv.indexOf('--phone-dpr');
  const phoneDpr = dprIdx >= 0 ? Number(argv[dprIdx + 1]) : undefined;
  if (phoneDpr !== undefined && !(phoneDpr >= 1 && phoneDpr <= 4)) {
    console.error('--phone-dpr needs a number from 1 to 4');
    process.exit(1);
  }
  const urls = argv.filter((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1) && !(dprIdx >= 0 && i === dprIdx + 1));
  if (!urls.length) {
    console.error('usage: npm run clips-try -- <url> [<url> ...] [--mobile] [--phone-dpr 3] --out _tmp/clips-test');
    process.exit(1);
  }
  const probe = await runFfmpeg(['-version']);
  if (probe.code !== 0) {
    console.error('ffmpeg is needed on the PATH: ' + probe.stderr);
    process.exit(1);
  }
  await mkdir(out, { recursive: true });
  const polite = await Politeness.fromConfig();
  const browser = await chromium.launch({ headless: true });
  const store = new Map<string, ClipEntry[]>();
  const sums: ViewportSummary[] = [];
  // Entries of an earlier run of the same page are kept when only the other viewport is run again.
  for (const url of urls) {
    const u = new URL(url);
    const dir = path.join(out, u.hostname.replace(/^www\./, ''), pageSlug(u));
    const f = path.join(dir, 'clips.json');
    if (existsSync(f)) store.set(dir, (JSON.parse(readFileSync(f, 'utf8')) as { candidates: ClipEntry[] }).candidates);
  }
  try {
    for (const url of urls) {
      for (const vp of mobile ? (['desktop', 'mobile'] as const) : (['desktop'] as const)) {
        sums.push(await runViewport(browser, url, vp, out, polite, store, phoneDpr));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log('\nsummary');
  for (const s of sums) {
    console.log(`${s.host} ${s.viewport}: ${s.candidates} candidates, ${s.recorded} clips, clip step ${(s.clipMs / 1000).toFixed(1)}s + encode ${(s.encodeMs / 1000).toFixed(1)}s, page ${(s.totalMs / 1000).toFixed(1)}s${s.note ? ' ' + s.note : ''}${s.errors.length ? ' | ' + s.errors.join('; ') : ''}`);
  }
  // The temporary frames are ours and all gone by now (each clip's folder is deleted after its encode).
  await rm(path.join(out, '_frames'), { recursive: true, force: true }).catch(() => {});
  const sheets = await reviewSheet(out);
  for (const f of sheets) console.log('review sheet: ' + f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
