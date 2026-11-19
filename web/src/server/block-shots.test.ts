// npm test (web): the files a block's screenshot is drawn from, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockAt, blockTop, captureFiles, shotsOf, type Block } from "../lib/blocks.ts";

const block = (over: Partial<Block> & { slices?: { src: string; w: number; h: number }[] }): Block =>
  ({ id: "b", host: "ulta.com", viewport: "desktop", w: 1440, h: 900, src: "https://cdn.test/ulta.com/home/blocks/d-01-hero.webp", ...over }) as Block;

test("a screenshot in one file is drawn from that file, at the block's shape", () => {
  assert.deepEqual(shotsOf(block({})), [{ src: "https://cdn.test/ulta.com/home/blocks/d-01-hero.webp", w: 1440, h: 900 }]);
});

test("a sliced screenshot is every slice in order, not the first one stretched", () => {
  // 10,708 CSS pixels tall at 2x is 21,416 rows: two full slices and the rest.
  const shots = shotsOf(block({ w: 1376, h: 10708, src: "https://cdn.test/ulta.com/shop/blocks/d-04-product_s000.webp" }));
  assert.deepEqual(shots.map((s) => s.src.split("/").pop()), ["d-04-product_s000.webp", "d-04-product_s001.webp", "d-04-product_s002.webp"]);
  assert.deepEqual(shots.map((s) => [s.w, s.h]), [[2752, 8192], [2752, 8192], [2752, 5032]]);
});

test("a sliced screenshot that fits one slice stays one file", () => {
  assert.equal(shotsOf(block({ w: 358, h: 862, viewport: "mobile", src: "/x/blocks/m-09-product_s000.webp" })).length, 1);
});

test("slices the API lists are used as sent", () => {
  const slices = [{ src: "/a_s000.webp", w: 716, h: 8192 }, { src: "/a_s001.webp", w: 716, h: 8192 }, { src: "/a_s002.webp", w: 716, h: 120 }];
  // The recorded height is far short of the file here, which is why the list wins over working it out.
  assert.deepEqual(shotsOf(block({ w: 358, h: 862, src: "/a_s000.webp", slices })), slices);
});

test("a page's full-size screenshot is found from its thumbnail", () => {
  const files = captureFiles("https://cdn.test/ulta.com/home/desktop_thumb.webp");
  assert.equal(files?.whole, "https://cdn.test/ulta.com/home/desktop.webp");
  assert.equal(files?.slice(2), "https://cdn.test/ulta.com/home/desktop_s002.webp");
  assert.equal(captureFiles("/sample/home/desktop.jpg"), null);
});

test("a click on the page opens the block at that height", () => {
  // Measured: a gallery and a buy box side by side under the header, then the footer.
  const measured = [
    block({ id: "header", h: 100, top: 0 } as Partial<Block>),
    block({ id: "gallery", h: 1500, top: 100 } as Partial<Block>),
    block({ id: "buy", h: 600, top: 100 } as Partial<Block>),
    block({ id: "footer", h: 400, top: 1600 } as Partial<Block>),
  ];
  assert.equal(blockAt(measured, 50, 2000), 0);
  assert.equal(blockAt(measured, 300, 2000), 1);
  assert.equal(blockAt(measured, 1700, 2000), 3);
  assert.equal(blockAt(measured, 5000, 2000), 3);
  assert.equal(blockTop(measured, 3, 2000), 1600);
  // Not measured: the blocks one after another, scaled to the page (2,600 of blocks on a 2,000 page).
  const plain = measured.map((b) => ({ ...b, top: undefined }) as Block);
  assert.equal(blockAt(plain, 50, 2000), 0);
  assert.equal(blockAt(plain, 1900, 2000), 3);
  assert.equal(Math.round(blockTop(plain, 3, 2000)), Math.round((2200 / 2600) * 2000));
  assert.equal(blockAt([], 10, 2000), -1);
});
