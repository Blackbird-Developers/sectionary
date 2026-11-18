// Clips brief section 6.5: turn the recorded frames of one block into a small silent MP4.
// ffmpeg is a system tool (on the PATH); frames are JPEGs with timestamps, joined with the concat demuxer so
// a frame stays on screen for as long as it did in the page. A recording made in slow motion (time-warp.ts)
// has its timestamps divided by the slowdown, so the clip plays at the page's real speed.
import { spawn } from 'node:child_process';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * All encoder limits in one place. Ben asked for clips up to 1080 px wide on 17 Nov 2026 (the brief said 720
 * wide, CRF 28/32, 700 KB / 1.5 MB). Ladder: CRF 21; over softBytes CRF 24; still over softBytes CRF 27;
 * still over hardBytes discarded as "too-large".
 */
export const ENCODE_LIMITS = {
  fps: 30,
  maxWidth: 1080,
  crfs: [21, 24, 27],
  preset: 'slow',
  softBytes: 2.5 * 1024 * 1024,
  hardBytes: 4 * 1024 * 1024,
  /** A hard-cut slideshow can legitimately produce 2 frames (each is held for its real time). */
  minFrames: 2,
};

export type EncodeInput = {
  /** Folder holding the frame JPEGs. */
  framesDir: string;
  frames: { file: string; ts: number }[];
  /** The part of the page to keep, in CSS pixels of the viewport. */
  rect: { x: number; y: number; width: number; height: number };
  /** Viewport width in CSS pixels, to turn CSS pixels into frame pixels (the frames come in at 1 to 2 px per CSS px). */
  viewportWidth: number;
  /** Frames that show only part of the viewport (phone screenshot loop): that part in viewport CSS pixels. */
  frameRegion?: { x: number; y: number; width: number; height: number };
  /** How long the recording ran (ms, real time), so the last frame gets its share. */
  recordedMs: number;
  /**
   * How many times slower than real the page ran while recorded (time-warp.ts); the frame times are divided by
   * it, so the clip plays at the page's real speed. Absent or 1 = recorded in real time.
   */
  slowdown?: number;
  outFile: string;
};

export type EncodeResult = { ok: true; width: number; height: number; durationMs: number; bytes: number; crf: number } | { ok: false; error: string };

export function runFfmpeg(args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { cwd, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (e) => resolve({ code: -1, stderr: String(e.message) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Build the MP4. The frames folder is always deleted afterwards (kept only if the caller passes keepFrames). */
export async function encodeClip(input: EncodeInput, keepFrames = false): Promise<EncodeResult> {
  try {
    return await encodeInner(input);
  } catch (e) {
    return { ok: false, error: `encode: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    if (!keepFrames) await rm(input.framesDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function encodeInner(input: EncodeInput): Promise<EncodeResult> {
  const { frames } = input;
  if (frames.length < ENCODE_LIMITS.minFrames) return { ok: false, error: 'too-few-frames' };

  // The frame's real size tells how many frame pixels one CSS pixel is.
  const first = await sharp(path.join(input.framesDir, frames[0].file)).metadata();
  const fw = first.width || 0;
  const fh = first.height || 0;
  if (!fw || !fh) return { ok: false, error: 'bad-frame' };
  const reg = input.frameRegion || { x: 0, y: 0, width: input.viewportWidth, height: 0 };
  const scale = fw / reg.width;
  const cx = Math.min(fw - 2, Math.max(0, Math.round((input.rect.x - reg.x) * scale)));
  const cy = Math.min(fh - 2, Math.max(0, Math.round((input.rect.y - reg.y) * scale)));
  const cw = Math.max(2, Math.min(fw - cx, Math.round(input.rect.width * scale)));
  const ch = Math.max(2, Math.min(fh - cy, Math.round(input.rect.height * scale)));

  // Per-frame durations from the timestamps, in page time (a slowed recording is sped back up). The last frame
  // stays until the recording ended (at most 1 s).
  const k = input.slowdown && input.slowdown > 1 ? input.slowdown : 1;
  const t0 = frames[0].ts;
  const lines: string[] = [];
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    let d: number;
    if (i < frames.length - 1) d = (frames[i + 1].ts - frames[i].ts) / k;
    else d = Math.min(1, Math.max(1 / ENCODE_LIMITS.fps, (t0 + input.recordedMs / 1000 - frames[i].ts) / k));
    d = Math.max(0.001, d);
    total += d;
    lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(4)}`);
  }
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const listFile = 'list.txt';
  await writeFile(path.join(input.framesDir, listFile), lines.join('\n') + '\n', 'utf8');

  const attempt = async (targetWidth: number, crf: number): Promise<{ bytes: number; width: number; height: number } | { error: string }> => {
    const outW = even(Math.min(targetWidth, cw));
    const outH = even((ch * outW) / cw);
    const vf = `fps=${ENCODE_LIMITS.fps},crop=${cw}:${ch}:${cx}:${cy},scale=${outW}:${outH}:flags=lanczos,setsar=1,format=yuv420p`;
    // cwd is the frames folder, so the list holds bare file names (no quoting trouble with the apostrophe in the repo path).
    const r = await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf, '-an', '-c:v', 'libx264', '-preset', ENCODE_LIMITS.preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(input.outFile)], input.framesDir);
    if (r.code !== 0) return { error: `ffmpeg: ${r.stderr.trim().split('\n').pop() || 'failed'}` };
    const st = await stat(input.outFile).catch(() => null);
    if (!st || !st.size) return { error: 'ffmpeg: no output' };
    return { bytes: st.size, width: outW, height: outH };
  };

  let crf = ENCODE_LIMITS.crfs[0];
  let res = await attempt(ENCODE_LIMITS.maxWidth, crf);
  if ('error' in res) return { ok: false, error: res.error };
  for (let i = 1; i < ENCODE_LIMITS.crfs.length && res.bytes > ENCODE_LIMITS.softBytes; i++) {
    crf = ENCODE_LIMITS.crfs[i];
    res = await attempt(ENCODE_LIMITS.maxWidth, crf);
    if ('error' in res) return { ok: false, error: res.error };
  }
  if (res.bytes > ENCODE_LIMITS.hardBytes) {
    await rm(input.outFile, { force: true }).catch(() => {});
    return { ok: false, error: 'too-large' };
  }
  return { ok: true, width: res.width, height: res.height, durationMs: Math.round(total * 1000), bytes: res.bytes, crf };
}
