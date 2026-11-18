"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Bookmark, Lock } from "lucide-react";
import { SaveToBoard } from "@/components/save-to-board";
import { InlineBlockViewer } from "@/components/inline-block-viewer";
import { FolderCard, NewFolderCard, SavedBlockCard, SavedSiteCard, SavedTabs } from "@/components/saved-frames";
import { boardStore, isFolder, itemKey, onBoardsChanged, tabOf, type BoardSummary, type SavedTab } from "@/lib/boards";
import { gateOf, useAccess, useAccount, type Gate } from "@/lib/account";
import type { Block } from "@/lib/blocks";
import type { BoardItem } from "@/contracts/api";

const TAB_VALUES: SavedTab[] = ["web", "mobile", "sites"];

/**
 * Boards, the way Mobbin lays out what you saved: everything you have saved
 * first, behind three pills, then your folders (a cover of their first saves,
 * and a card to start a new one). Web blocks sit in a browser
 * window, Mobile blocks in a phone, sites as their home page with the store
 * underneath. A block opens in the viewer right here; each save keeps its
 * Save menu, to move it between Saved and folders.
 *
 * "Saved" is the account's library plus anything in a folder (boards made
 * before the library existed hold their blocks only in folders), newest first.
 * The older list view (boards-list.tsx) is kept.
 */
