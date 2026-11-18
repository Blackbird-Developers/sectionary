// Boards acceptance: the Saved library and saved sites (migration 16), deterministic:
//
//   npm run boards:acceptance          # from web/
//
// A throwaway Postgres (PGlite, platform/src/local-db.ts) with every migration
// and the fixture manifests imported. The app's own route handlers are called
// in process with real Request objects, signed out (token boards, plan gates
// off) and signed in (a session cookie), so this exercises what the browser does:
//
//  1. migration 16 applied: boards.kind, board_items.site_host, block-or-site check;
//  2. a folder holds a block and a site; adding either twice changes nothing;
//  3. items read back with kind, host and the site's store; notes and removal take a host;
//  4. reordering takes block ids and hosts together;
//  5. an unknown site is 404, a bad host 400, and the database refuses a row with both or neither;
//  6. signed in, POST { kind: "library" } makes one Saved list and returns the same one after;
//  7. a token library claimed by an account that already has one becomes a folder;
//  8. share pages carry blocks only.
// Exit 0 when every check passes.

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { startLocalDb } from "../../platform/src/local-db.ts";

const run = promisify(execFile);
const here = import.meta.dirname;
const platform = resolve(here, "../../platform");

const local = await startLocalDb();
Object.assign(process.env, { DATABASE_URL: local.url, DATABASE_POOL_MAX: "1", PLAN_GATES: "off", AUTH_ENCRYPTION_KEY: "acceptance-key" });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

