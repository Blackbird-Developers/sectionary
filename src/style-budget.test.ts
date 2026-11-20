import { test } from "node:test";
import assert from "node:assert/strict";
import { fitStyleMetadata, STYLE_METADATA_BUDGET, type CapturedBlock } from "./capture-page.js";
import type { BlockStyleC, OutlineNodeC, PageStylesC } from "./style-script.js";
import type { BlockStyle, Manifest, ManifestBlock, OutlineNode } from "../web/src/contracts/manifest.js";

const manifest = await import("../fixtures/manifests/myzoobox.com/products-zoologist-club-styles/manifest.json", { with: { type: "json" } });
const sample = manifest.default as unknown as Manifest;
const styledBlock = () => sample.blocks.find((b) => b.viewport === "desktop" && b.style && b.outline) as
  ManifestBlock & { style: BlockStyle; outline: OutlineNode[] };

test("design metadata never exceeds 20 KB per viewport", () => {
  const page = structuredClone(sample.pageStyles!.desktop) as PageStylesC;
  const source = styledBlock();
  const blocks = Array.from({ length: 40 }, (_, index) => ({
    ...structuredClone(source), ref: `budget-${index}`, index,
    style: structuredClone(source.style) as BlockStyleC,
    outline: structuredClone(source.outline) as OutlineNodeC[],
  })) as CapturedBlock[];

  const bytes = fitStyleMetadata(page, blocks);
  assert.ok(bytes <= STYLE_METADATA_BUDGET, `${bytes} bytes exceeds ${STYLE_METADATA_BUDGET}`);
  assert.equal(page.partial, true, "trimming is disclosed on the page profile");
  assert.ok(blocks.some((b) => !b.outline || !b.style), "long pages shed low-priority detail");
});

test("metadata below the budget is left intact", () => {
  const page = structuredClone(sample.pageStyles!.desktop) as PageStylesC;
  const source = styledBlock();
  const blocks = [structuredClone(source)] as CapturedBlock[];
  const before = JSON.stringify({ page, blocks });
  assert.ok(fitStyleMetadata(page, blocks) < STYLE_METADATA_BUDGET);
  assert.equal(JSON.stringify({ page, blocks }), before);
});
