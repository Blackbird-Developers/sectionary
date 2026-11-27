// npm test (web): the order GET /api/sites?order=flow pages through is the one the Flows index sorts the whole list into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowCounts, flowOrder, flowSummariesFromApi, type FlowOutline } from "../lib/flows.ts";
import type { SiteSummary } from "../lib/site-profile.ts";

type Shop = { host: string; brand?: string; rank: number | null; pages: [type: string, shot: boolean][] };

const SHOPS: Shop[] = [
  { host: "nocart.test", brand: "No cart", rank: 5, pages: [["home", true], ["collection", true], ["product", true]] },
  { host: "full.test", brand: "Full", rank: 900, pages: [["home", true], ["collection", true], ["product", true], ["cart", true]] },
  { host: "top.test", brand: "Top", rank: 1, pages: [["home", true], ["collection", true], ["product", true]] },
  { host: "unranked.test", brand: "Unranked", rank: null, pages: [["home", true], ["collection", true], ["product", true]] },
  // Same rank as "No cart": the name decides.
  { host: "alpha.test", brand: "Alpha", rank: 5, pages: [["home", true], ["collection", true], ["product", true]] },
  // A product page captured but with nothing to show is a gap.
  { host: "blank.test", brand: "Blank product", rank: 2, pages: [["home", true], ["collection", true], ["product", false], ["cart", true]] },
  { host: "home.test", brand: "Home only", rank: 3, pages: [["home", true], ["blog", true], ["page", true]] },
  // Captured, but no step of the flow: still counted as captured, and last.
  { host: "blog.test", brand: "Blog only", rank: 4, pages: [["blog", true]] },
  // One brand at two addresses, alike in everything the order looks at: the host decides.
  { host: "twin.test.dk", brand: "Twin", rank: 7, pages: [["home", true], ["collection", true]] },
  { host: "twin.test.ca", brand: "Twin", rank: 7, pages: [["home", true], ["collection", true]] },
];

const summary = (s: Shop, n: number): SiteSummary => ({
  store: { n, host: s.host, brand: s.brand ?? s.host, rank: s.rank } as SiteSummary["store"],
  pages: s.pages.map(([type, shot], i) => ({
    url: `https://${s.host}/${type}-${i}`, type, title: null, capturedAt: "2026-11-01T00:00:00.000Z",
    desktop: shot ? `https://cdn.test/${s.host}/${type}.webp` : null, mobile: null, blocks: 3,
  })),
});

const outline = (s: Shop): FlowOutline => ({
  id: s.host, host: s.host, brand: s.brand ?? s.host, rank: s.rank,
  shown: [...new Set(s.pages.filter(([, shot]) => shot).map(([type]) => type))],
});

test("the paged order is the order the whole list sorts into", () => {
  const whole = flowSummariesFromApi(SHOPS.map(summary));
  const { ids, counts } = flowOrder(SHOPS.map(outline));
  assert.deepEqual(ids, whole.map((s) => s.store.host));
  assert.deepEqual(ids, ["full.test", "top.test", "alpha.test", "nocart.test", "unranked.test", "blank.test", "twin.test.ca", "twin.test.dk", "home.test", "blog.test"]);
  assert.deepEqual(counts, flowCounts(whole));
  assert.deepEqual(counts, { complete: 5, withCart: 1, captured: 10 });
});

test("the complete flows open the list, so both lists share their start", () => {
  const whole = flowSummariesFromApi(SHOPS.map(summary));
  const { ids, counts } = flowOrder(SHOPS.map(outline));
  const complete = new Set(whole.filter((s) => s.flow.complete).map((s) => s.store.host));
  assert.ok(ids.slice(0, counts.complete).every((id) => complete.has(id)));
  assert.ok(ids.slice(counts.complete).every((id) => !complete.has(id)));
});

test("the order does not depend on the order the stores come in", () => {
  const forward = flowOrder(SHOPS.map(outline));
  const backward = flowOrder([...SHOPS].reverse().map(outline));
  assert.deepEqual(backward, forward);
});

test("no stores, no flows", () => {
  assert.deepEqual(flowOrder([]), { ids: [], counts: { complete: 0, withCart: 0, captured: 0 } });
});
