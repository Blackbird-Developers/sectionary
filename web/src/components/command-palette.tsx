"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, LayoutGrid, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelFor } from "@/lib/blocks";
import { SEARCH_KEY } from "@/lib/filters";
import { wallSource } from "@/lib/load-blocks";
import { StoreIcon } from "@/components/store-icon";

/** The trigger's rotating hint: one of each thing the palette finds. */
const TICKER = ["Search hero sections", "Search a store, like nike.com", "Search “free shipping”", "Search cart drawers"];

/** How many of each kind to offer: enough to choose from, short enough to scan. */
const PER_GROUP = 6;

const PAGES = [
  { href: "/", label: "Blocks", hint: "Every page section" },
  { href: "/flows", label: "Flows", hint: "Home page to cart" },
  { href: "/sites", label: "Sites", hint: "Every store" },
  { href: "/boards", label: "Boards", hint: "What you saved" },
];

type Row = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  /** A store's host, shown as its icon; block types and pages show a glyph instead. */
  host?: string;
  icon?: "search" | "block" | "enter";
};

type Counted = { value: string; count: number };
/** What the palette offers: kinds of block and stores, most blocks first. */
type Directory = { blockTypes: Counted[]; stores: Counted[] };

const byCount = (a: Counted, b: Counted) => b.count - a.count;

const matches = (text: string, ...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(text));

