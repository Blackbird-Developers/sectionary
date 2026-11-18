"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, Folder, FolderPlus, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { boardStore, isFolder, onBoardsChanged, targetKey, type BoardSummary, type SavedTarget } from "@/lib/boards";
import { gateOf, useAccess, type Gate } from "@/lib/account";
import type { Block } from "@/lib/blocks";

/**
 * "Save". The first press asks where: "Save" keeps the block (or site) in
 * Saved, or pick one of your folders (or name a new one) to put it straight
 * there. A small note then says where it went. Pressing "Saved" again opens
 * the menu to change that: Saved first (untick to unsave), then your folders.
 * The button reads "Saved" while it is in Saved or any folder, and the Boards
 * page's Saved tab shows everything either way.
 *
 * `className` restyles the button; `up` opens the menu above it, for a button
 * that sits at the bottom of the screen.
 */
export function SaveToBoard({
  block,
  target: given,
  className,
  up,
  defaultOpen = false,
  iconOnly = false,
  variant,
}: {
  /** A block to save (the older prop; `target` takes a block or a site). */
  block?: Block;
  target?: SavedTarget;
  className?: string;
  /** Open the list above the button: centred on it, or with "end" flush to its right edge (a button in a corner). */
  up?: boolean | "end";
  /** Mounted already open, for a button that only becomes this control when pressed (a wall card). */
  defaultOpen?: boolean;
  /** The bookmark alone, for a cell too narrow for the word. */
  iconOnly?: boolean;
  /** The button's look; by default filled until saved. */
  variant?: "default" | "secondary" | "outline" | "ghost";
}) {
  const target: SavedTarget | null = given ?? (block ? { kind: "block", block } : null);
  if (!target) return null;
  return <SaveMenu target={target} className={className} up={up} defaultOpen={defaultOpen} iconOnly={iconOnly} variant={variant} />;
}

