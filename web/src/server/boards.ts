import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Board, BoardItem, BoardPatch, SharedBoard } from "@/contracts/api";
import { database, pgArray } from "@/server/db";
import { blockColumns, blockJoins, toBlock, UUID } from "@/server/blocks";
import { toStore } from "@/server/sites";
import { userForRequest, type SessionUser } from "@/server/accounts";
import { accessOf, canUseBoards } from "@/server/plans";

// Who may touch a board. A board with an owner (owner_id, SEC-27) belongs to
// that signed-in account and nobody else. A board from before accounts belongs
// to whoever holds its edit token, returned once at creation and stored only as
// its SHA-256; the first signed-in request that carries the token claims it.
//
// Plan gate (SEC-28, with PLAN_GATES=on): creating boards and adding to them
// needs Pro or Team. Reading, sharing, reordering and deleting what you already
// have keeps working after a downgrade, so nobody loses a client link.

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

export class BoardError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function boardErrorResponse(error: unknown) {
  if (error instanceof BoardError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return null;
}

export type Actor = { token: string; user: SessionUser | null };

export const actorFrom = async (request: Request): Promise<Actor> =>
  ({ token: request.headers.get("x-board-token")?.trim() ?? "", user: await userForRequest(request) });

function requirePlan(actor: Actor) {
  if (canUseBoards(accessOf(actor.user))) return;
  if (!actor.user) throw new BoardError("Sign in to make boards", 401, "SIGN_IN_REQUIRED");
  throw new BoardError("Boards come with Pro and Team", 402, "PLAN_REQUIRED");
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** A site's host as saved: lower case, no scheme or path. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const hostOf = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** An item's key in the routes and in `order`: a block's id, or a site's host. Null when it is neither. */
function keyOf(key: string): { column: "block_id" | "site_host"; value: string } | null {
  if (UUID.test(key)) return { column: "block_id", value: key };
  const host = hostOf(key);
  return HOST.test(host) ? { column: "site_host", value: host } : null;
}

async function items(boardId: string): Promise<BoardItem[]> {
  const sql = database();
  // LEFT JOIN: a site item has no block, and a block item whose block left the library keeps its place.
  const rows = await sql`SELECT i.block_id, i.site_host, i.note, i.position, ${blockColumns(sql)}
    FROM board_items i LEFT JOIN (${blockJoins(sql)}) ON b.id=i.block_id
    WHERE i.board_id=${boardId} ORDER BY i.position, i.created_at`;
  const hosts = rows.map((r) => r.site_host as string | null).filter((h): h is string => Boolean(h));
  const sites = hosts.length ? await sql`SELECT * FROM sites WHERE host = ANY(${pgArray(hosts)}::text[])` : [];
  const storeByHost = new Map(sites.map((row) => [row.host as string, toStore(row)]));
  return rows.map((r): BoardItem => {
    const note = (r.note as string | null) ?? null, position = r.position as number;
    if (r.site_host) {
      const host = r.site_host as string;
      return { kind: "site", blockId: null, host, note, position, block: null, site: storeByHost.get(host) ?? null };
    }
    return { kind: "block", blockId: r.block_id as string, host: null, note, position, block: r.id ? toBlock(r) : null, site: null };
  });
}

async function load(id: string): Promise<Board> {
  const sql = database();
  const [b] = await sql`SELECT id, kind, name, description, share_slug, shared, created_at, updated_at FROM boards WHERE id=${id}`;
  if (!b) throw new BoardError("Board not found", 404, "NOT_FOUND");
  return { id: b.id, kind: b.kind === "library" ? "library" : "folder", name: b.name, description: b.description, shareSlug: b.share_slug, shared: b.shared,
    createdAt: iso(b.created_at), updatedAt: iso(b.updated_at), items: await items(b.id) };
}

/** Throws 404 for an unknown board and 403 for someone else's; token hashes are compared in constant time. */
async function authorize(id: string, actor: Actor) {
  if (!UUID.test(id)) throw new BoardError("Board not found", 404, "NOT_FOUND");
  const sql = database();
  const [row] = await sql`SELECT edit_token_hash, owner_id FROM boards WHERE id=${id}`;
  if (!row) throw new BoardError("Board not found", 404, "NOT_FOUND");
  if (row.owner_id) {
    if (row.owner_id === actor.user?.id) return;
    throw new BoardError("This board belongs to someone else", 403, "FORBIDDEN");
  }
  const expected = Buffer.from(row.edit_token_hash ?? "", "hex"), given = Buffer.from(hash(actor.token), "hex");
  if (!actor.token || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new BoardError("This board belongs to someone else", 403, "FORBIDDEN");
  }
  if (actor.user) {
    // One Saved list per account: a library made before signing in becomes a folder if the account already has one.
    await sql`UPDATE boards SET kind='folder', name='Saved before signing in' WHERE id=${id} AND owner_id IS NULL AND kind='library'
      AND EXISTS (SELECT 1 FROM boards o WHERE o.owner_id=${actor.user.id} AND o.kind='library')`;
    await sql`UPDATE boards SET owner_id=${actor.user.id}, created_by=coalesce(created_by, ${actor.user.id}) WHERE id=${id} AND owner_id IS NULL`;
  }
}

const touch = (id: string) => database()`UPDATE boards SET updated_at=now() WHERE id=${id}`;

export async function createBoard(actor: Actor, input: { name?: unknown; description?: unknown; kind?: unknown }) {
  const kind = input.kind === "library" ? "library" : "folder";
  const sql = database();
  const owner = actor.user?.id ?? null;
  // The Saved list: an account has one, so asking again returns it (the oldest, should two ever exist).
  // Reading it needs no plan, like any board you already have; making one does.
  if (kind === "library" && owner) {
    const [mine] = await sql`SELECT id FROM boards WHERE owner_id=${owner} AND kind='library' ORDER BY created_at LIMIT 1`;
    if (mine) return { board: await load(mine.id), token: "" };
  }
  requirePlan(actor);
  const name = kind === "library" ? clean(input.name, 120) || "Saved" : clean(input.name, 120);
  if (!name) throw new BoardError("A board needs a name", 400, "INVALID");
  const description = clean(input.description, 2000) || null;
  const token = randomBytes(24).toString("base64url");
  const [row] = await sql`INSERT INTO boards (kind, name, description, share_slug, edit_token_hash, owner_id, created_by)
    VALUES (${kind}, ${name}, ${description}, ${randomBytes(8).toString("base64url")}, ${hash(token)}, ${owner}, ${owner}) RETURNING id`;
  return { board: await load(row.id), token };
}

/** The signed-in account's boards, newest change first. */
export async function listBoards(actor: Actor): Promise<Board[]> {
  if (!actor.user) throw new BoardError("Sign in to see your boards", 401, "SIGN_IN_REQUIRED");
  const rows = await database()`SELECT id FROM boards WHERE owner_id=${actor.user.id} ORDER BY updated_at DESC LIMIT 200`;
  return Promise.all(rows.map((r) => load(r.id)));
}

export async function getBoard(id: string, actor: Actor) {
  await authorize(id, actor);
  return load(id);
}

export async function updateBoard(id: string, actor: Actor, patch: BoardPatch) {
  await authorize(id, actor);
  const sql = database();
  await sql.begin(async (tx) => {
    if (patch.name !== undefined) {
      const name = clean(patch.name, 120);
      if (!name) throw new BoardError("A board needs a name", 400, "INVALID");
      await tx`UPDATE boards SET name=${name} WHERE id=${id}`;
    }
    if (patch.description !== undefined) await tx`UPDATE boards SET description=${clean(patch.description, 2000) || null} WHERE id=${id}`;
    if (typeof patch.shared === "boolean") await tx`UPDATE boards SET shared=${patch.shared} WHERE id=${id}`;
    if (Array.isArray(patch.order)) {
      // Item keys: block ids and site hosts, compared as text against whichever the row holds.
      const order = patch.order.flatMap((x) => (typeof x === "string" && keyOf(x) ? [keyOf(x)!.value] : []));
      // Positions follow the given order; anything the client did not list keeps its place after them.
      await tx`UPDATE board_items i SET position=o.ord::int - 1, updated_at=now()
        FROM unnest(${pgArray(order)}::text[]) WITH ORDINALITY AS o(item_key, ord) WHERE i.board_id=${id} AND coalesce(i.block_id::text, i.site_host)=o.item_key`;
      await tx`UPDATE board_items SET position=${order.length} + position WHERE board_id=${id} AND NOT (coalesce(block_id::text, site_host) = ANY(${pgArray(order)}::text[]))`;
    }
    await tx`UPDATE boards SET updated_at=now() WHERE id=${id}`;
  });
  return load(id);
}

export async function deleteBoard(id: string, actor: Actor) {
  await authorize(id, actor);
  await database()`DELETE FROM boards WHERE id=${id}`;
}

export async function addItem(id: string, actor: Actor, input: { blockId?: unknown; host?: unknown; note?: unknown }) {
  await authorize(id, actor);
  requirePlan(actor);
  const sql = database();
  if (input.host !== undefined) {
    const host = hostOf(input.host);
    if (!HOST.test(host)) throw new BoardError("Unknown site", 400, "INVALID");
    const [site] = await sql`SELECT 1 FROM sites WHERE host=${host}`;
    if (!site) throw new BoardError("Unknown site", 404, "NOT_FOUND");
    await sql`INSERT INTO board_items (board_id, site_host, note, position, added_by)
      VALUES (${id}, ${host}, ${clean(input.note, 2000) || null}, (SELECT coalesce(max(position) + 1, 0) FROM board_items WHERE board_id=${id}), ${actor.user?.id ?? null})
      ON CONFLICT (board_id, site_host) DO NOTHING`;
    await touch(id);
    return load(id);
  }
  const blockId = typeof input.blockId === "string" ? input.blockId : "";
  if (!UUID.test(blockId)) throw new BoardError("Unknown block", 400, "INVALID");
  const [exists] = await sql`SELECT 1 FROM blocks WHERE id=${blockId}`;
  if (!exists) throw new BoardError("Unknown block", 404, "NOT_FOUND");
  await sql`INSERT INTO board_items (board_id, block_id, note, position, added_by)
    VALUES (${id}, ${blockId}, ${clean(input.note, 2000) || null}, (SELECT coalesce(max(position) + 1, 0) FROM board_items WHERE board_id=${id}), ${actor.user?.id ?? null})
    ON CONFLICT (board_id, block_id) DO NOTHING`;
  await touch(id);
  return load(id);
}

/** `key` is the item's: a block's id, or a site's host. */
export async function setItemNote(id: string, actor: Actor, key: string, note: unknown) {
  await authorize(id, actor);
  const item = keyOf(key);
  if (item) {
    const sql = database();
    await sql`UPDATE board_items SET note=${clean(note, 2000) || null}, updated_at=now() WHERE board_id=${id} AND ${sql(item.column)}=${item.value}`;
  }
  await touch(id);
  return load(id);
}

/** `key` is the item's: a block's id, or a site's host. */
export async function removeItem(id: string, actor: Actor, key: string) {
  await authorize(id, actor);
  const item = keyOf(key);
  if (item) {
    const sql = database();
    await sql`DELETE FROM board_items WHERE board_id=${id} AND ${sql(item.column)}=${item.value}`;
  }
  await touch(id);
  return load(id);
}

/** The public view of a shared board, or null when the slug is unknown or sharing is off. */
export async function sharedBoard(slug: string): Promise<SharedBoard | null> {
  const sql = database();
  const [b] = await sql`SELECT id, name, description, updated_at FROM boards WHERE share_slug=${slug} AND shared`;
  if (!b) return null;
  const list = await items(b.id);
  return { name: b.name, description: b.description, updatedAt: iso(b.updated_at),
    // Blocks only: a share page has no way to show a whole site yet.
    items: list.filter((i) => i.block).map((i) => ({ note: i.note, block: i.block! })) };
}