/**
 * Search from anywhere: Cmd+K (Ctrl+K), or "/" when no field has focus.
 * One box over the three things people look for: a kind of block, a store,
 * or words on the page. Arrow keys move, Enter opens, Escape closes.
 *
 * Block types and stores come from the library's facets: the one small
 * request the wall already makes for its counts (`limit=1`), so on the wall
 * the palette opens with them in hand. "-part" slices are left out, as on the
 * Sites page: they are one store's markup, not a kind of block; "unknown" is
 * left out too, since nobody looks for it. Everything
 * here works for signed-out and Free viewers: Store and Block are
 * the two filters every plan has.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setText("");
    setActive(0);
  }, []);

  // The shortcut, everywhere. "/" only when the keystroke is not headed for a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable=true]");
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // While open: the page behind stops scrolling, focus goes in and comes back out.
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    const back = trigger.current;
    return () => {
      document.body.style.overflow = overflow;
      back?.focus({ preventScroll: true });
    };
  }, [open]);

  // The directory, once, the first time it is wanted.
  useEffect(() => {
    if (!open || directory) return;
    let alive = true;
    wallSource()
      .query({ limit: 1 })
      .then(
        (r) =>
          alive &&
          setDirectory({
            blockTypes: (r.facets?.block ?? []).filter((b) => !b.value.endsWith("-part") && b.value !== "unknown").sort(byCount),
            stores: [...(r.facets?.host ?? [])].sort(byCount),
          }),
        () => alive && setFailed(true),
      );
    return () => {
      alive = false;
    };
  }, [open, directory]);

  const rows = useMemo<Row[]>(() => {
    const typed = text.trim();
    const t = typed.toLowerCase();
    const out: Row[] = [];
    if (typed) {
      out.push({
        id: "search",
        group: "Search",
        label: `Search blocks for “${typed}”`,
        hint: "Headlines and copy",
        href: `/?${SEARCH_KEY}=${encodeURIComponent(typed)}`,
        icon: "search",
      });
    }
    const types = (directory?.blockTypes ?? []).filter((b) => !t || matches(t, labelFor(b.value), b.value)).slice(0, PER_GROUP);
    for (const b of types) {
      out.push({
        id: `block-${b.value}`,
        group: "Block types",
        label: labelFor(b.value),
        hint: `${b.count.toLocaleString("en-US")} blocks`,
        href: `/?block=${encodeURIComponent(b.value)}`,
        icon: "block",
      });
    }
    const stores = (directory?.stores ?? []).filter((h) => !t || matches(t, h.value)).slice(0, PER_GROUP);
    for (const h of stores) {
      out.push({
        id: `store-${h.value}`,
        group: "Stores",
        label: h.value,
        hint: `${h.count.toLocaleString("en-US")} blocks`,
        href: `/sites/${encodeURIComponent(h.value)}`,
        host: h.value,
      });
    }
    for (const p of PAGES.filter((p) => !t || matches(t, p.label))) {
      out.push({ id: `page-${p.href}`, group: "Go to", label: p.label, hint: p.hint, href: p.href, icon: "enter" });
    }
    return out;
  }, [text, directory]);

  // A shorter list after typing must not leave the highlight past its end.
  const at = Math.min(active, Math.max(0, rows.length - 1));

  const go = useCallback(
    (row: Row) => {
      close();
      router.push(row.href);
    },
    [close, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const next = (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      setActive(next);
      list.current?.querySelector(`#palette-${CSS.escape(rows[next].id)}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && rows[at]) {
      event.preventDefault();
      go(rows[at]);
    } else if (event.key === "Tab") {
      // One field and one list: Tab has nowhere else to go while this is open.
      event.preventDefault();
    }
  };

  const loading = open && !directory && !failed;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search blocks and stores"
        className="group inline-flex size-11 shrink-0 items-center justify-center gap-2.5 rounded-full text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-full md:max-w-[440px] md:justify-start md:bg-muted md:px-3.5 md:text-[13px] md:hover:bg-accent md:hover:shadow-[0_0_0_1px_var(--border)]"
      >
        <Search className="size-[18px] shrink-0 md:size-4" aria-hidden />
        {/* What can be searched, one example at a time. Decorative: the button's name says it plainly. */}
        <span className="hidden h-5 overflow-hidden text-left md:block" aria-hidden>
          <span className="search-ticker flex flex-col leading-5">
            {[...TICKER, TICKER[0]].map((phrase, i) => (
              <span key={i} className="truncate">
                {phrase}
              </span>
            ))}
          </span>
        </span>
        <kbd className="ml-auto hidden rounded-md border bg-background px-1.5 font-mono text-[10px] leading-5 md:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
          <div className="palette-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="palette-in absolute top-[12vh] left-1/2 flex max-h-[min(70vh,560px)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[0_16px_48px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)]"
          >
            <div className="flex items-center gap-2.5 border-b px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={input}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setActive(0);
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={rows[at] ? `palette-${rows[at].id}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                placeholder="A block type, a store, or words on the page"
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border px-1.5 font-mono text-[10px] leading-5 text-muted-foreground">esc</kbd>
            </div>

            <div ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
              {rows.map((row, i) => (
                <div key={row.id}>
                  {(i === 0 || rows[i - 1].group !== row.group) && (
                    <div className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{row.group}</div>
                  )}
                  {/* A div, not a button: the input keeps focus and the list is driven from it. */}
                  <div
                    id={`palette-${row.id}`}
                    role="option"
                    aria-selected={i === at}
                    onClick={() => go(row)}
                    onPointerMove={() => i !== at && setActive(i)}
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-[13px] transition-colors duration-100",
                      i === at && "bg-muted",
                    )}
                  >
                    {row.host ? (
                      <span className="flex size-8 shrink-0 items-center justify-center">
                        <StoreIcon host={row.host} brand={row.host} size={28} />
                      </span>
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {row.icon === "search" ? <Search className="size-3.5" aria-hidden /> : row.icon === "block" ? <LayoutGrid className="size-3.5" aria-hidden /> : <CornerDownLeft className="size-3.5" aria-hidden />}
                      </span>
                    )}
                    <span className="truncate font-medium">{row.label}</span>
                    {row.hint && <span className="ml-auto shrink-0 truncate pl-3 font-mono text-[11px] text-muted-foreground tabular-nums">{row.hint}</span>}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="space-y-1 p-2" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="shimmer h-9 rounded-lg" />
                  ))}
                </div>
              )}
              {failed && <p className="px-2 py-3 text-[12px] text-muted-foreground">Block types and stores did not load. Search and the page links still work.</p>}
              <p className="sr-only" role="status">
                {loading ? "Loading block types and stores" : `${rows.length} results`}
              </p>
            </div>

            <div className="flex items-center gap-4 border-t px-4 py-2 font-mono text-[10px] text-muted-foreground">
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span className="ml-auto">esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