function SaveMenu({
  target,
  className,
  up,
  defaultOpen,
  iconOnly,
  variant,
}: {
  target: SavedTarget;
  className?: string;
  up?: boolean | "end";
  defaultOpen: boolean;
  iconOnly: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost";
}) {
  const key = targetKey(target);
  const access = useAccess();
  // Free after the trial, or signed out: no new boards and nothing added (the API agrees, see server/boards.ts).
  const locked = !access.can("boards");
  // Closed; the first-press chooser (Save, or a folder); the note saying where it went; or the full menu.
  const [open, setOpen] = useState<"closed" | "choose" | "note" | "menu">(defaultOpen ? (locked ? "menu" : "choose") : "closed");
  const [note, setNote] = useState<{ label: string; folder: boolean }>({ label: "Saved", folder: false });
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Mounted open (a wall card's button becomes this control when pressed): the chooser, or the menu if it turns out to be saved already.
  const pressedOpen = useRef(defaultOpen && !locked);

  useEffect(() => {
    let alive = true;
    const load = () =>
      boardStore
        .list()
        .then((b) => {
          if (!alive) return;
          setBoards(b);
          if (pressedOpen.current) {
            pressedOpen.current = false;
            if (b.some((x) => x.keys.includes(key))) setOpen((o) => (o === "choose" ? "menu" : o));
          }
        })
        .catch((e: Error) => alive && setError(e.message));
    load();
    const off = onBoardsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [key]);

  // Close on outside click and on Escape (without closing the dialog behind it).
  useEffect(() => {
    if (open === "closed") return;
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen("closed");
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen("closed");
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const library = boards?.find((b) => !isFolder(b)) ?? null;
  const folders = boards?.filter(isFolder) ?? [];
  const inLibrary = Boolean(library?.keys.includes(key));
  const inFolders = folders.filter((b) => b.keys.includes(key));
  const saved = inLibrary || inFolders.length > 0;

  const run = async (id: string, job: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    setGate(null);
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
      setGate(gateOf(e));
    } finally {
      setBusy(null);
    }
  };
  /** Into Saved, making the list on first use. */
  const keep = async () => {
    const lib = await boardStore.library();
    if (!lib.items.some((i) => (i.blockId ?? i.host) === key)) await boardStore.add(lib.id, target);
  };
  const toggleLibrary = () =>
    run("library", async () => {
      if (inLibrary && library) await boardStore.removeItem(library.id, key);
      else await keep();
    });
  const toggleFolder = (b: BoardSummary) =>
    run(b.id, async () => {
      if (b.keys.includes(key)) return void (await boardStore.removeItem(b.id, key));
      await boardStore.add(b.id, target);
    });
  /** A new folder with this in it. From the chooser it then says so and closes; from the menu it stays open. */
  const create = (e: React.FormEvent, from: "choose" | "menu") => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (from === "choose") {
      setNote({ label: `Added to ${n}`, folder: true });
      setOpen("note");
    }
    run("new", async () => {
      const board = await boardStore.create(n);
      await boardStore.add(board.id, target);
      setName("");
    });
  };

  // The chooser's two answers: just save, or straight into a folder.
  const saveOnly = () => {
    setNote({ label: "Saved", folder: false });
    setOpen("note");
    void run("library", keep);
  };
  const saveInto = (b: BoardSummary) => {
    setNote({ label: `Added to ${b.name}`, folder: true });
    setOpen("note");
    void run(b.id, () => boardStore.add(b.id, target));
  };

  // The note goes by itself after a few seconds, unless the pointer or focus is on it, or something went wrong.
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (open !== "note" || holding || busy || error) return;
    const timer = setTimeout(() => setOpen((o) => (o === "note" ? "closed" : o)), 4000);
    return () => clearTimeout(timer);
  }, [open, holding, busy, error]);

  const press = () => {
    if (open !== "closed") return setOpen("closed");
    // Not saved yet: ask where. Saved already, or locked: the menu.
    setOpen(!saved && !locked ? "choose" : "menu");
  };

  const what = target.kind === "site" ? "site" : "block";

  return (
    <div ref={ref} className="relative">
      <Button variant={variant ?? (saved ? "secondary" : "default")} size="sm" className={className} aria-expanded={open === "menu" || open === "choose"} aria-haspopup="dialog" onClick={press}>
        {locked ? <Lock /> : saved ? <BookmarkCheck /> : <Bookmark />}
        {iconOnly ? <span className="sr-only">{saved ? "Saved" : "Save"}</span> : saved ? "Saved" : "Save"}
      </Button>
      {open === "note" && (
        <div
          role="status"
          onPointerEnter={() => setHolding(true)}
          onPointerLeave={() => setHolding(false)}
          onFocus={() => setHolding(true)}
          onBlur={() => setHolding(false)}
          className={cn(
            "absolute z-30 flex w-max max-w-72 items-center gap-2 rounded-full border bg-popover py-1.5 pr-1.5 pl-3 text-[13px] text-popover-foreground shadow-xl",
            up === "end" ? "right-0 bottom-full mb-2" : up ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : "top-full right-0 mt-1.5",
          )}
        >
          {error ? (
            <span className="min-w-0 text-[12px] text-destructive">
              {error}
              <GateLink gate={gate} />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span className="max-w-44 truncate">{busy ? "Saving…" : note.label}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen("menu")}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[12px] font-medium outline-none transition-colors duration-150 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
          >
            {note.folder ? (
              "Change"
            ) : (
              <>
                <FolderPlus className="size-3.5" aria-hidden /> Add to folder
              </>
            )}
          </button>
        </div>
      )}
      {open === "choose" && (
        <div
          role="dialog"
          aria-label={`Save this ${what}`}
          className={cn(
            "absolute z-30 w-72",
            up === "end" ? "right-0 bottom-full mb-2" : up ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : "top-full right-0 mt-1.5",
            "rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl",
          )}
        >
          <button
            type="button"
            autoFocus
            onClick={saveOnly}
            className="flex w-full items-center gap-3 rounded-lg bg-primary px-3 py-2.5 text-left text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
          >
            <Bookmark className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">Save</span>
              <span className="block text-[11px] text-primary-foreground/80">Keep it in Saved</span>
            </span>
          </button>
          <p className="mt-2 px-2 pb-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Or save to a folder</p>
          {boards === null ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading folders…</p>
          ) : folders.length === 0 ? (
            <p className="px-2 pb-1 text-[12px] text-muted-foreground">No folders yet. Name one below and it goes straight in.</p>
          ) : (
            <ul className="max-h-56 overflow-auto">
              {folders.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => saveInto(b)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Folder className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{b.keys.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => create(e, "choose")} className="mt-1 flex gap-1 border-t pt-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New folder"
              aria-label="New folder name"
              maxLength={120}
              className="h-7 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <Button type="submit" size="icon-sm" variant="outline" aria-label="Create folder and save to it" disabled={!name.trim()}>
              <Plus />
            </Button>
          </form>
        </div>
      )}
      {open === "menu" && (
        <div
          role="dialog"
          aria-label={`Save this ${what}`}
          className={cn(
            "absolute z-30 w-72",
            up === "end" ? "right-0 bottom-full mb-2" : up ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : "top-full right-0 mt-1.5",
            "rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl",
          )}
        >
          {locked ? (
            <div className="flex flex-col items-start gap-2 px-2 py-1.5">
              <p className="text-[12px] text-pretty text-muted-foreground">
                {access.signedIn
                  ? "Saving comes with Pro. What you have already saved stays readable and shareable."
                  : "Sign in to save blocks and sites. New accounts get Pro free for 7 days."}
              </p>
              <Link
                href={access.signedIn ? "/account" : "/account?next=/boards"}
                className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
              >
                {access.signedIn ? "See plans" : "Start free trial"}
              </Link>
            </div>
          ) : boards === null ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</p>
          ) : (
            <>
              <Row on={inLibrary} busy={busy !== null} onClick={toggleLibrary} icon={<Bookmark className="size-3.5" />} label="Saved" hint={`Every ${what} you save`} />
              <p className="mt-1.5 border-t px-2 pt-2 pb-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Folders</p>
              {folders.length === 0 ? (
                <p className="px-2 pb-1 text-[12px] text-muted-foreground">No folders yet. Name one below to group saves for a project or a client.</p>
              ) : (
                <ul className="max-h-56 overflow-auto">
                  {folders.map((b) => (
                    <li key={b.id}>
                      <Row
                        on={b.keys.includes(key)}
                        busy={busy !== null}
                        onClick={() => toggleFolder(b)}
                        icon={<Folder className="size-3.5" />}
                        label={b.name}
                        count={b.keys.length}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={(e) => create(e, "menu")} className="mt-1 flex gap-1 border-t pt-1.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New folder"
                  aria-label="New folder name"
                  maxLength={120}
                  className="h-7 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
                <Button type="submit" size="icon-sm" variant="outline" aria-label="Create folder and save" disabled={!name.trim() || busy !== null}>
                  <Plus />
                </Button>
              </form>
            </>
          )}
          {error && (
            <p className="px-2 pt-1.5 text-[12px] text-destructive">
              {error}
              <GateLink gate={gate} />
            </p>
          )}
          <Link href="/boards" className="mt-1 block rounded-md px-2 py-1.5 text-[12px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Go to Boards
          </Link>
        </div>
      )}
    </div>
  );
}

/** One line of the menu: a checkbox, an icon, the name, and a count or a hint. */
function Row({ on, busy, onClick, icon, label, hint, count }: { on: boolean; busy: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint?: string; count?: number }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
    >
      <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="size-3" />}</span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {count !== undefined && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
}

/** "Sign in" or "See plans" after a board error the plan gate caused. */
function GateLink({ gate }: { gate: Gate | null }) {
  if (!gate) return null;
  return (
    <Link href={gate === "SIGN_IN_REQUIRED" ? "/account?next=/boards" : "/account"} className="ml-1 text-link underline-offset-4 hover:underline">
      {gate === "SIGN_IN_REQUIRED" ? "Sign in" : "See plans"}
    </Link>
  );
}
