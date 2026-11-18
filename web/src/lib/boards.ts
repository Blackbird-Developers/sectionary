"use client";

import type { Board, BoardCreated, BoardItem, BoardPatch } from "@/contracts/api";
import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";
import { API_MODE } from "@/lib/data-source";

// Boards on the client. Two stores behind one interface:
//
// - API mode (blocks from /api/blocks): boards live in the database and the
//   share link (/b/<slug>) is live: edits show up for the client on reload.
//   Signed in, boards belong to the account (the session cookie goes with
//   every request). Signed out, this browser keeps each board's edit token;
//   the first signed-in visit claims those boards for the account.
// - Sample mode (the committed sample JSON, as on the preview deploy): boards
//   live in this browser, and the share link (/share#...) carries the whole
//   board, so it works with no database. It is a snapshot: copy it again after
//   changes.

/** What can be saved: a block (shown as Web or Mobile by its viewport) or a whole site. */
export type SavedTarget = { kind: "block"; block: Block } | { kind: "site"; store: Store };

/** The key an item goes by in the store and the routes: a block's id, or a site's host. */
export const targetKey = (t: SavedTarget) => (t.kind === "block" ? t.block.id : t.store.host);
export const itemKey = (i: BoardItem) => i.blockId ?? i.host ?? "";
export const isSiteItem = (i: BoardItem) => i.kind === "site" || (!i.blockId && Boolean(i.host));
export const isFolder = (b: { kind?: Board["kind"] }) => b.kind !== "library";

/** The three tabs on Boards: Web and Mobile blocks, and whole sites. */
export type SavedTab = "web" | "mobile" | "sites";
export const tabOf = (i: BoardItem): SavedTab | null =>
  isSiteItem(i) ? "sites" : i.block ? (i.block.viewport === "mobile" ? "mobile" : "web") : null;

export type BoardSummary = {
  id: string;
  kind: "folder" | "library";
  name: string;
  /** Block ids only (what the older list and the wall read). */
  blockIds: string[];
  /** Every item's key: block ids and site hosts. */
  keys: string[];
  cover: Block | null;
  /** The first few items that can be drawn, for a folder's cover. */
  covers: BoardItem[];
  counts: Record<SavedTab, number>;
  /** Every item, blocks and sites, in board order. */
  items: BoardItem[];
  updatedAt: string;
};

export interface BoardStore {
  /** "live" links follow later edits; "snapshot" links freeze the board when copied. */
  readonly linkKind: "live" | "snapshot";
  list(): Promise<BoardSummary[]>;
  get(id: string): Promise<Board>;
  create(name: string, description?: string | null): Promise<Board>;
  /** The Saved list: the account's (or this browser's) library, made on first use. */
  library(): Promise<Board>;
  update(id: string, patch: BoardPatch): Promise<Board>;
  remove(id: string): Promise<void>;
  /** Save a block or a site. A Block is accepted as before, for callers that only save blocks. */
  add(id: string, target: SavedTarget | Block): Promise<Board>;
  /** `key` is the item's: a block's id, or a site's host. */
  removeItem(id: string, key: string): Promise<Board>;
  setNote(id: string, key: string, note: string): Promise<Board>;
  /** Absolute share URL, or null while sharing is off. */
  shareUrl(board: Board): string | null;
}

const CHANGED = "sectionary:boards";
/** Re-render when any board changes, in this tab or another. */
export function onBoardsChanged(fn: () => void) {
  const storage = (e: StorageEvent) => e.key?.startsWith("sectionary.boards") && fn();
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener("storage", storage);
  };
}
const changed = <T,>(value: T) => {
  window.dispatchEvent(new Event(CHANGED));
  return value;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("This browser would not save the board (storage is full or blocked).");
  }
}

const asTarget = (t: SavedTarget | Block): SavedTarget => ("kind" in t && (t.kind === "block" || t.kind === "site") ? t : { kind: "block", block: t as Block });

function summary(b: Board): BoardSummary {
  const counts: Record<SavedTab, number> = { web: 0, mobile: 0, sites: 0 };
  for (const i of b.items) {
    const tab = tabOf(i);
    if (tab) counts[tab]++;
  }
  return {
    id: b.id, kind: b.kind === "library" ? "library" : "folder", name: b.name, updatedAt: b.updatedAt,
    blockIds: b.items.flatMap((i) => (i.blockId ? [i.blockId] : [])),
    keys: b.items.map(itemKey),
    cover: b.items.find((i) => i.block)?.block ?? null,
    covers: b.items.filter((i) => i.block || i.site).slice(0, 3),
    counts,
    items: b.items,
  };
}

// ---------------------------------------------------------------------------
// API store

