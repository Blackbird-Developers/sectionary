// npm test (web): which clips play over their screenshot (playableClip in lib/blocks.ts), no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIP_MIN_COVER, playableClip, type Block } from "../lib/blocks.ts";

const clip = (rect?: { x: number; y: number; w: number; h: number }): NonNullable<Block["clip"]> =>
  ({ kind: "video", src: "https://cdn.test/a/blocks/d-05-section.mp4", w: 1080, h: 674, ms: 5005, ...(rect ? { rect } : {}) });

test("a clip that covers its whole block plays", () => {
  const c = clip({ x: 0, y: 0, w: 1440, h: 600 });
  assert.equal(playableClip({ h: 600, clip: c }), c);
});

test("a clip without a rect covers the whole block and plays", () => {
  const c = clip();
  assert.equal(playableClip({ h: 4000, clip: c }), c);
});

test("a clip cut at one screen over a taller block does not play (bonvelo.de, 26 Nov 2026)", () => {
  assert.equal(playableClip({ h: 1619, clip: clip({ x: 0, y: 0, w: 1440, h: 900 }) }), undefined);
  assert.equal(playableClip({ h: 4528, clip: clip({ x: 0, y: 0, w: 750, h: 900 }) }), undefined, "bensly.com's gallery");
  assert.equal(playableClip({ h: 2000, clip: clip({ x: 0, y: 600, w: 390, h: 844 }) }), undefined, "a screen recorded further down");
});

test("the line is 90% of the block's height", () => {
  assert.equal(CLIP_MIN_COVER, 0.9);
  const c = clip({ x: 0, y: 0, w: 1440, h: 900 });
  assert.equal(playableClip({ h: 1000, clip: c }), c, "900 of 1000 px");
  assert.equal(playableClip({ h: 1001, clip: c }), undefined, "900 of 1001 px");
});

test("no clip, nothing to play; a block of unknown height keeps its clip", () => {
  assert.equal(playableClip({ h: 900 }), undefined);
  const c = clip({ x: 0, y: 0, w: 1440, h: 900 });
  assert.equal(playableClip({ h: 0, clip: c }), c);
});
