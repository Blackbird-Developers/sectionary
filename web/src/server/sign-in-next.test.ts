// npm test (web): where a sign-in goes afterwards, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSignIn, isAuthPage } from "../lib/sign-in.ts";

test("the sign-in pages are told apart from the rest of the site", () => {
  for (const path of ["/auth", "/auth/callback", "/auth/confirm?token_hash=x", "/auth/two-step", "/auth/google?next=/", "/auth#access_token=x", "/auth?x=1"]) {
    assert.equal(isAuthPage(path), true, path);
  }
  for (const path of ["/", "/account", "/authors", "/author/x", "/sites/auth.com", "/flows?auth=1", "/b/auth"]) {
    assert.equal(isAuthPage(path), false, path);
  }
});

test("signing in from a sign-in page goes home, from anywhere else back there", () => {
  assert.equal(afterSignIn("/auth/callback"), "/");
  assert.equal(afterSignIn("/auth/confirm?token_hash=x&type=email"), "/");
  assert.equal(afterSignIn("/sites/nike.com/flow?v=mobile"), "/sites/nike.com/flow?v=mobile");
  assert.equal(afterSignIn("/"), "/");
});
