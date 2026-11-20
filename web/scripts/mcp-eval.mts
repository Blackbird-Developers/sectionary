// The Blimp MCP evaluation (SEC-31 brief section 9.4), deterministic:
//
//   npm run mcp:eval          # from web/
//
// A throwaway Postgres (PGlite, platform/src/local-db.ts) with every migration,
// the fixture manifests imported by the real importer, then `profile-sites`
// and `benchmarks` run as they would after an import. A Pro account and an API
// key are made, and the official MCP client (@modelcontextprotocol/client)
// talks to the real /api/mcp route handler in process, through its auth, plan
// gate and rate limits.
//
// Ten questions an agent should be able to answer with the tools, each pinned
// to the fixtures: the expected answer is computed here from the manifests
// themselves, not from the server's code, so a wrong tool cannot agree with
// itself. A question passes when the answer can be read off the tool results.
// Scripted calls, not a model: this proves the data and the tools can answer,
// not that a given model will choose the right calls.
//
// Then the HTTP API of brief section 8 is checked against the same answers.
// `npm run mcp:eval -- --write-fixtures` also writes its responses to
// fixtures/api/ as the contract's examples.
//
// Exit 0 when every question and check passes.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startLocalDb } from "../../platform/src/local-db.ts";

const run = promisify(execFile);
const here = import.meta.dirname;
const platform = resolve(here, "../../platform");
const fixtures = resolve(here, "../../fixtures/manifests");

// ---------------------------------------------------------------- the fixtures, read directly

type Fixture = {
  site: { host: string; platform: string; apps: string[] };
  page: { url: string; type: string; capturedAt: string };
  viewports: Record<string, { fullHeight?: number } | undefined>;
  blocks: { viewport: string; typeHint: string; index: number }[];
  pageStyles?: Record<string, {
    headings: { levels: { level: number; count: number; size: number | null; family: string | null }[] };
    colour: { palette: { role: string; colour: string }[] };
    accessibility: { tapTargets: number | null };
    typography: { families: { family: string; share: number }[] };
  }>;
};
const index = JSON.parse(await readFile(join(fixtures, "index.json"), "utf8")) as { dir: string }[];
const manifests: Fixture[] = await Promise.all(index.map(async (e) => JSON.parse(await readFile(join(fixtures, e.dir, "manifest.json"), "utf8"))));
/** The latest capture of each page (the --styles capture of the myzoobox.com product page replaces the September one). */
const latest = [...manifests.reduce((m, f) => {
  const key = `${f.site.host}|${f.page.url}`, old = m.get(key);
  if (!old || old.page.capturedAt < f.page.capturedAt) m.set(key, f);
  return m;
}, new Map<string, Fixture>()).values()];
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byHost = (pages: Fixture[]) => [...pages.reduce((m, f) => m.set(f.site.host, [...(m.get(f.site.host) ?? []), f]), new Map<string, Fixture[]>()).values()];
const desktopBlocks = (f: Fixture) => f.blocks.filter((b) => b.viewport === "desktop");

const zooProduct = latest.find((f) => f.site.host === "myzoobox.com" && f.page.type === "product")!;
const zooHome = latest.find((f) => f.site.host === "myzoobox.com" && f.page.type === "home")!;
const zooStyles = zooProduct.pageStyles!;
const homes = latest.filter((f) => f.page.type === "home");
const REVIEW_APPS = ["Okendo", "Yotpo", "Judge.me", "Stamped", "Loox", "Reviews.io", "Junip", "Trustpilot", "Bazaarvoice", "PowerReviews"];
const zooLatestSite = manifests.filter((f) => f.site.host === "myzoobox.com").sort((a, b) => b.page.capturedAt.localeCompare(a.page.capturedAt))[0].site;

const expected = {
  q1: { font: zooStyles.desktop.typography.families[0].family, h1: zooStyles.desktop.headings.levels.find((l) => l.level === 1)!.size },
  q2: zooStyles.desktop.colour.palette.find((c) => c.role === "accent")!.colour,
  q3: REVIEW_APPS.filter((a) => zooLatestSite.apps.includes(a)).sort(),
  q4: { n: byHost(homes).length, median: median(byHost(homes).map((ps) => median(ps.map((p) => desktopBlocks(p).length)))) },
  q5: median(byHost(homes).map((ps) => median(ps.map((p) => Math.round(((p.viewports.desktop?.fullHeight ?? 0) / 900) * 10) / 10)))),
  q6: desktopBlocks(zooHome).length,
  q7: zooStyles.mobile.accessibility.tapTargets,
  q9: new Set(manifests.filter((f) => f.site.platform === "shopify").map((f) => f.site.host)).size,
  q10: new Set(latest.filter((f) => f.site.host !== "myzoobox.com" && desktopBlocks(f).some((b) => b.typeHint === "footer")).map((f) => f.site.host)).size,
};

