"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ExternalLink, Lock, RectangleVertical, Rows3, X } from "lucide-react";
import { StoreIcon } from "@/components/store-icon";
import { INSET } from "@/components/block-viewer";
import { useSlidingThumb, ViewportSwitch } from "@/components/viewport-switch";
import { useViewCheck, ViewLimitPanel } from "@/components/view-limit";
import { useAccess } from "@/lib/account";
import { assetUrl } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import { blockAt, blockTop, captureFiles, labelFor, PAGE_TYPE_LABEL, shotsOf, type Block, type Shot } from "@/lib/blocks";
import type { ProfilePage } from "@/lib/site-profile";
import type { Viewport } from "@/contracts/block";

/** How a site's page is open: the whole page in one scroll, or one block at a time. */
export type PageMode = "page" | "blocks";

export type PageBlocks = {
  desktop: Block[];
  mobile: Block[];
  /** The page's full-size screenshot per viewport, file by file, when the source lists it. */
  shots?: { desktop: Shot[] | null; mobile: Shot[] | null };
};

/** A phone's width: the mobile capture is drawn no wider than this. */
const PHONE_W = 390;

/** The width a desktop page is captured at. */
const DESKTOP_W = 1440;

/** Screenshots are captured at two image pixels per CSS pixel. */
const CAPTURE_SCALE = 2;

/**
 * The widest a desktop page is drawn. Under the capture's own width, so there
 * are always more image pixels than screen pixels (the screenshots are 2x):
 * the page reads a little condensed and stays sharp on any screen.
 */
const DESKTOP_MAX = 1200;

const MODES: { value: PageMode; label: string; icon: typeof Rows3 }[] = [
  { value: "page", label: "Full page", icon: RectangleVertical },
  { value: "blocks", label: "Blocks", icon: Rows3 },
];

/**
 * Whether a page's full-size screenshot is one file or slices, by its
 * thumbnail's address, once loading it has told: the next time it is asked
 * for in the right form straight away.
 */
const captureForm = new Map<string, "whole" | "sliced">();

/**
 * Start fetching a page's full-size screenshot (its first file) before the
 * page is opened, from its thumbnail's address: on hovering its card, so the
 * page opens sharp rather than waiting on the download. Safe to call often.
 */
export function preloadCapture(thumb: string | null | undefined): void {
  const files = thumb ? captureFiles(thumb) : null;
  if (!thumb || !files || captureForm.has(thumb) || warming.has(thumb)) return;
  warming.add(thumb);
  const whole = new Image();
  whole.onload = () => captureForm.set(thumb, "whole");
  whole.onerror = () => {
    const slice = new Image();
    slice.onload = () => captureForm.set(thumb, "sliced");
    slice.src = assetUrl(files.slice(0));
  };
  whole.src = assetUrl(files.whole);
}

const warming = new Set<string>();

/**
 * Full page or block by block, as one pill, the same shape as the Web / Mobile
 * switch beside it. Below `sm` the labels drop and the icons stay.
 */