const TOKENS = "sectionary.boards.tokens.v1";
const tokens = () => read<Record<string, string>>(TOKENS, {});

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("x-board-token", init.token);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw Object.assign(new Error(err?.error ?? `HTTP ${res.status}`), { status: res.status, code: err?.code });
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * A server from before migration 16 sends boards with no `kind` and ignores
 * `kind: "library"`, so asking it for the Saved list would make an ordinary
 * folder called "Saved" on every press. Refuse instead, and say why.
 */
const OLD_SERVER = "Saved needs the database update that comes with this release (migration 0016), which this server does not have yet. Folders still work.";

let pendingLibrary: Promise<Board> | null = null;

async function findOrMakeLibrary(): Promise<Board> {
  // Signed in, the account's boards; signed out, the ones this browser holds a token for.
  const owned = await call<{ items: Board[] }>("/api/boards").then((r) => r.items, (e: { status?: number }) => (e.status === 401 ? [] : Promise.reject(e)));
  const held = await Promise.all(
    Object.keys(tokens())
      .filter((id) => !owned.some((b) => b.id === id))
      .map((id) => call<Board>(`/api/boards/${id}`, { token: tokens()[id] }).catch(() => null)),
  );
  const all = [...owned, ...held.filter((b): b is Board => b !== null)];
  if (all.some((b) => !("kind" in b))) throw new Error(OLD_SERVER);
  const mine = all.filter((b) => b.kind === "library").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (mine) return mine;

  const { board, token } = await call<BoardCreated>("/api/boards", { method: "POST", body: JSON.stringify({ name: "Saved", kind: "library" }) });
  if (board.kind !== "library") {
    // An old server made a plain folder: take it back out, so nothing is left behind.
    await call<void>(`/api/boards/${board.id}`, { method: "DELETE", token }).catch(() => undefined);
    throw new Error(OLD_SERVER);
  }
  if (token) write(TOKENS, { ...tokens(), [board.id]: token });
  return board;
}