// ---------------------------------------------------------------- the server

const local = await startLocalDb();
Object.assign(process.env, { DATABASE_URL: local.url, PLAN_GATES: "on", DATABASE_POOL_MAX: "1", S3_PUBLIC_BASE_URL: "https://cdn.test" });
const env = { ...process.env };
await run("npm", ["run", "-s", "import", "--", fixtures], { cwd: platform, env, shell: true, maxBuffer: 1 << 26 });
await run("npm", ["run", "-s", "profile-sites"], { cwd: platform, env, shell: true });
await run("npm", ["run", "-s", "benchmarks"], { cwd: platform, env, shell: true });

const accounts = await import("@/server/accounts");
const apiKeys = await import("@/server/api-keys");
const route = await import("@/app/api/mcp/route");
const userId = crypto.randomUUID();
await local.db.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
await accounts.upsertUser(userId, "eval@blimp.test");
await local.db.query("UPDATE users SET plan='pro', plan_status='active' WHERE id=$1", [userId]);
const { key } = await apiKeys.createApiKey(userId, "evaluation");

const client = new Client({ name: "blimp-eval", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://app.test/api/mcp"), {
  fetch: (url, init) => route.POST(new Request(url, init)),
  requestInit: { headers: { authorization: `Bearer ${key}` } },
}));

// Tool results are read as loose JSON on purpose: the questions check values, the output schemas check shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
type Out = { text: string; data: Data; isError: boolean };
const calls: string[] = [];
async function call(name: string, args: Record<string, unknown> = {}): Promise<Out> {
  const r = await client.callTool({ name, arguments: args });
  calls.push(JSON.stringify(r));
  const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
  if (r.isError && !(args as { expectError?: boolean }).expectError) throw new Error(`${name} answered an error: ${text.slice(0, 300)}`);
  return { text, data: (r.structuredContent ?? {}) as Data, isError: Boolean(r.isError) };
}

// ---------------------------------------------------------------- the questions

