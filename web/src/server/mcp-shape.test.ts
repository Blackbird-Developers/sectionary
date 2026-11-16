// npm test (web): the MCP server's response helpers, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, closest, decodeCursor, encodeCursor, unknownValue, withoutSource } from "./mcp/shape.ts";
import { BLOCK_TYPES } from "./mcp/taxonomy.ts";

test("cursors round-trip and foreign ones are refused", () => {
  assert.equal(decodeCursor(encodeCursor(40)), 40);
  assert.equal(decodeCursor(undefined), 0);
  assert.equal(decodeCursor(""), 0);
  assert.equal(decodeCursor("40"), null);
  assert.equal(decodeCursor(Buffer.from("o:-1").toString("base64url")), null);
});

test("an unknown block type names the close ones (brief section 9.3)", () => {
  assert.deepEqual(closest("reviews", BLOCK_TYPES).slice(0, 1), ["product-reviews"]);
  assert.ok(closest("testimonial", BLOCK_TYPES).includes("testimonials"));
  assert.ok(closest("newsleter", BLOCK_TYPES).includes("newsletter"));
  assert.deepEqual(closest("zzzzzz", BLOCK_TYPES), []);
  assert.equal(
    unknownValue("block_type", "reviews", ["product-reviews", "testimonials", "hero"]),
    "Unknown block_type 'reviews'. Closest: 'product-reviews'. Call blimp_list_taxonomy for the full list.",
  );
});

test("no source reaches a response: tag, classes and markup keys go, at any depth", () => {
  const out = withoutSource({ id: "b1", tag: "section", classes: "hero hero--big", nested: [{ html: "<div>", headline: "Hi" }], when: new Date(0) });
  assert.deepEqual(Object.keys(out), ["id", "nested", "when"]);
  assert.deepEqual(out.nested, [{ headline: "Hi" }]);
  assert.ok(out.when instanceof Date);
});

test("text is clipped on a word boundary", () => {
  assert.equal(clip("one two three four", 9), "one two…");
  assert.equal(clip("  short  ", 400), "short");
  assert.equal(clip(null, 10), null);
});
