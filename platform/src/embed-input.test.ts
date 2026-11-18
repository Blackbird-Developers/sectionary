// npm test: what a block is embedded from (SEC-31 brief section 7.4), with the
// real --styles fixture's outlines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Manifest } from "../../web/src/contracts/manifest.js";
import { embeddingInput, MAX_INPUT_CHARS, outlineText } from "./embed-input.js";

const stylesManifest = resolve(import.meta.dirname, "../../fixtures/manifests/myzoobox.com/products-zoologist-club-styles/manifest.json");
const plain = { ai_description: null, block_type: null, type_hint: "hero", headline: "Meet the box", text: "Every month  a new\nanimal." };

test("without outline or summary the input is what it always was, so nothing is embedded again", () => {
  assert.equal(embeddingInput(plain), "hero block. Meet the box. Every month a new animal.");
  const long = { ...plain, text: "word ".repeat(1000) };
  assert.equal(embeddingInput(long), `hero block. Meet the box. ${long.text.replace(/\s+/g, " ").trim()}`.slice(0, MAX_INPUT_CHARS));
  assert.equal(embeddingInput({ ...plain, ai_description: " A hero with a kit photo. ", block_type: "hero-banner" }), "hero banner block. A hero with a kit photo.");
});

test("headings and buttons from the outline, nested and repeated", () => {
  const text = outlineText([
    { type: "heading", level: 2, text: "Pick your  plan" },
    { type: "group", columns: 2, children: [{ type: "button", text: "Shop now" }, { type: "button", text: "Gift it" }, { type: "image", ratio: "1:1" }] },
    { type: "button", count: 3 },
  ]);
  assert.equal(text, `heading "Pick your plan"; 5 buttons "Shop now", "Gift it"`);
  assert.equal(outlineText(null), "");
  assert.equal(outlineText([{ type: "text", words: 9 }]), "");
});

test("outline and design summary keep their room when the copy is long", async () => {
  const manifest = JSON.parse(await readFile(stylesManifest, "utf8")) as Manifest;
  const block = manifest.blocks.find((b) => b.viewport === "desktop" && b.outline?.some((n) => JSON.stringify(n).includes("\"heading\"")))!;
  const summary = "Headings in Poppins 700, body in Poppins 16px. One accent (teal #258d8f) for buttons. Pill buttons, 48px tall.";
  const input = embeddingInput({ ...plain, text: "copy ".repeat(2000), outline: block.outline, design_summary: summary });
  assert.ok(input.length <= MAX_INPUT_CHARS);
  assert.match(input, /Contains (\d+ )?headings? "/);
  assert.ok(input.endsWith(`Store design: ${summary}`));
  assert.ok(input.startsWith("hero block. Meet the box. copy copy"));
});
