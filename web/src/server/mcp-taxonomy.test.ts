// npm test (web): the MCP server's copy of the taxonomy matches platform's, the source of truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mirror from "./mcp/taxonomy.ts";
import * as source from "../../../platform/src/taxonomy.ts";

test("the MCP taxonomy is an exact copy of platform/src/taxonomy.ts", () => {
  assert.equal(mirror.PROMPT_VERSION, source.PROMPT_VERSION);
  assert.deepEqual(mirror.GLOBAL_BLOCK_TYPES, source.GLOBAL_BLOCK_TYPES);
  assert.deepEqual(mirror.ECOMMERCE_BLOCK_TYPES, source.ECOMMERCE_BLOCK_TYPES);
  assert.deepEqual(mirror.BLOCK_TYPES, source.BLOCK_TYPES);
  assert.deepEqual(mirror.STYLE_TAGS, source.STYLE_TAGS);
  assert.deepEqual(mirror.INDUSTRIES, source.INDUSTRIES);
  assert.deepEqual(mirror.PAGE_ROLES, source.PAGE_ROLES);
});
