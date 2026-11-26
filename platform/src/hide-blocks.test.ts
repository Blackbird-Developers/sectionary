// npm test: which blocks npm run hide-blocks hides, from a review's answers (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { idsIn, parseAnswers, planHides, reasonOf, textArray, uuidArray } from "./hide-blocks.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

test("answers: one JSON object a line; lines without a block id and an action are counted, not thrown", () => {
  const text = [
    JSON.stringify({ id: A, action: "hide", issue: "just-image", score: 2, reason: "lone photo" }),
    "",
    "not json",
    JSON.stringify({ id: "not-a-uuid", action: "hide" }),
    JSON.stringify({ id: B, score: 3 }),
    JSON.stringify({ id: C, action: "keep", score: 4 }),
  ].join("\n");
  const { answers, invalid } = parseAnswers(text);
  assert.deepEqual(answers.map((a) => a.id), [A, C]);
  assert.equal(invalid, 3);
});

test("only hide answers are hidden, the last answer for a block wins, and --except ids are left alone", () => {
  const answers = [
    { id: A, action: "hide", issue: "text-only", score: 2, reason: "bare line" },
    { id: B, action: "hide", issue: "logo-strip", score: 1, reason: "logo only" },
    { id: C, action: "hide", issue: "just-image", score: 2, reason: "photo" },
    { id: C, action: "keep", score: 3 },
    { id: A.toUpperCase(), action: "hide", issue: "tiny-fragment", score: 1, reason: "sliver" },
  ];
  const plan = planHides(answers, new Set([B]));
  assert.deepEqual(plan.hide.map((h) => h.id), [A]);
  assert.equal(plan.hide[0].reason, "review: tiny-fragment (1/5): sliver");
  assert.equal(plan.excepted, 1);
  assert.equal(plan.notHide, 1);
});

test("ids are read out of any text, such as the review sheet's copied ticks", () => {
  const ticks = `Blocks I think are wrong:\n${A} (hide, store.com)\n${B.toUpperCase()} (retake, other.com)\n${A} again`;
  assert.deepEqual([...idsIn(ticks)], [A, B]);
});

test("a reason is short, on one line and says it came from a review", () => {
  const r = reasonOf({ id: A, action: "hide", issue: "text-only", score: 2, reason: `two\nlines ${"x".repeat(400)}` });
  assert.ok(r.startsWith("review: text-only (2/5): two lines "));
  assert.equal(r.length, 300);
  assert.equal(reasonOf({ id: A, action: "hide" }), "review: hide");
});

test("array literals: uuids as they are, text quoted with quotes and backslashes escaped", () => {
  assert.equal(uuidArray([A, B]), `{${A},${B}}`);
  assert.equal(textArray(['say "hi"', "a\\b", "x,y"]), '{"say \\"hi\\"","a\\\\b","x,y"}');
});
