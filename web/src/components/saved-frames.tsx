"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, Monitor, Plus, Smartphone, Store as StoreGlyph } from "lucide-react";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { useSlidingThumb } from "@/components/viewport-switch";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { PREVIEW_BLUR, usePreviewOnly } from "@/lib/account";
import { labelFor, PAGE_TYPE_LABEL, thumbOf, type Block } from "@/lib/blocks";
import { industryLabel, platformLabel } from "@/lib/stores";
import { loadSiteView } from "@/lib/load-blocks";
import type { SavedTab } from "@/lib/boards";
import type { BoardItem } from "@/contracts/api";
import type { Store } from "@/contracts/store";
import type { SiteView } from "@/lib/site-profile";

// What a saved item looks like on Boards, Mobbin-style: each in the screen it
// came from. A Web block sits in a browser window, a Mobile block in a phone,
// and a site is its home page in a window with the store underneath. Folders
// show a cover of their first three saves.

/** The browser window's picture area, height over width. */
const WEB_RATIO = 10 / 16;
/** The phone's screen, height over width. */
const PHONE_RATIO = 19.5 / 9;

/** The block's image placed in a frame of `ratio`: from the top when it is taller than the frame, centred when it is shorter. */
function BlockShot({ block, ratio }: { block: Block; ratio: number }) {
  const preview = usePreviewOnly();
  const tall = block.h / block.w > ratio;
  return (
    <span className={cn("absolute inset-0 flex justify-center overflow-hidden", tall ? "items-start" : "items-center")} style={{ background: block.bg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assetUrl(thumbOf(block) ?? block.src)}
        alt=""
        width={block.w}
        height={block.h}
        loading="lazy"
        decoding="async"
        className={cn("block h-auto w-full", preview && PREVIEW_BLUR)}
      />
    </span>
  );
}

/** A browser window: three dots and the address, then the picture. */
export function WebFrame({ address, children, className }: { address: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block w-full overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/60 group-hover:shadow-lg",
        className,
      )}
    >
      <span aria-hidden className="flex h-7 items-center gap-1.5 border-b bg-muted/60 px-2.5">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-border" />
          ))}
        </span>
        <span className="ml-1 min-w-0 flex-1 truncate rounded-md bg-background/80 px-2 py-0.5 text-center font-mono text-[10px] leading-4 text-muted-foreground">{address}</span>
      </span>
      <span className="relative block bg-muted" style={{ aspectRatio: `1 / ${WEB_RATIO}` }}>
        {children}
      </span>
    </span>
  );
}

/** A phone: a bezel, the island, and the screen. */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block w-full rounded-[30px] border-[3px] border-foreground/15 bg-card p-[3px] shadow-sm transition-[border-color,box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/60 group-hover:shadow-lg",
        className,
      )}
    >
      <span className="relative block overflow-hidden rounded-[25px] bg-muted" style={{ aspectRatio: `1 / ${PHONE_RATIO}` }}>
        {children}
        <span aria-hidden className="absolute top-2 left-1/2 z-10 h-[14px] w-[34%] -translate-x-1/2 rounded-full bg-black/85" />
      </span>
    </span>
  );
}

const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

/**
 * A saved block in its own screen. The picture is a button (it opens the
 * block in the viewer, where it was clicked); the line under it says what and
 * from where; `actions` sit over the corner on hover (the Save menu).
 */
export function SavedBlockCard({ block, onOpen, actions }: { block: Block; onOpen: () => void; actions?: React.ReactNode }) {
  const mobile = block.viewport === "mobile";
  const name = labelFor(block.typeHint);
  return (
    <article className="group/card relative flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name} from ${block.host}`}
        className={cn("group block w-full cursor-zoom-in text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", mobile ? "rounded-[30px]" : "rounded-xl")}
      >
        {mobile ? (
          <PhoneFrame>
            <BlockShot block={block} ratio={PHONE_RATIO} />
          </PhoneFrame>
        ) : (
          <WebFrame address={`${block.host}${pathOf(block.pageUrl) === "/" ? "" : pathOf(block.pageUrl)}`}>
            <BlockShot block={block} ratio={WEB_RATIO} />
          </WebFrame>
        )}
      </button>
      <div className="flex min-w-0 items-center gap-2 px-0.5">
        <StoreIcon host={block.host} brand={block.host} size={18} className="rounded-[5px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {block.host} · {PAGE_TYPE_LABEL[block.pageType] ?? block.pageType}
          </span>
        </span>
      </div>
      {actions && (
        <div className={cn("absolute z-20 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 focus-within:opacity-100 touch:opacity-100 has-[[aria-expanded=true]]:opacity-100", mobile ? "top-3 right-3" : "top-9 right-2")}>
          {actions}
        </div>
      )}
    </article>
  );
}

/** A site's pages, fetched once per host per page session. */
const views = new Map<string, Promise<SiteView | null>>();
function useSiteView(host: string): SiteView | null | undefined {
  const [view, setView] = useState<{ host: string; view: SiteView | null } | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = views.get(host);
    if (!pending) {
      pending = loadSiteView(host);
      pending.catch(() => views.delete(host));
      views.set(host, pending);
    }
    pending.then(
      (v) => alive && setView({ host, view: v }),
      () => alive && setView({ host, view: null }),
    );
    return () => {
      alive = false;
    };
  }, [host]);
  return view?.host === host ? view.view : undefined;
}

/**
 * A saved site: its home page in a browser window, the store underneath with
 * what it runs on, and links to its page and its flow.
 */