export function PageModeSwitch({ value, onChange, className }: { value: PageMode; onChange: (mode: PageMode) => void; className?: string }) {
  const { group, thumb } = useSlidingThumb(value);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Show the page"
      className={cn("relative isolate inline-flex shrink-0 rounded-full border bg-muted/60 p-1", className)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        // Arrows switch here and stop: the block viewer listens for them to step blocks.
        event.preventDefault();
        event.stopPropagation();
        const next = value === "page" ? "blocks" : "page";
        onChange(next);
        (event.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {thumb}
      {MODES.map(({ value: mode, label, icon: Icon }) => {
        const on = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            data-value={mode}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Back to the whole page from one of its blocks: a pill of its own beside the
 * Full page / Blocks and Web / Mobile switches, the same height and shape as
 * theirs. The page comes back where it was left (see `restore` on PageViewer).
 * On a narrow window the words drop and the arrow stays.
 */
export function BackToPageButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to the full page"
      title="Back to the full page"
      className={cn(
        // 38px: a switch's height (its border, its padding and an option inside); 54px where its options are 44px tall for touch.
        "inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border bg-muted/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors duration-200 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:h-[54px] touch:px-4",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      <span className="hidden lg:inline">Back to page</span>
    </button>
  );
}

type PageViewerProps = {
  /** The page to show; null keeps the window closed. */
  page: ProfilePage | null;
  /** Its blocks per viewport; null while they load. */
  blocks: PageBlocks | null;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  /** Open block `at` of the shown viewport, block by block. `scrollTop` is how far down the page was scrolled when it was clicked. */
  onBlock: (at: number, scrollTop?: number) => void;
  onMode: (mode: PageMode) => void;
  /** The block to bring into view on opening: the one the Blocks view was on. */
  focus: number;
  /** Coming back to the page as it was left: the scroll position to return to, instead of bringing `focus` into view. */
  restore?: number | null;
  onClose: () => void;
  /** The store whose profile this opened from; another store's page (a similar one) links to its own. */
  siteHost?: string;
  /** The store the page belongs to, when it is known; else the host in the page's URL. */
  pageHost?: string;
  /** Pages like this one from other stores, drawn below the window; "See similar" scrolls to them. */
  similar?: React.ReactNode;
};

/**
 * A site's page, whole, in the same window the block viewer uses: the
 * full-page screenshot, which is the page exactly as it was in the browser.
 * Web shows the desktop capture (no wider than DESKTOP_MAX), Mobile the phone
 * capture in a phone-shaped frame. A click opens the block at that height in
 * the block viewer, and the Full page / Blocks switch moves between the two.
 *
 * Without a full-page screenshot (the sample has none) the page is rebuilt
 * from its blocks, stacked in page order, each a button into the block viewer.
 */
export function PageViewer({ page, blocks, onClose, similar, ...rest }: PageViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const show = Boolean(page);
  const similarRef = useRef<HTMLElement>(null);

  // Another page opened in place (a similar one): back to its top.
  const key = page?.key;
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [key]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) d.showModal();
    if (!show && d.open) d.close();
  }, [show]);

  // Opening a page counts as opening its first block, against the Free plan's
  // daily cap: the whole page is the blocks in full.
  const first = blocks ? (blocks.desktop[0] ?? blocks.mobile[0] ?? null) : null;
  const check = useViewCheck(page && first ? first.id : null);
  const limited = check?.allowed === false;

  return (
    <dialog
      ref={ref}
      aria-label={page ? `${PAGE_TYPE_LABEL[page.type] ?? page.type} page from ${new URL(page.url).host}` : "Page"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-y-auto overscroll-contain bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      {page && limited && check ? (
        <div className="flex min-h-dvh items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <ViewLimitPanel check={check} onClose={onClose} />
        </div>
      ) : page ? (
        <>
          <Window
            key={page.key}
            page={page}
            blocks={blocks}
            onClose={onClose}
            onSimilar={similar ? () => similarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) : undefined}
            {...rest}
          />
          {similar && (
            <section ref={similarRef} aria-labelledby="similar-pages-heading" className="mx-auto max-w-[1600px] scroll-mt-6 px-3 pt-8 pb-12 min-[700px]:px-6">
              <h3 id="similar-pages-heading" className="mb-4 font-heading text-[17px] font-semibold text-white">
                More {(PAGE_TYPE_LABEL[page.type] ?? page.type).toLowerCase()} pages
              </h3>
              {similar}
            </section>
          )}
        </>
      ) : null}
    </dialog>
  );
}

function Window({
  page,
  blocks,
  viewport: wanted,
  onViewport,
  onBlock,
  onMode,
  focus,
  restore = null,
  onClose,
  siteHost,
  pageHost,
  onSimilar,
}: Omit<PageViewerProps, "page" | "similar"> & { page: ProfilePage; onSimilar?: () => void }) {
  const host = new URL(page.url).host;
  const store = pageHost ?? host;
  const path = page.url.replace(/^https?:\/\/[^/]+/, "") || "/";
  const pageLabel = PAGE_TYPE_LABEL[page.type] ?? page.type;
  const access = useAccess();

  // Which viewports have something to show: blocks, or a full-page shot.
  const has = {
    desktop: Boolean(blocks?.desktop.length || page.desktop),
    mobile: Boolean(blocks?.mobile.length || page.mobile),
  };
  const viewport: Viewport = has[wanted] || !blocks ? wanted : wanted === "desktop" ? "mobile" : "desktop";
  const list = blocks?.[viewport] ?? [];
  const both = has.desktop && has.mobile;

  const switches = (
    <>
      <PageModeSwitch value="page" onChange={onMode} />
      {both && <ViewportSwitch value={viewport} onChange={onViewport} size="sm" />}
    </>
  );

  return (
    <div className={cn("relative flex h-dvh flex-col bg-card text-card-foreground shadow-2xl min-[700px]:rounded-2xl min-[700px]:border", INSET)}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 min-[700px]:h-16 min-[700px]:px-5">
        {(() => {
          const title = (
            <>
              <StoreIcon host={host} brand={host} size={34} className="rounded-lg" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-heading text-[17px] font-semibold min-[700px]:text-[19px]">{pageLabel}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {host}
                  {path === "/" ? "" : path}
                </span>
              </span>
            </>
          );
          // Another store's page, opened from "similar": its name leads to that store.
          return siteHost && siteHost !== store ? (
            <Link
              href={`/sites/${encodeURIComponent(store)}`}
              title={`${store}: every captured page`}
              className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </Link>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">{title}</div>
          );
        })()}
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-2 hidden items-center gap-2 sm:flex">{switches}</div>
          {access.can("source-link") ? (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the source page"
              title="Open the source page"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <ExternalLink className="size-[18px]" />
            </a>
          ) : (
            <Link
              href="/account"
              aria-label="The source page link comes with Pro"
              title="The source page link comes with Pro"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <Lock className="size-4" />
            </Link>
          )}
          <span aria-hidden className="mx-2 h-6 w-px bg-border" />
          <button
            type="button"
            autoFocus
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
          >
            <X className="size-[18px]" />
          </button>
        </div>
      </header>

      <div className="flex justify-center gap-2 pb-2 sm:hidden">{switches}</div>

      <div className="relative flex min-h-0 flex-1 flex-col border-t">
        <FullPage
          key={viewport}
          page={page}
          blocks={blocks ? list : null}
          shots={blocks?.shots?.[viewport] ?? null}
          viewport={viewport}
          focus={focus}
          restore={restore}
          onBlock={onBlock}
        />

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-3 text-[13px] min-[700px]:px-5">
          <span className="truncate text-muted-foreground">
            {viewport === "mobile" ? "Mobile" : "Desktop"}
            {list.length > 0 && <span className="font-mono text-[12px] tabular-nums"> ({Math.max(...list.map((b) => b.w))} wide)</span>}
          </span>
          {list.length > 0 && (
            <span className="flex shrink-0 items-center gap-3">
              <span className="hidden text-muted-foreground sm:inline">Click the page to open a block</span>
              <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                {list.length} block{list.length === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </footer>
      </div>

      {onSimilar && (
        <button
          type="button"
          onClick={onSimilar}
          className="absolute bottom-0 left-1/2 z-10 inline-flex -translate-x-1/2 translate-y-1/2 items-center gap-1.5 rounded-full border bg-card px-4 py-2 text-[13px] font-medium shadow-lg outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-[699px]:bottom-16 max-[699px]:translate-y-0"
        >
          See similar <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The page in one scroll. The full-page screenshot when there is one (see
 * PageCapture): the page as the browser drew it, so nothing is rearranged.
 * Otherwise its blocks top to bottom (see BlockStack), or the thumbnail at
 * its own size when there are no blocks either; a shimmer the shape of a
 * page while the blocks load.
 *
 * Nothing is ever drawn larger than it was captured, which is what keeps it
 * sharp: the column is no wider than the page was (DESKTOP_MAX on desktop,
 * a phone's width on mobile) and every picture takes its file's own shape.
 */
function FullPage({
  page,
  blocks,
  shots,
  viewport,
  focus,
  restore,
  onBlock,
}: {
  page: ProfilePage;
  blocks: Block[] | null;
  /** The full-page screenshot's files, when the source lists them. */
  shots: Shot[] | null;
  viewport: Viewport;
  focus: number;
  restore: number | null;
  onBlock: (at: number, scrollTop?: number) => void;
}) {
  const mobile = viewport === "mobile";
  const scroller = useRef<HTMLDivElement>(null);
  // A block opens with where the page was scrolled to, so coming back finds the page as it was left.
  const open = (at: number) => onBlock(at, scroller.current?.scrollTop);
  const thumb = page[viewport];
  // The full-page screenshot: the files the source listed, or found from the thumbnail's address.
  const files = thumb ? captureFiles(thumb) : null;
  const [noCapture, setNoCapture] = useState(false);
  const capture = !noCapture && Boolean(shots?.length || files);
  // Rebuilt from blocks: the page's width in CSS pixels is its widest block, within what the viewport was captured at.
  const captured = mobile ? PHONE_W : DESKTOP_W;
  const pageW = blocks?.length ? Math.min(captured, Math.max(...blocks.map((b) => b.w))) : captured;
  const width = mobile ? pageW : Math.min(pageW, DESKTOP_MAX);
  // Only the thumbnail to show: 600 pixels wide, the top of the page. On
  // desktop the frame takes the picture's own width, so it is not blown up.
  const thumbOnly = blocks !== null && !capture && blocks.length === 0 && Boolean(thumb);
  const label = `${PAGE_TYPE_LABEL[page.type] ?? page.type} page, ${viewport}`;

  // Back from the Blocks view, rebuilt from blocks: the page where it was
  // left, or the block the Blocks view moved on to, brought into view.
  // Instant, since the page has only just been drawn. (The full-page
  // screenshot does its own, once it knows its size.)
  const ready = Boolean(blocks?.length) && !capture;
  useEffect(() => {
    if (!ready) return;
    if (restore !== null) return void scroller.current?.scrollTo({ top: restore });
    if (focus <= 0) return;
    const el = scroller.current?.querySelector(`[data-at="${focus}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [ready, focus, restore]);

  return (
    <div ref={scroller} data-page-scroll className="min-h-0 flex-1 overflow-auto bg-muted/40 px-3 py-4 min-[700px]:px-10 min-[700px]:py-8 [scrollbar-width:thin]">
      <div
        className={cn(
          "mx-auto max-w-full overflow-hidden bg-background shadow-xl",
          mobile ? "rounded-[28px] ring-1 ring-border" : "rounded-lg ring-1 ring-border",
        )}
        style={{ width: thumbOnly && !mobile ? "fit-content" : `min(100%, ${capture ? (mobile ? PHONE_W : DESKTOP_MAX) : width}px)` }}
      >
        {capture ? (
          // Not waiting for the blocks: they only say what a click opens.
          <PageCapture
            shots={shots?.length ? shots : null}
            files={files}
            thumb={thumb}
            label={label}
            mobile={mobile}
            blocks={blocks ?? []}
            focus={focus}
            restore={restore}
            onBlock={open}
            onMissing={() => setNoCapture(true)}
          />
        ) : blocks === null ? (
          <div className="shimmer bg-muted" style={{ aspectRatio: mobile ? "9 / 19" : "16 / 20" }} aria-busy="true" aria-label="Loading the page" />
        ) : blocks.length > 0 ? (
          <BlockStack blocks={blocks} pageW={pageW} onBlock={open} />
        ) : thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(thumb)} alt={label} className={cn("block h-auto", mobile ? "w-full" : "max-w-full")} />
        ) : (
          <p className="p-8 text-center text-[13px] text-muted-foreground">Nothing captured at this viewport.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The full-page screenshot: one file, or the slices of a page taller than
 * WebP allows, one under the other, each across the frame at its own shape.
 * It is the page as captured, so what sits side by side stays side by side.
 *
 * With `shots` the files and their sizes are known. Without, they are found
 * from the thumbnail's address (`files`): the whole image first and, if that
 * is not there, slice after slice until one is missing, each asked for once
 * the one above has arrived. Which of the two it was is remembered
 * (captureForm). Nothing blurry stands in while it loads: a shimmer the
 * shape of a page lies under it until the first file is painted, so the page
 * only ever appears sharp. `onMissing` when there is no full-size screenshot
 * after all.
 *
 * A click opens the block at that height in the block viewer; coming back
 * from it, the page returns to `restore`, where it was scrolled to, or, when
 * the Blocks view moved on to another block, brings that one (`focus`) into view.
 */
function PageCapture({
  shots,
  files,
  thumb,
  label,
  mobile,
  blocks,
  focus,
  restore,
  onBlock,
  onMissing,
}: {
  shots: Shot[] | null;
  files: { whole: string; slice: (n: number) => string } | null;
  /** The thumbnail's address: what the screenshot's form is remembered by. */
  thumb: string | null;
  label: string;
  mobile: boolean;
  blocks: Block[];
  focus: number;
  restore: number | null;
  onBlock: (at: number) => void;
  onMissing: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Finding the files: whole or sliced, how many slices so far, and whether the last has been found.
  const [found, setFound] = useState(() => ({ sliced: Boolean(thumb && captureForm.get(thumb) === "sliced"), count: 1, last: false }));
  // The first file has arrived (the page has its height), and it can be painted (the shimmer under it can go).
  const [arrived, setArrived] = useState(false);
  const [seen, setSeen] = useState(false);
  const list: { src: string; w?: number; h?: number }[] =
    shots ?? (files ? (found.sliced ? Array.from({ length: found.count }, (_, n) => ({ src: files.slice(n) })) : [{ src: files.whole }]) : []);

  const loaded = (n: number, img: HTMLImageElement) => {
    if (n === 0) {
      setArrived(true);
      if (thumb && !shots) captureForm.set(thumb, found.sliced ? "sliced" : "whole");
      // The shimmer goes once the file can be painted, not when it arrives: a
      // page this size takes a moment to decode, and until then there would
      // be a blank page.
      img.decode().then(() => setSeen(true), () => setSeen(true));
    }
    if (!shots && found.sliced && !found.last && n === found.count - 1) setFound({ ...found, count: found.count + 1 });
  };
  const failed = (n: number) => {
    if (shots) return void (n === 0 && onMissing());
    if (!found.sliced) setFound({ sliced: true, count: 1, last: false });
    else if (n === 0) onMissing();
    else setFound({ sliced: true, count: n, last: true });
  };

  /** The page's drawn size, and CSS pixels of the page per pixel on screen. */
  const measure = () => {
    const el = box.current;
    const first = el?.querySelector("img[data-shot]") as HTMLImageElement | null;
    if (!el || !first?.naturalWidth) return null;
    const rect = el.getBoundingClientRect();
    const perPixel = first.naturalWidth / CAPTURE_SCALE / rect.width;
    return { el, rect, perPixel, pageHeight: rect.height * perPixel };
  };

  // Back from the Blocks view, once the page has a size: where the page was
  // left, or the block the Blocks view moved on to, brought into view.
  useEffect(() => {
    if (!seen) return;
    const m = measure();
    const view = m?.el.closest("[data-page-scroll]");
    if (!m || !view) return;
    if (restore !== null) return void view.scrollTo({ top: restore });
    if (focus <= 0 || blocks.length === 0) return;
    const top = blockTop(blocks, focus, m.pageHeight) / m.perPixel;
    view.scrollTo({ top: Math.max(0, m.rect.top - view.getBoundingClientRect().top + view.scrollTop + top - 24) });
    // Only on arriving: `blocks` does not change while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, focus, restore]);

  const clickable = blocks.length > 0;
  return (
    <div
      ref={box}
      aria-busy={!seen}
      className={cn("relative bg-white", clickable && "cursor-zoom-in")}
      // The shape of a page until the first file gives it its own height.
      style={arrived ? undefined : { aspectRatio: mobile ? "9 / 19" : "16 / 20" }}
      title={clickable ? "Click to open the block here" : undefined}
      onClick={(e) => {
        const m = clickable ? measure() : null;
        if (!m) return;
        const at = blockAt(blocks, (e.clientY - m.rect.top) * m.perPixel, m.pageHeight);
        if (at >= 0) onBlock(at);
      }}
    >
      {/* Under the screenshot, which paints over it as it comes in. */}
      {!seen && <div className="shimmer absolute inset-0 bg-muted" aria-hidden />}
      <div className="relative">
        {list.map((shot, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={shot.src}
            data-shot
            src={assetUrl(shot.src)}
            alt={n === 0 ? label : ""}
            width={shot.w}
            height={shot.h}
            loading={n === 0 ? "eager" : "lazy"}
            decoding="async"
            onLoad={(e) => loaded(n, e.currentTarget)}
            onError={() => failed(n)}
            className="block h-auto w-full"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The page rebuilt from its blocks, top to bottom, each a button into the
 * block viewer: for a page with no full-page screenshot. A block narrower
 * than the page keeps its share of the width, centred on its own background,
 * instead of being stretched across it, and each screenshot takes its file's
 * shape, every slice of a tall one included (see shotsOf).
 */
function BlockStack({ blocks, pageW, onBlock }: { blocks: Block[]; pageW: number; onBlock: (at: number) => void }) {
  return (
    // White under everything, as in a browser: a block with no background of its own is not left on the app's.
    <ol aria-label="Blocks on this page" className="bg-white">
      {blocks.map((block, i) => (
        <li key={block.id} style={{ background: block.bg }}>
          <button
            type="button"
            data-at={i}
            onClick={() => onBlock(i)}
            aria-label={`${labelFor(block.typeHint)}, block ${i + 1} of ${blocks.length}: open it`}
            className="group relative mx-auto block cursor-zoom-in outline-none"
            style={{ width: `${Math.min(100, (block.w / pageW) * 100)}%` }}
          >
            {shotsOf(block).map((piece, n) => (
              <ShotImage key={piece.src} shot={piece} eager={i < 3 && n === 0} optional={n > 0} />
            ))}
            {/* Which block a click opens: an outline and its name. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-primary ring-inset transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <span className="absolute top-2 left-2 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-sm">
                {labelFor(block.typeHint)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * One file of a block's screenshot, across the block's width at the file's
 * own shape: `w` and `h` hold its place until it loads, and after that the
 * picture's real proportions win, so a capture whose recorded size is off is
 * never squashed or stretched to fit it. An `optional` file (a slice past the
 * first, worked out rather than listed) takes no room if it is not there.
 */
function ShotImage({ shot, eager, optional }: { shot: Shot; eager: boolean; optional: boolean }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl(shot.src)}
      alt=""
      width={shot.w}
      height={shot.h}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={optional ? () => setMissing(true) : undefined}
      className="block h-auto w-full"
    />
  );
}