try {
  await run("npm", ["run", "-s", "import", "--", resolve(here, "../../fixtures/manifests")], { cwd: platform, env: process.env, shell: true, maxBuffer: 1 << 26 });
  const blockIds = (await local.db.query<{ id: string }>("SELECT id FROM blocks ORDER BY id LIMIT 2")).rows.map((r) => r.id);
  const host = (await local.db.query<{ host: string }>("SELECT host FROM sites ORDER BY host LIMIT 1")).rows[0]?.host;
  check("fixtures imported (two blocks and a site)", blockIds.length === 2 && Boolean(host));

  // ------------------------------------------------------------ 1. schema
  const cols = (await local.db.query<{ table_name: string; column_name: string; is_nullable: string }>(
    "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE (table_name='boards' AND column_name='kind') OR (table_name='board_items' AND column_name IN ('site_host','block_id'))",
  )).rows;
  check("migration 16: boards.kind, board_items.site_host, block_id optional",
    cols.some((c) => c.column_name === "kind") && cols.some((c) => c.column_name === "site_host") && cols.find((c) => c.column_name === "block_id")?.is_nullable === "YES");

  const accounts = await import("@/server/accounts");
  const boardsRoute = await import("@/app/api/boards/route");
  const boardRoute = await import("@/app/api/boards/[id]/route");
  const itemsRoute = await import("@/app/api/boards/[id]/items/route");
  const itemRoute = await import("@/app/api/boards/[id]/items/[blockId]/route");
  const boards = await import("@/server/boards");

  const base = "http://app.test";
  const req = (path: string, init: RequestInit & { cookie?: string; token?: string; json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.token) headers.set("x-board-token", init.token);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    return new Request(base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  };
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

  // ------------------------------------------------------------ 2. a folder with a block and a site
  let res = await boardsRoute.POST(req("/api/boards", { method: "POST", json: { name: "Acme refresh" } }));
  const folder = await res.json();
  const token = folder.token as string;
  const id = folder.board.id as string;
  check("signed out: a folder is made, kind folder", res.status === 201 && folder.board.kind === "folder", String(res.status));
  const add = (json: unknown) => itemsRoute.POST(req(`/api/boards/${id}/items`, { method: "POST", token, json }), ctx({ id }));
  await add({ blockId: blockIds[0] });
  res = await add({ host });
  let board = await res.json();
  check("a site is added by host", res.status === 200 && board.items.length === 2, `${res.status} ${JSON.stringify(board).slice(0, 200)}`);
  await add({ host: host!.toUpperCase() });
  await add({ blockId: blockIds[0] });
  board = await (await boardRoute.GET(req(`/api/boards/${id}`, { token }), ctx({ id }))).json();
  check("adding the same block or site again changes nothing", board.items.length === 2, String(board.items.length));

  // ------------------------------------------------------------ 3. read back
  const site = board.items.find((i: { kind: string }) => i.kind === "site");
  const block = board.items.find((i: { kind: string }) => i.kind === "block");
  check("site item: kind, host, store, no block", site?.host === host && site?.blockId === null && site?.site?.host === host && site?.block === null);
  check("block item: kind, blockId, block", block?.blockId === blockIds[0] && block?.block?.id === blockIds[0] && block?.host === null);
  res = await itemRoute.PATCH(req(`/api/boards/${id}/items/${host}`, { method: "PATCH", token, json: { note: "Look at the nav" } }), ctx({ id, blockId: host! }));
  board = await res.json();
  check("a site's note is set by host", board.items.find((i: { host: string }) => i.host === host)?.note === "Look at the nav");

  // ------------------------------------------------------------ 4. reorder across kinds
  res = await boardRoute.PATCH(req(`/api/boards/${id}`, { method: "PATCH", token, json: { order: [host, blockIds[0]] } }), ctx({ id }));
  board = await res.json();
  check("reorder takes hosts and block ids together", board.items[0]?.host === host && board.items[1]?.blockId === blockIds[0], JSON.stringify(board.items.map((i: { blockId: string; host: string }) => i.blockId ?? i.host)));

  // ------------------------------------------------------------ 5. refusals
  res = await add({ host: "no-such-store.example" });
  check("an unknown site is 404", res.status === 404, String(res.status));
  res = await add({ host: "not a host" });
  check("a bad host is 400", res.status === 400, String(res.status));
  const both = await local.db.query("INSERT INTO board_items (board_id, block_id, site_host) VALUES ($1, $2, $3)", [id, blockIds[1], host]).then(() => "accepted", () => "refused");
  const neither = await local.db.query("INSERT INTO board_items (board_id) VALUES ($1)", [id]).then(() => "accepted", () => "refused");
  check("the database refuses an item with both, or neither", both === "refused" && neither === "refused", `${both}/${neither}`);

  res = await itemRoute.DELETE(req(`/api/boards/${id}/items/${host}`, { method: "DELETE", token }), ctx({ id, blockId: host! }));
  board = await res.json();
  check("a site is removed by host", board.items.length === 1 && board.items[0].blockId === blockIds[0]);

  // ------------------------------------------------------------ 6. the Saved library, signed in
  const userId = crypto.randomUUID();
  await local.db.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  const user = await accounts.upsertUser(userId, "ana@studio.test");
  const session = await accounts.createSession(user.id, "acceptance");
  const cookie = `${accounts.SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", cookie, json: { kind: "library" } }));
  const lib1 = await res.json();
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", cookie, json: { kind: "library", name: "Another" } }));
  const lib2 = await res.json();
  check("signed in: one Saved list, made once and returned after", lib1.board.kind === "library" && lib1.board.name === "Saved" && lib2.board.id === lib1.board.id, `${lib1.board.id} ${lib2.board.id}`);
  const libId = lib1.board.id as string;
  await itemsRoute.POST(req(`/api/boards/${libId}/items`, { method: "POST", cookie, json: { host } }), ctx({ id: libId }));
  const listed = await (await boardsRoute.GET(req("/api/boards", { cookie }))).json();
  check("the library lists with its kind and its site", listed.items.some((b: { id: string; kind: string; items: { host: string }[] }) => b.id === libId && b.kind === "library" && b.items[0]?.host === host));

  // ------------------------------------------------------------ 7. claiming a second library
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", json: { kind: "library" } }));
  const tokenLib = await res.json();
  check("signed out: a token library is made", res.status === 201 && tokenLib.board.kind === "library");
  res = await boardRoute.GET(req(`/api/boards/${tokenLib.board.id}`, { cookie, token: tokenLib.token }), ctx({ id: tokenLib.board.id }));
  const claimed = await res.json();
  check("claimed by an account that has a library, it becomes a folder", claimed.kind === "folder" && claimed.name === "Saved before signing in", `${claimed.kind} ${claimed.name}`);

  // ------------------------------------------------------------ 8. share pages
  await add({ host });
  await boardRoute.PATCH(req(`/api/boards/${id}`, { method: "PATCH", token, json: { shared: true } }), ctx({ id }));
  const shared = await boards.sharedBoard(folder.board.shareSlug);
  check("a share page carries the blocks only", shared?.items.length === 1 && shared.items[0].block.id === blockIds[0], String(shared?.items.length));
} catch (error) {
  console.error(error);
  failed++;
} finally {
  await local.stop();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll boards checks passed");
process.exit(failed ? 1 : 0);