export function SavedSiteCard({ store, actions }: { store: Store; actions?: React.ReactNode }) {
  const view = useSiteView(store.host);
  const home = view ? (view.pages.find((p) => p.type === "home") ?? view.pages[0] ?? null) : null;
  const blocks = home ? (home.desktopBlocks.length ? home.desktopBlocks : home.mobileBlocks) : [];
  const facts = [store.platform ? platformLabel(store.platform) : null, store.industry && store.industry !== "other" ? industryLabel(store.industry) : null, store.theme].filter(Boolean);
  return (
    <article className="group/card relative flex min-w-0 flex-col gap-2.5">
      <Link
        href={`/sites/${encodeURIComponent(store.host)}`}
        aria-label={`${store.brand}, open the site`}
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <WebFrame address={store.host}>
          {view === undefined ? (
            <span aria-hidden className="shimmer absolute inset-0 bg-muted" />
          ) : home ? (
            <Stack src={home.desktop ?? home.mobile} blocks={blocks} ratio={WEB_RATIO} />
          ) : (
            <span className="absolute inset-0 grid place-items-center">
              <StoreIcon host={store.host} brand={store.brand} size={56} className="rounded-2xl" />
            </span>
          )}
        </WebFrame>
      </Link>
      <div className="flex min-w-0 items-center gap-2.5 px-0.5">
        <StoreIcon host={store.host} brand={store.brand} size={32} className="rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{store.brand}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{facts.length ? facts.join(" · ") : store.host}</span>
        </span>
        <Link
          href={`/sites/${encodeURIComponent(store.host)}/flow`}
          className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors duration-150 hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:py-2.5"
        >
          Flow
        </Link>
      </div>
      {actions && (
        <div className="absolute top-9 right-2 z-20 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 focus-within:opacity-100 touch:opacity-100 has-[[aria-expanded=true]]:opacity-100">
          {actions}
        </div>
      )}
    </article>
  );
}

const TABS: { value: SavedTab; label: string; icon: typeof Monitor }[] = [
  { value: "web", label: "Web", icon: Monitor },
  { value: "mobile", label: "Mobile", icon: Smartphone },
  { value: "sites", label: "Sites", icon: StoreGlyph },
];

/** Web, Mobile, Sites: one pill with a count on each, the highlight sliding between them like the wall's switch. */
export function SavedTabs({ value, onChange, counts, className }: { value: SavedTab; onChange: (tab: SavedTab) => void; counts: Record<SavedTab, number>; className?: string }) {
  const { group, thumb } = useSlidingThumb(value);
  return (
    <div
      ref={group}
      role="tablist"
      aria-label="What to show"
      className={cn("relative isolate inline-flex shrink-0 rounded-full border bg-muted/60 p-1", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const at = TABS.findIndex((t) => t.value === value);
        const next = TABS[(at + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
        onChange(next.value);
        (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {thumb}
      {TABS.map(({ value: tab, label, icon: Icon }) => {
        const on = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={on}
            data-value={tab}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            <span className={cn("font-mono text-[11px] tabular-nums", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{counts[tab].toLocaleString("en-US")}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One tile of a folder's cover: a block's picture, or a site's icon on its colour. */
function CoverTile({ item, className }: { item: BoardItem | undefined; className?: string }) {
  const preview = usePreviewOnly();
  if (!item) return <span className={cn("block bg-muted/70", className)} />;
  if (item.block) {
    const b = item.block;
    return (
      <span className={cn("relative block overflow-hidden", className)} style={{ background: b.bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(thumbOf(b) ?? b.src)} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 h-full w-full object-cover object-top", preview && PREVIEW_BLUR)} />
      </span>
    );
  }
  const store = item.site;
  return (
    <span className={cn("grid place-items-center bg-muted", className)}>
      {store && <StoreIcon host={store.host} brand={store.brand} size={36} className="rounded-xl" />}
    </span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A folder: a cover of its first three saves (one large, two stacked), its name, and what is in it. */
export function FolderCard({
  href,
  name,
  covers,
  counts,
}: {
  href: string;
  name: string;
  covers: BoardItem[];
  counts: Record<SavedTab, number>;
}) {
  const parts = [counts.web && `${counts.web} web`, counts.mobile && `${counts.mobile} mobile`, counts.sites && plural(counts.sites, "site")].filter(Boolean);
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="grid aspect-[4/3] grid-cols-[2fr_1fr] grid-rows-2 gap-1 overflow-hidden rounded-2xl border bg-card p-1 transition-[border-color,box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/60 group-hover:shadow-lg">
        <CoverTile item={covers[0]} className="row-span-2 rounded-l-xl rounded-r-md" />
        <CoverTile item={covers[1]} className="rounded-tr-xl rounded-l-md rounded-br-md" />
        <CoverTile item={covers[2]} className="rounded-br-xl rounded-l-md rounded-tr-md" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5">
        <Folder className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate text-[14px] font-semibold group-hover:text-link">{name}</span>
      </span>
      <span className="-mt-1.5 px-0.5 text-[11px] text-muted-foreground">{parts.length ? parts.join(" · ") : "Empty"}</span>
    </Link>
  );
}

/** The first card in Folders: press it to name a new one. */
export function NewFolderCard({ onCreate, disabled }: { onCreate: (name: string) => Promise<void>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
      setName("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {editing ? (
        <form onSubmit={submit} className="flex aspect-[4/3] flex-col justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 p-4">
          <label htmlFor="new-folder" className="text-[12px] font-medium">
            Name the folder
          </label>
          <input
            id="new-folder"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            maxLength={120}
            placeholder="e.g. Acme PDP refresh"
            className="h-9 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <div className="flex gap-1.5">
            <button type="submit" disabled={!name.trim() || busy} className="h-8 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              Create
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full px-3 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className="group flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-muted-foreground outline-none transition-colors duration-150 hover:border-primary/60 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-105">
            <Plus className="size-5" />
          </span>
          <span className="text-[13px] font-medium">New folder</span>
        </button>
      )}
    </div>
  );
}