let failed = 0;
async function question(n: number, ask: string, want: unknown, answer: () => Promise<{ got: unknown; ok: boolean }>) {
  try {
    const { got, ok } = await answer();
    console.log(`${ok ? "PASS" : "FAIL"}  Q${n}. ${ask}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`FAIL  Q${n}. ${ask}\n      ${(e as Error).message}`);
    failed++;
  }
}

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log(`Tools: ${tools.join(", ")}\n`);

await question(1, "Which heading font does myzoobox.com use, and how big is its h1 on the product page at desktop width?", expected.q1, async () => {
  const design = await call("blimp_get_store_design", { host: "myzoobox.com" });
  const page = await call("blimp_get_page_profile", { host: "myzoobox.com", page_type: "product", viewport: "desktop" });
  const got = { font: design.data.design?.typography?.heading, h1: page.data.profiles?.desktop?.headings?.levels?.find((l: { level: number }) => l.level === 1)?.size };
  return { got, ok: got.font === expected.q1.font && got.h1 === expected.q1.h1 };
});

await question(2, "What is myzoobox.com's accent colour, and which colour family is it?", { colour: expected.q2, family: "teal" }, async () => {
  const design = await call("blimp_get_store_design", { host: "myzoobox.com" });
  const got = design.data.design?.accent;
  return { got, ok: got?.colour === expected.q2 && got?.bucket === "teal" };
});

await question(3, "Which product review apps does myzoobox.com run?", expected.q3, async () => {
  const store = await call("blimp_get_store", { host: "myzoobox.com" });
  const got = REVIEW_APPS.filter((a) => (store.data.apps as string[]).includes(a)).sort();
  return { got, ok: JSON.stringify(got) === JSON.stringify(expected.q3) && got.length > 0 };
});

await question(4, "Across all stores, what is the median number of sections on a home page at desktop?", expected.q4, async () => {
  const b = await call("blimp_get_benchmark", { industry: "all", page_type: "home", viewport: "desktop", metrics: ["blocks"] });
  const row = (b.data.items as { metric: string; n: number; p50: number }[]).find((i) => i.metric === "blocks");
  const got = { n: row?.n, median: row?.p50 };
  return { got, ok: got.n === expected.q4.n && got.median === expected.q4.median };
});

await question(5, "How long is a typical home page at desktop, in screens (viewport heights)?", expected.q5, async () => {
  const b = await call("blimp_get_benchmark", { page_type: "home", metrics: ["screens"] });
  const got = (b.data.items as { metric: string; p50: number }[]).find((i) => i.metric === "screens")?.p50;
  return { got, ok: got !== undefined && Math.abs(got - expected.q5) < 0.051 };
});

await question(6, "How many sections does myzoobox.com's home page have at desktop?", expected.q6, async () => {
  const flow = await call("blimp_get_store_flow", { host: "myzoobox.com", viewport: "desktop" });
  const home = (flow.data.steps as { page_type: string; blocks: unknown[]; more_blocks: number }[]).find((s) => s.page_type === "home");
  const got = home ? home.blocks.length + home.more_blocks : null;
  return { got, ok: got === expected.q6 && (home?.blocks.length ?? 99) <= 20 };
});

await question(7, "On phone, what share of buttons and links on myzoobox.com's product page are at least 44px tall?", expected.q7, async () => {
  const page = await call("blimp_get_page_profile", { host: "myzoobox.com", page_type: "product", viewport: "mobile" });
  const got = page.data.profiles?.mobile?.accessibility?.tapTargets;
  return { got, ok: got === expected.q7 };
});

await question(8, "Is there a benchmark for body text size on product pages across all stores? (Only one store has design metadata.)", "refused, with n", async () => {
  const b = await call("blimp_get_benchmark", { page_type: "product", metrics: ["body-size"] });
  const got = { items: b.data.items?.length, not_published: b.data.not_published, note: b.data.note };
  return { got, ok: b.data.items?.length === 0 && b.data.not_published?.includes("body-size") && /fewer than 10|not enough/i.test(String(b.data.note)) && !b.isError };
});

await question(9, "How many stores in the library run on Shopify?", expected.q9, async () => {
  const tax = await call("blimp_list_taxonomy");
  const stores = await call("blimp_search_stores", { platform: "shopify", limit: 20 });
  const got = { taxonomy: (tax.data.platforms as { value: string; stores: number }[]).find((p) => p.value === "shopify")?.stores, search: stores.data.total };
  return { got, ok: got.taxonomy === expected.q9 && got.search === expected.q9 };
});

await question(10, "What is similar to myzoobox.com's footer (desktop) in other stores?", { footersFromOtherStores: expected.q10 }, async () => {
  const flow = await call("blimp_get_store_flow", { host: "myzoobox.com", viewport: "desktop" });
  const homeStep = (flow.data.steps as { page_type: string; blocks: { id: string; type_hint: string }[] }[]).find((s) => s.page_type === "home")!;
  // The footer is the 21st block, past the flow's 20; find it by search instead.
  const footer = homeStep.blocks.find((b) => b.type_hint === "footer")
    ?? (await call("blimp_search_blocks", { store: "myzoobox.com", block_type: "footer", viewport: "desktop", page_type: "home" })).data.items[0];
  const sim = await call("blimp_find_similar_blocks", { id: footer.id, limit: 20 });
  const items = sim.data.items as { store: string; type_hint: string; viewport: string }[];
  const got = { basis: sim.data.basis, count: items.length, allFooters: items.every((i) => i.type_hint === "footer"), distinctStores: new Set(items.map((i) => i.store)).size };
  return { got, ok: got.count === expected.q10 && got.allFooters && got.distinctStores === got.count && items.every((i) => i.store !== "myzoobox.com" && i.viewport === "desktop") };
});

// ---------------------------------------------------------------- response rules (brief section 9.3)

const all = calls.join("\n");
const leaks = ["\"classes\"", "\"tag\"", "\"elementId\"", "\"html\"", "\"css\"", "<div", "class="].filter((s) => all.includes(s));
console.log(`\n${leaks.length ? "FAIL" : "PASS"}  no source in any of ${calls.length} responses${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
if (leaks.length) failed++;
const v2 = ["blimp_find_similar_blocks", "blimp_get_benchmark", "blimp_get_page_profile", "blimp_get_store_design", "blimp_get_store_flow"];
const missing = v2.filter((t) => !tools.includes(t));
console.log(`${missing.length ? "FAIL" : "PASS"}  the five v2 tools are listed${missing.length ? `; missing ${missing.join(", ")}` : ""}`);
if (missing.length) failed++;

// ---------------------------------------------------------------- the HTTP API serves the same numbers (brief section 8)

const api = {
  block: await import("@/app/api/blocks/[id]/route"),
  design: await import("@/app/api/sites/[host]/design/route"),
  benchmarks: await import("@/app/api/benchmarks/route"),
  taxonomy: await import("@/app/api/taxonomy/route"),
};
const session = await accounts.createSession(userId, "mcp-eval");
const signedIn = { cookie: `${accounts.SESSION_COOKIE}=${session.token}` };
const get = async <P extends object>(handler: { GET: (r: Request, c: { params: Promise<P> }) => Promise<Response> }, path: string,
  params = {} as P, headers: Record<string, string> = {}) => {
  const res = await handler.GET(new Request(`http://app.test${path}`, { headers }), { params: Promise.resolve(params) });
  const body = await res.json() as Data;
  calls.push(JSON.stringify(body));
  return { status: res.status, cache: res.headers.get("cache-control") ?? "", body };
};
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

const mcpDesign = (await call("blimp_get_store_design", { host: "myzoobox.com" })).data;
const pub = await get(api.design, "/api/sites/myzoobox.com/design", { host: "myzoobox.com" });
const own = await get(api.design, "/api/sites/myzoobox.com/design", { host: "myzoobox.com" }, signedIn);
console.log("");
check("/api/sites/[host]/design: the MCP's summary, fonts and accent",
  pub.body.design?.summary === mcpDesign.design?.summary && pub.body.design?.typography?.heading === expected.q1.font && pub.body.design?.accent?.colour === expected.q2);
check("/api/sites/[host]/design: accessibility only when signed in, never cached then",
  pub.body.design?.accessibility === null && Boolean(pub.body.accessibilityNote) && pub.cache.startsWith("public") &&
  own.body.design?.accessibility !== null && own.body.design?.accessibility !== undefined && own.cache.includes("no-store"));
check("/api/sites/[host]/design: unknown store is 404", (await get(api.design, "/api/sites/nope.example/design", { host: "nope.example" })).status === 404);

const bench = await get(api.benchmarks, "/api/benchmarks?page=home&metric=blocks");
const blocksRow = (bench.body.items as { metric: string; n: number; p50: number }[]).find((i) => i.metric === "blocks");
check("/api/benchmarks: the MCP's home page median, with n", blocksRow?.n === expected.q4.n && blocksRow?.p50 === expected.q4.median && bench.body.minN === 10);
check("/api/benchmarks: an unknown metric is 400 and names the valid ones",
  (await get(api.benchmarks, "/api/benchmarks?metric=fonts")).status === 400);

const tax = await get(api.taxonomy, "/api/taxonomy");
const mcpTax = (await call("blimp_list_taxonomy")).data;
check("/api/taxonomy: the MCP's lists", tax.body.blockTypes?.length === mcpTax.block_types?.length && tax.body.blockTypes.length > 40 &&
  tax.body.platforms?.find((p: { value: string }) => p.value === "shopify")?.stores === expected.q9);

const styled = (await call("blimp_search_blocks", { store: "myzoobox.com", page_type: "product", viewport: "desktop", limit: 1 })).data.items[0];
const selectedDetail = (await call("blimp_get_block", { id: styled.id, include: ["outline"] })).data;
check("blimp_get_block: include returns only the requested optional detail", Array.isArray(selectedDetail.outline) &&
  !("style" in selectedDetail) && !("text" in selectedDetail) && !("image_url" in selectedDetail));
const detail = await get(api.block, `/api/blocks/${styled.id}`, { id: styled.id });
check("/api/blocks/[id]: the Block plus style and outline", detail.body.id === styled.id && typeof detail.body.src === "string" &&
  detail.body.style !== null && Array.isArray(detail.body.outline) && "blockType" in detail.body && "taggerVersion" in detail.body);

// `--write-fixtures` keeps these real responses as the contract's examples (docs/CONTRACTS.md).
if (process.argv.includes("--write-fixtures")) {
  const { writeFile } = await import("node:fs/promises");
  const out = resolve(here, "../../fixtures/api");
  const write = (name: string, body: unknown) => writeFile(join(out, name), `${JSON.stringify(body, null, 2)}\n`);
  await write("block.detail.json", detail.body);
  await write("site.design.json", pub.body);
  await write("benchmarks.json", (await get(api.benchmarks, "/api/benchmarks?page=home")).body);
  await write("taxonomy.json", tax.body);
  console.log("Wrote fixtures/api/block.detail.json, site.design.json, benchmarks.json, taxonomy.json");
}

const allCalls = calls.join("\n");
const apiLeaks = ["\"classes\"", "\"tag\"", "\"elementId\"", "\"html\"", "\"css\"", "<div", "class="].filter((s) => allCalls.includes(s));
check(`no source in any API response either (${calls.length} responses in all)`, !apiLeaks.length, apiLeaks.join(", "));

// ---------------------------------------------------------------- plans: Free, trial and Pro over the same route

/** An account with a key and its own MCP client. `trial` days left: 0 = Free (trial over), null = paid Pro. */
async function accountClient(email: string, trialDays: number | null) {
  const id = crypto.randomUUID();
  await local.db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  await accounts.upsertUser(id, email);
  if (trialDays === null) await local.db.query("UPDATE users SET plan='pro', plan_status='active' WHERE id=$1", [id]);
  else await local.db.query("UPDATE users SET plan='free', trial_ends_at=now() + make_interval(days => $2) WHERE id=$1", [id, trialDays === 0 ? -1 : trialDays]);
  const { key: k } = await apiKeys.createApiKey(id, "evaluation");
  const c = new Client({ name: "blimp-eval-plans", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL("http://app.test/api/mcp"), {
    fetch: (url, init) => route.POST(new Request(url, init)),
    requestInit: { headers: { authorization: `Bearer ${k}` } },
  }));
  return c;
}
const textOf = (r: { content: unknown }) => (r.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");

console.log("");
const LIBRARY_CALLS: [string, Record<string, unknown>][] = [
  ["blimp_search_blocks", { query: "footer" }], ["blimp_get_block", { id: styled.id }], ["blimp_search_stores", {}],
  ["blimp_get_store", { host: "myzoobox.com" }], ["blimp_get_store_design", { host: "myzoobox.com" }],
  ["blimp_get_page_profile", { host: "myzoobox.com", page_type: "product" }], ["blimp_get_store_flow", { host: "myzoobox.com" }],
  ["blimp_get_benchmark", { page_type: "home" }], ["blimp_find_similar_blocks", { id: styled.id }],
];

const freeClient = await accountClient("free@blimp.test", 0);
const freeTools = (await freeClient.listTools()).tools.map((t) => t.name);
check("Free: connects and lists all ten tools (no 402)", freeTools.length === tools.length, `${freeTools.length} tools`);
const freeTax = await freeClient.callTool({ name: "blimp_list_taxonomy", arguments: {} });
check("Free: blimp_list_taxonomy answers", !freeTax.isError && Boolean(freeTax.structuredContent), textOf(freeTax).slice(0, 200));
const freeAnswers = await Promise.all(LIBRARY_CALLS.map(async ([name, args]) => ({ name, r: await freeClient.callTool({ name, arguments: args }) })));
const leaked = freeAnswers.filter(({ r }) => !r.isError || r.structuredContent !== undefined || !/needs Blimp Pro/.test(textOf(r)) || !textOf(r).includes("/account"));
check(`Free: the ${LIBRARY_CALLS.length} library tools answer with how to upgrade, and no data`, !leaked.length, leaked.map((l) => l.name).join(", "));
const freeLeaks = freeAnswers.map(({ r }) => textOf(r)).join("\n");
check("Free: no store, block or design value in any answer", !/myzoobox|footer|#[0-9a-f]{6}/i.test(freeLeaks), freeLeaks.slice(0, 200));
await freeClient.close();

const trialClient = await accountClient("trial@blimp.test", 3);
const trialAnswer = await trialClient.callTool({ name: "blimp_search_blocks", arguments: { query: "footer" } });
check("Trial: library tools answer, with when the trial ends", !trialAnswer.isError && Boolean(trialAnswer.structuredContent) && /trial: ends/.test(textOf(trialAnswer)), textOf(trialAnswer).slice(-200));
await trialClient.close();

const proAnswer = await client.callTool({ name: "blimp_search_blocks", arguments: { query: "footer" } });
check("Pro: library tools answer, with no trial or upgrade note", !proAnswer.isError && !/trial|needs Blimp Pro/i.test(textOf(proAnswer)), textOf(proAnswer).slice(-200));

await client.close();
await local.stop();
console.log(`\n${failed ? `${failed} failed` : "All passed"}.`);
process.exit(failed ? 1 : 0);