export function SavedLibrary() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [viewing, setViewing] = useState<{ list: Block[]; at: number } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const account = useAccount();
  const access = useAccess();

  useEffect(() => {
    let alive = true;
    const load = () =>
      boardStore
        .list()
        .then((b) => alive && setBoards(b))
        .catch((e: Error) => alive && setError(e.message));
    load();
    const off = onBoardsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const folders = useMemo(() => (boards ?? []).filter(isFolder), [boards]);

  // Everything saved, once each: the library newest first, then what is only in folders.
  const saved = useMemo(() => {
    const seen = new Set<string>();
    const out: BoardItem[] = [];
    const add = (items: BoardItem[]) => {
      for (const item of items) {
        const key = itemKey(item);
        if (!key || seen.has(key) || !tabOf(item)) continue;
        seen.add(key);
        out.push(item);
      }
    };
    const library = (boards ?? []).find((b) => !isFolder(b));
    if (library) add([...library.items].reverse());
    for (const folder of folders) add([...folder.items].reverse());
    return out;
  }, [boards, folders]);

  const counts = useMemo(() => {
    const c: Record<SavedTab, number> = { web: 0, mobile: 0, sites: 0 };
    for (const item of saved) c[tabOf(item)!]++;
    return c;
  }, [saved]);

  const asked = params.get("tab") as SavedTab | null;
  const tab: SavedTab = asked && TAB_VALUES.includes(asked) ? asked : "web";
  const setTab = (next: SavedTab) => {
    const q = new URLSearchParams(params.toString());
    if (next === "web") q.delete("tab");
    else q.set("tab", next);
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const shown = saved.filter((i) => tabOf(i) === tab);
  const blocks = shown.flatMap((i) => (i.block ? [i.block] : []));

  const createFolder = async (name: string) => {
    setError(null);
    setGate(null);
    try {
      const board = await boardStore.create(name);
      router.push(`/boards/${board.id}`);
    } catch (e) {
      setError((e as Error).message);
      setGate(gateOf(e));
      throw e;
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[26px] leading-tight font-extrabold tracking-[-0.03em]">Boards</h1>
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Everything you save, in the screen it came from. Group saves into folders for a project, and share a folder with a client.
        </p>
        {!access.can("boards") && (
          <p className="mt-1 flex max-w-xl items-center gap-2 text-[13px] text-muted-foreground">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            <span>
              {access.signedIn
                ? "Saving comes with Pro. What you have already saved stays here, readable and shareable."
                : "Sign in to save blocks and sites. New accounts get Pro free for 7 days."}{" "}
              <Link href={access.signedIn ? "/account" : "/account?next=/boards"} className="font-medium text-link underline-offset-4 hover:underline">
                {access.signedIn ? "See plans" : "Start free trial"}
              </Link>
            </span>
          </p>
        )}
        {error && (
          <p className="text-[12px] text-destructive">
            {error}
            {gate && (
              <Link href={gate === "SIGN_IN_REQUIRED" ? "/account?next=/boards" : "/account"} className="ml-1 text-link underline-offset-4 hover:underline">
                {gate === "SIGN_IN_REQUIRED" ? "Sign in" : "See plans"}
              </Link>
            )}
          </p>
        )}
      </header>

      <section aria-labelledby="saved-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h2 id="saved-heading" className="inline-flex items-center gap-2 font-heading text-[17px] font-extrabold tracking-[-0.02em]">
            <Bookmark className="size-4 text-primary" aria-hidden /> Saved
          </h2>
          <SavedTabs value={tab} onChange={setTab} counts={counts} />
        </div>

        {boards === null ? (
          <SavedSkeleton tab={tab} />
        ) : shown.length === 0 ? (
          <EmptyTab tab={tab} />
        ) : (
          <ul className={GRID[tab]}>
            {shown.map((item) => (
              <li key={itemKey(item)}>
                {item.block ? (
                  <SavedBlockCard
                    block={item.block}
                    onOpen={() =>
                      setViewing({
                        list: blocks,
                        at: blocks.indexOf(item.block!),
                      })
                    }
                    actions={
                      <SaveToBoard target={{ kind: "block", block: item.block }} iconOnly variant="secondary" className="size-8 rounded-full p-0 shadow-md" />
                    }
                  />
                ) : item.site ? (
                  <SavedSiteCard
                    store={item.site}
                    actions={
                      <SaveToBoard target={{ kind: "site", store: item.site }} iconOnly variant="secondary" className="size-8 rounded-full p-0 shadow-md" />
                    }
                  />
                ) : (
                  <Gone />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="folders-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="folders-heading" className="font-heading text-[17px] font-extrabold tracking-[-0.02em]">
            Folders
          </h2>
          {boards && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{folders.length}</span>}
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <li>
            <NewFolderCard onCreate={createFolder} disabled={!access.can("boards")} />
          </li>
          {boards === null
            ? Array.from({ length: 3 }, (_, i) => (
                <li key={i} aria-hidden className="flex flex-col gap-2">
                  <div className="shimmer aspect-[4/3] rounded-2xl bg-muted" />
                  <div className="shimmer h-3 w-24 rounded bg-muted" />
                </li>
              ))
            : folders.map((f) => (
                <li key={f.id}>
                  <FolderCard href={`/boards/${f.id}`} name={f.name} covers={f.covers} counts={f.counts} />
                </li>
              ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted-foreground">
        {boardStore.linkKind === "snapshot"
          ? "On this preview, your saves are tied to this browser."
          : account
            ? `Saved to your account, ${account.email}.`
            : account === null && (
                <>
                  Signed out, your saves are tied to this browser.{" "}
                  <Link href="/account?next=/boards" className="text-link underline-offset-4 hover:underline">
                    Sign in
                  </Link>{" "}
                  to keep them on every device.
                </>
              )}
      </p>

      <InlineBlockViewer viewing={viewing} onViewing={setViewing} />
    </div>
  );
}

/** Columns per tab: windows are wide, phones narrow, sites wide with room for the store line. */
export const GRID: Record<SavedTab, string> = {
  web: "grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
  mobile: "grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
  sites: "grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
};

const EMPTY: Record<SavedTab, { title: string; body: string; href: string; cta: string }> = {
  web: {
    title: "No web blocks saved yet",
    body: "Press Save on any desktop block and it lands here, in its browser window.",
    href: "/?vp=desktop",
    cta: "Browse web blocks",
  },
  mobile: {
    title: "No mobile blocks saved yet",
    body: "Press Save on any mobile block and it lands here, on its phone.",
    href: "/?vp=mobile",
    cta: "Browse mobile blocks",
  },
  sites: {
    title: "No sites saved yet",
    body: "Press Save on a store's page or its flow to keep the whole site here.",
    href: "/sites",
    cta: "Browse sites",
  },
};

export function EmptyTab({ tab, note }: { tab: SavedTab; note?: string }) {
  const e = EMPTY[tab];
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
        <Bookmark className="size-5" aria-hidden />
      </span>
      <p className="text-[14px] font-semibold">{e.title}</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">{note ?? e.body}</p>
      <Link
        href={e.href}
        className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {e.cta} <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function Gone() {
  return (
    <div className="grid aspect-[16/11] place-items-center rounded-xl border border-dashed text-[12px] text-muted-foreground">No longer in the library</div>
  );
}

export function SavedSkeleton({ tab }: { tab: SavedTab }) {
  const mobile = tab === "mobile";
  return (
    <ul className={GRID[tab]} aria-busy="true" aria-label="Loading saves">
      {Array.from({ length: mobile ? 6 : 3 }, (_, i) => (
        <li key={i} aria-hidden className="flex flex-col gap-2">
          <div className={mobile ? "shimmer aspect-[9/19.5] rounded-[30px] bg-muted" : "shimmer aspect-[16/11] rounded-xl bg-muted"} />
          <div className="shimmer h-3 w-32 rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}
