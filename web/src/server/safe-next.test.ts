// npm test (web): where sign-in may send someone afterwards (safeNext in lib/safe-next.ts), no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../lib/safe-next.ts";

test("paths on this site are kept, with their query and hash", () => {
  assert.equal(safeNext("/account"), "/account");
  assert.equal(safeNext("/sites/allbirds.com"), "/sites/allbirds.com");
  assert.equal(safeNext("/?open=abc&block=hero#top"), "/?open=abc&block=hero#top");
  assert.equal(safeNext("/auth/two-step"), "/auth/two-step");
});

test("other sites are refused", () => {
  for (const next of ["//evil.com", "https://evil.com", "http://evil.com/account", "evil.com", "javascript:alert(1)", "/\\evil.com", "\\\\evil.com"]) {
    assert.equal(safeNext(next), "/account", next);
  }
});

test("tabs, newlines and other hidden characters are refused (browsers strip them, turning /\\t/ into //)", () => {
  for (const next of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\r\n/evil.com", "/\u0000/evil.com", "/\u007f/evil.com", "/account\t"]) {
    assert.equal(safeNext(next), "/account", JSON.stringify(next));
  }
});

test("a path that resolves to // is refused", () => {
  assert.equal(safeNext("/.//evil.com"), "/account");
  assert.equal(safeNext("/a/..//evil.com"), "/account");
});

test("nothing usable falls back", () => {
  for (const next of [undefined, null, 42, {}, "", "account"]) assert.equal(safeNext(next), "/account");
  assert.equal(safeNext("//evil.com", "/"), "/");
});

test("the path stays on this site the way a browser resolves it", () => {
  for (const next of ["/x", "/%09/evil.com", "/..%2f..%2fevil.com", "/@evil.com", "/;//evil.com"]) {
    const kept = safeNext(next);
    assert.equal(new URL(kept, "https://blimp.test").origin, "https://blimp.test", next);
  }
});