const apiStore: BoardStore = {
  linkKind: "live",
  async list() {
    // The account's boards (none when signed out), then any token boards this browser still holds.
    const owned = await call<{ items: Board[] }>("/api/boards").then((r) => r.items, (e: { status?: number }) => (e.status === 401 ? [] : Promise.reject(e)));
    const ids = Object.keys(tokens()).filter((id) => !owned.some((b) => b.id === id));
    const held = await Promise.all(ids.map((id) => this.get(id).catch((e: { status?: number }) => {
      // Deleted elsewhere: forget it. Anything else (offline, 503): keep the token.
      if (e.status === 404 || e.status === 403) {
        const t = tokens();
        delete t[id];
        write(TOKENS, t);
      }
      return null;
    })));
    return [...owned, ...held.filter((b): b is Board => b !== null)].map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get: (id) => call<Board>(`/api/boards/${id}`, { token: tokens()[id] }),
  async create(name, description) {
    const { board, token } = await call<BoardCreated>("/api/boards", { method: "POST", body: JSON.stringify({ name, description }) });
    write(TOKENS, { ...tokens(), [board.id]: token });
    return changed(board);
  },
  library() {
    // One lookup at a time: two Save presses in a row must not make two lists.
    pendingLibrary ??= findOrMakeLibrary().finally(() => (pendingLibrary = null));
    return pendingLibrary;
  },
  update: async (id, patch) => changed(await call<Board>(`/api/boards/${id}`, { method: "PATCH", token: tokens()[id], body: JSON.stringify(patch) })),
  async remove(id) {
    await call<void>(`/api/boards/${id}`, { method: "DELETE", token: tokens()[id] });
    const t = tokens();
    delete t[id];
    write(TOKENS, t);
    changed(null);
  },
  async add(id, t) {
    const target = asTarget(t);
    const body = target.kind === "block" ? { blockId: target.block.id } : { host: target.store.host };
    return changed(await call<Board>(`/api/boards/${id}/items`, { method: "POST", token: tokens()[id], body: JSON.stringify(body) }));
  },
  removeItem: async (id, key) => changed(await call<Board>(`/api/boards/${id}/items/${encodeURIComponent(key)}`, { method: "DELETE", token: tokens()[id] })),
  setNote: async (id, key, note) => changed(await call<Board>(`/api/boards/${id}/items/${encodeURIComponent(key)}`, { method: "PATCH", token: tokens()[id], body: JSON.stringify({ note }) })),
  shareUrl: (b) => (b.shared ? `${location.origin}/b/${b.shareSlug}` : null),
};

// ---------------------------------------------------------------------------
// Browser store (sample mode)

const LOCAL = "sectionary.boards.v1";
const localBoards = () => read<Board[]>(LOCAL, []);

function saveLocal(id: string, edit: (b: Board) => Board): Board {
  const all = localBoards();
  const i = all.findIndex((b) => b.id === id);
  if (i < 0) throw Object.assign(new Error("Board not found"), { status: 404 });
  all[i] = { ...edit(all[i]), updatedAt: new Date().toISOString() };
  write(LOCAL, all);
  return changed(all[i]);
}
const renumber = (items: Board["items"]) => items.map((it, position) => ({ ...it, position }));

const localStore: BoardStore = {
  linkKind: "snapshot",
  list: async () => localBoards().map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  async get(id) {
    const b = localBoards().find((x) => x.id === id);
    if (!b) throw Object.assign(new Error("Board not found"), { status: 404 });
    return b;
  },
  async create(name, description) {
    const now = new Date().toISOString();
    const board: Board = { id: crypto.randomUUID(), kind: "folder", name: name.trim().slice(0, 120), description: description?.trim() || null, shareSlug: "", shared: true, createdAt: now, updatedAt: now, items: [] };
    write(LOCAL, [board, ...localBoards()]);
    return changed(board);
  },
  async library() {
    const mine = localBoards().find((b) => b.kind === "library");
    if (mine) return mine;
    const now = new Date().toISOString();
    const board: Board = { id: crypto.randomUUID(), kind: "library", name: "Saved", description: null, shareSlug: "", shared: false, createdAt: now, updatedAt: now, items: [] };
    write(LOCAL, [...localBoards(), board]);
    return board;
  },
  update: async (id, patch) =>
    saveLocal(id, (b) => {
      let items = b.items;
      if (patch.order) {
        const rank = new Map(patch.order.map((x, i) => [x, i]));
        items = renumber([...items].sort((x, y) => (rank.get(itemKey(x)) ?? 1e9) - (rank.get(itemKey(y)) ?? 1e9)));
      }
      return {
        ...b, items,
        name: patch.name !== undefined ? patch.name.trim().slice(0, 120) || b.name : b.name,
        description: patch.description !== undefined ? patch.description?.trim() || null : b.description,
      };
    }),
  async remove(id) {
    write(LOCAL, localBoards().filter((b) => b.id !== id));
    changed(null);
  },
  add: async (id, t) => {
    const target = asTarget(t);
    const key = targetKey(target);
    const item: BoardItem =
      target.kind === "block"
        ? { kind: "block", blockId: target.block.id, host: null, note: null, position: 0, block: target.block, site: null }
        : { kind: "site", blockId: null, host: target.store.host, note: null, position: 0, block: null, site: target.store };
    return saveLocal(id, (b) => (b.items.some((i) => itemKey(i) === key) ? b : { ...b, items: renumber([...b.items, item]) }));
  },
  removeItem: async (id, key) => saveLocal(id, (b) => ({ ...b, items: renumber(b.items.filter((i) => itemKey(i) !== key)) })),
  setNote: async (id, key, note) =>
    saveLocal(id, (b) => ({ ...b, items: b.items.map((i) => (itemKey(i) === key ? { ...i, note: note.trim().slice(0, 2000) || null } : i)) })),
  shareUrl: (b) => `${location.origin}/share#${encodeSnapshot(b)}`,
};

// Development only: NEXT_PUBLIC_BOARDS_STORE=local keeps boards in this browser while the
// rest of the app reads the live API (DEV_API_PROXY), so trying Save on localhost never
// writes to the production database.
const DEV_LOCAL_BOARDS = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_BOARDS_STORE === "local";

export const boardStore: BoardStore = API_MODE && !DEV_LOCAL_BOARDS ? apiStore : localStore;

// ---------------------------------------------------------------------------
// Snapshot links: the board travels in the URL fragment, which never reaches a server.

export type Snapshot = { name: string; description: string | null; items: { blockId: string; note: string | null }[] };

function toBase64Url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSnapshot(b: Board) {
  // Blocks only: the share page has no way to show a whole site yet.
  const blocks = b.items.filter((i) => i.blockId);
  return toBase64Url(JSON.stringify({ v: 1, n: b.name, d: b.description, i: blocks.map((i) => (i.note ? [i.blockId, i.note] : [i.blockId])) }));
}

export function decodeSnapshot(hash: string): Snapshot | null {
  try {
    const j = JSON.parse(fromBase64Url(hash.replace(/^#/, ""))) as { v: number; n: string; d: string | null; i: [string, string?][] };
    if (j.v !== 1 || typeof j.n !== "string" || !Array.isArray(j.i)) return null;
    return { name: j.n, description: j.d ?? null, items: j.i.map(([blockId, note]) => ({ blockId: String(blockId), note: note ?? null })) };
  } catch {
    return null;
  }
}
