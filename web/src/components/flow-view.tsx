"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Lock, Maximize2, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { ViewportSwitch } from "@/components/viewport-switch";
import { RelatedFlows } from "@/components/related-flows";
import { INSET } from "@/components/block-viewer";
import { cn } from "@/lib/utils";
import { PREVIEW_BLUR, useAccess, usePreviewOnly } from "@/lib/account";
import { assetUrl } from "@/lib/data-source";
import { loadPageBlocks, loadSiteView } from "@/lib/load-blocks";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import { platformLabel } from "@/lib/stores";
import { flowOf, pageView, FLOW_STEPS, type Flow, type FlowStep, type FlowStepType, type PageView, type Viewport } from "@/lib/flows";
import { markReturn } from "@/lib/return-to";
import type { ProfilePage, SiteView } from "@/lib/site-profile";

/** From here up the screens share the row's width; below, the row scrolls sideways a screen at a time. */
const WIDE = "(min-width: 900px)";

/** How much of a page each screen in the strip shows (height over width): a desktop window, or a phone. */
const SCREEN_RATIO: Record<Viewport, number> = { desktop: 10 / 16, mobile: 19 / 9 };

/** A phone's width: in the viewer the mobile page is drawn no wider than this. */
const PHONE_W = 390;

/** The desktop page's width in the viewer when its blocks do not say. */
const DESKTOP_W = 1440;

// Module scope, so useSyncExternalStore does not resubscribe on every render.
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const isWide = () => window.matchMedia(WIDE).matches;
const notWide = () => false;

/** Whether the screens share the row. False on the server, where nothing is drawn yet anyway. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide, notWide);
}

/**
 * Where the person was, saved as they open a block and put back when they
 * return: the page's scroll, which step was open in the viewer and how far
 * down it they were. The viewport and which collection or product is shown
 * live in the URL instead, so Back restores those on its own.
 */
type Place = { y: number; step: FlowStepType | null; scroll: number };
const placeKey = (host: string) => `sectionary:flow-place:${host}`;

function savePlace(host: string, place: Place): void {
  try {
    sessionStorage.setItem(placeKey(host), JSON.stringify(place));
  } catch {
    // Private mode or storage blocked: the flow still works, it just starts at the top.
  }
}

/** The saved place, once: it is removed as it is read. */
function takePlace(host: string): Place | null {
  try {
    const raw = sessionStorage.getItem(placeKey(host));
    sessionStorage.removeItem(placeKey(host));
    return raw ? (JSON.parse(raw) as Place) : null;
  } catch {
    return null;
  }
}

/**
 * A store's flow (SEC-20): home, collection, product and cart, the way a
 * shopper walks the store. Laid out the way Pixlpin and Mobbin lay out a flow:
 * one row of screens, every one the same shape (a desktop window, or a phone),
 * joined by connectors, each showing the top of its page. A screen opens the
 * whole page in a viewer, where the arrows walk from step to step and every
 * block is a link to its detail view. On phones the row scrolls sideways, one
 * screen at a time.
 */
export function FlowView({ host }: { host: string }) {
  const [state, setState] = useState<{ host: string; view: SiteView | null; error: string | null } | null>(null);
  const [open, setOpen] = useState<FlowStepType | null>(null);
  const wide = useWide();

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const picked = params.get("v");
  const markers = params.get("markers") !== "off";

  // The place to go back to, set as the flow loads and spent once it has drawn.
  const restoring = useRef<Place | null>(null);

  useEffect(() => {
    let alive = true;
    loadSiteView(host).then(
      (view) => {
        if (!alive) return;
        const place = takePlace(host);
        restoring.current = place;
        setOpen(place?.step ?? null);
        setState({ host, view, error: null });
      },
      (e: Error) => alive && setState({ host, view: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [host]);

  // Put the page's scroll back once the returning flow has drawn. The viewer
  // takes its own scroll as it mounts (see takeScroll), which React runs
  // before this effect, so the place is spent here.
  useEffect(() => {
    const place = restoring.current;
    if (!state?.view || !place) return;
    restoring.current = null;
    window.scrollTo({ top: place.y });
  }, [state]);

  const flow = useMemo(() => (state?.view ? flowOf(state.view.pages) : null), [state]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  if (!state || state.host !== host) return <FlowSkeleton />;
  if (state.error) return <Empty>This flow could not be loaded ({state.error}).</Empty>;
  if (!state.view || !flow) {
    return (
      <Empty>
        <p className="text-foreground">We have no store at {host}.</p>
        <Link href="/flows" className="mt-3 inline-block rounded-sm text-[13px] text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring touch:py-3">
          Every flow
        </Link>
      </Empty>
    );
  }

  const viewport: Viewport = picked === "desktop" || picked === "mobile" ? picked : wide ? "desktop" : "mobile";
  const { store } = state.view;

  // 1-based in the URL (?collection=2), clamped: a page can drop out of a newer capture.
  const pageAt = (step: FlowStep) => Math.min(Math.max(Number(params.get(step.type)) - 1 || 0, 0), Math.max(step.pages.length - 1, 0));
  const setPageAt = (step: FlowStep, n: number) => setParam(step.type, n === 0 ? null : String(n + 1));

  const openStep = flow.steps.find((s) => s.type === open && s.pages.length > 0) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link
          href={`/sites/${encodeURIComponent(store.host)}`}
          className="inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:-my-3 touch:h-11 touch:pr-3"
        >
          <ArrowLeft className="size-3.5" /> {store.brand}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <StoreIcon key={store.host} host={store.host} brand={store.brand} size={44} className="rounded-xl" />
          {/* The basis lets the switch drop to its own line on phones instead of squeezing the title. */}
          <div className="min-w-0 flex-1 basis-52">
            <h1 className="font-heading text-[22px] leading-tight font-semibold">
              {store.brand} <span className="font-medium text-muted-foreground">flow</span>
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              {store.platform && (
                <>
                  <span className="text-foreground">{platformLabel(store.platform)}</span>
                  <Dot />
                </>
              )}
              <span className="font-mono text-[11px]">{store.host}</span>
              <Dot />
              <span>
                <span className="font-mono tabular-nums">{flow.captured}</span> of {FLOW_STEPS.length} steps captured
              </span>
              <FlowStatus flow={flow} />
            </p>
          </div>
          <ViewportSwitch value={viewport} onChange={(v) => setParam("v", v)} size="sm" />
        </div>
      </header>

      {flow.captured === 0 ? (
        <Empty>Nothing has been captured from this store yet, so it has no flow to show.</Empty>
      ) : (
        <ol
          aria-label="Flow, home to cart"
          className="-mx-3 flex snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain scroll-px-3 px-3 pt-1 pb-4 sm:-mx-4 sm:scroll-px-4 sm:px-4"
        >
          {flow.steps.map((step, i) => (
            <li
              key={step.type}
              className={cn(
                "flex shrink-0 snap-start",
                viewport === "desktop" && "min-[900px]:min-w-[320px] min-[900px]:max-w-[600px] min-[900px]:flex-1",
              )}
            >
              <StepScreen
                step={step}
                number={i + 1}
                host={store.host}
                at={pageAt(step)}
                onAt={(n) => setPageAt(step, n)}
                viewport={viewport}
                onOpen={() => setOpen(step.type)}
              />
              {i < flow.steps.length - 1 && <Connector />}
            </li>
          ))}
        </ol>
      )}

      <RelatedFlows store={store} viewport={viewport} picked={picked === "desktop" || picked === "mobile" ? picked : null} />

      <StepViewer
        flow={flow}
        host={store.host}
        step={openStep}
        at={openStep ? pageAt(openStep) : 0}
        onAt={(n) => openStep && setPageAt(openStep, n)}
        onStep={(type) => setOpen(type)}
        onClose={() => setOpen(null)}
        viewport={viewport}
        onViewport={(v) => setParam("v", v)}
        markers={markers}
        onMarkers={(on) => setParam("markers", on ? null : "off")}
        takeScroll={() => (restoring.current && openStep && restoring.current.step === openStep.type ? restoring.current.scroll : 0)}
        onLeave={(scroll) => savePlace(host, { y: window.scrollY, step: open, scroll })}
      />
    </div>
  );
}

/** Complete, or what is still missing, as a small chip after the count. */
function FlowStatus({ flow }: { flow: Flow }) {
  if (flow.complete) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-link">
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        Complete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Missing {flow.missing.map((t) => PAGE_TYPE_LABEL[t].toLowerCase()).join(", ")}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border">
      ·
    </span>
  );
}

/** The line from one step to the next, level with the middle of the screens. */
function Connector() {
  return (
    <div aria-hidden className="hidden w-8 shrink-0 items-center justify-center self-stretch py-9 min-[900px]:flex">
      <span className="relative block h-px w-full bg-border">
        <ChevronRight className="absolute top-1/2 -right-1 size-3 -translate-y-1/2 text-muted-foreground/70" strokeWidth={2.5} />
      </span>
    </div>
  );
}

/** The step's number: filled when captured, dashed for a gap. */
function StepBadge({ number, captured, className }: { number: number; captured: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums",
        captured ? "bg-primary text-primary-foreground shadow-sm" : "border border-dashed text-muted-foreground",
        className,
      )}
    >
      {number}
    </span>
  );
}

/**
 * One screen of the strip: the step's name and number, then the top of its
 * page in a frame the shape of the viewport, then its path and block count.
 * The frame is a button into the viewer. A step with several pages (two
 * collections, say) pages through them in the header.
 */
function StepScreen({
  step,
  number,
  host,
  at,
  onAt,
  viewport,
  onOpen,
}: {
  step: FlowStep;
  number: number;
  host: string;
  /** Which of the step's pages is shown. */
  at: number;
  onAt: (n: number) => void;
  viewport: Viewport;
  onOpen: () => void;
}) {
  const label = PAGE_TYPE_LABEL[step.type] ?? step.type;
  const page = step.pages[at] ?? null;
  const path = page ? pathOf(page) : null;
  const shown = page ? pageView(page, viewport) : null;
  // The frame follows the switch, not the capture: a desktop-only page still
  // sits in a phone frame on Mobile, with a note saying what it is.
  const mobile = viewport === "mobile";

  return (
    <article
      aria-label={`Step ${number}, ${label}`}
      className={cn(
        "flex min-w-0 flex-col gap-2",
        mobile ? "w-[220px] min-[900px]:w-[236px]" : "w-[min(360px,calc(100vw-3.5rem))] min-[900px]:w-auto min-[900px]:min-w-0 min-[900px]:flex-1",
      )}
    >
      <div className="flex min-h-7 items-center gap-2">
        <StepBadge number={number} captured={Boolean(page)} />
        <h2 className={cn("truncate text-[14px] font-semibold", !page && "text-muted-foreground")}>{label}</h2>
        {step.pages.length > 1 && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={`Previous ${label.toLowerCase()}`} disabled={at === 0} onClick={() => onAt(at - 1)}>
              <ChevronLeft />
            </Button>
            {/* A phone-shaped card is narrow: "1/2" there, "1 of 2" where there is room. */}
            <span className={cn("text-center font-mono text-[11px] text-muted-foreground tabular-nums", mobile ? "min-w-6" : "min-w-9")}>
              {at + 1}
              {mobile ? "/" : " of "}
              {step.pages.length}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={`Next ${label.toLowerCase()}`} disabled={at === step.pages.length - 1} onClick={() => onAt(at + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {!page || !shown ? (
        <Screen viewport={viewport} host={host} path="" dashed>
          <span className="flex h-full items-center justify-center p-5 text-center">
            <span className="max-w-44 text-[12px] text-muted-foreground">
              Not captured
              {step.type === "cart" ? ": cart is captured when the store's robots.txt lets us in." : " for this store."}
            </span>
          </span>
        </Screen>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open the ${label.toLowerCase()} page, ${shown.viewport}`}
          className={cn(
            "group relative block w-full cursor-zoom-in text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            mobile ? "rounded-[26px]" : "rounded-xl",
          )}
        >
          <Screen viewport={viewport} host={host} path={path ?? "/"}>
            <Stack src={shown.full} blocks={shown.blocks} ratio={SCREEN_RATIO[viewport]} />
            {/* The page goes on below the frame: a soft edge says so. */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/15 to-transparent" />
            {shown.fallback && (
              <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                {shown.viewport === "desktop" ? "Desktop" : "Mobile"} only
              </span>
            )}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-3 flex translate-y-1 justify-center opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-lg">
                <Maximize2 className="size-3.5" /> Open page
              </span>
            </span>
          </Screen>
        </button>
      )}

      <div className="flex min-h-5 items-center gap-2 px-0.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {page && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {page.blockCount} block{page.blockCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * The frame a screen sits in: a browser window with a title bar on Web, a
 * phone with a bezel on Mobile. Both the same shape for every step, so the
 * row reads as one flow. Dashed for a step with nothing in it.
 */
function Screen({ viewport, host, path, dashed, children }: { viewport: Viewport; host: string; path: string; dashed?: boolean; children: React.ReactNode }) {
  const lift = "transition-[border-color,box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/60 group-hover:shadow-lg";
  if (viewport === "mobile") {
    return (
      <span
        className={cn(
          "block w-full overflow-hidden rounded-[26px] border-[3px] shadow-sm",
          dashed ? "border-dashed border-border bg-transparent shadow-none" : cn("border-foreground/15 bg-card", lift),
        )}
      >
        <span className={cn("relative block overflow-hidden rounded-[22px]", dashed ? "bg-transparent" : "bg-muted")} style={{ aspectRatio: `1 / ${SCREEN_RATIO.mobile}` }}>
          {children}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("block w-full overflow-hidden rounded-xl border bg-card shadow-sm", dashed ? "border-dashed bg-transparent shadow-none" : lift)}>
      <span className={cn("flex h-7 items-center gap-1.5 border-b px-2.5", dashed ? "border-dashed" : "bg-muted/60")} aria-hidden>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn("size-2 rounded-full", dashed ? "border border-dashed" : "bg-border")} />
          ))}
        </span>
        {!dashed && (
          <span className="ml-1 min-w-0 flex-1 truncate rounded-md bg-background/80 px-2 py-0.5 text-center font-mono text-[10px] leading-4 text-muted-foreground">
            {host}
            {path === "/" ? "" : path}
          </span>
        )}
      </span>
      <span className={cn("relative block", dashed ? "bg-transparent" : "bg-muted")} style={{ aspectRatio: `1 / ${SCREEN_RATIO.desktop}` }}>
        {children}
      </span>
    </span>
  );
}

/**
 * A step's page, whole, in the window the page viewer uses: the page top to
 * bottom at its own width (or the window's, if narrower), a phone-shaped frame
 * on Mobile, every block a link to its detail view. The footer walks from
 * step to step; so do the arrow keys.
 */
function StepViewer({
  flow,
  host,
  step,
  at,
  onAt,
  onStep,
  onClose,
  viewport,
  onViewport,
  markers,
  onMarkers,
  takeScroll,
  onLeave,
}: {
  flow: Flow;
  host: string;
  /** The open step; null keeps the window closed. */
  step: FlowStep | null;
  at: number;
  onAt: (n: number) => void;
  onStep: (type: FlowStepType) => void;
  onClose: () => void;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  markers: boolean;
  onMarkers: (on: boolean) => void;
  /** How far down the page to start, coming back from a block; asked once as the window opens. */
  takeScroll: () => number;
  /** Called as a block link is followed, with how far down the page the reader was. */
  onLeave: (scroll: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const show = Boolean(step);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) {
      d.showModal();
      // Close, not the first control: the arrow keys then walk the steps
      // rather than the Web / Mobile switch.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!show && d.open) d.close();
  }, [show]);

  // The captured steps, in order: the arrows skip a gap.
  const captured = flow.steps.filter((s) => s.pages.length > 0);
  const index = step ? captured.findIndex((s) => s.type === step.type) : -1;
  const prev = index > 0 ? captured[index - 1] : null;
  const next = index >= 0 && index < captured.length - 1 ? captured[index + 1] : null;

  const page = step?.pages[at] ?? null;
  const label = step ? (PAGE_TYPE_LABEL[step.type] ?? step.type) : "";
  const number = step ? flow.steps.indexOf(step) + 1 : 0;

  return (
    <dialog
      ref={ref}
      aria-label={step ? `${label} page, step ${number} of ${FLOW_STEPS.length}, from ${host}` : "Page"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && prev) onStep(prev.type);
        if (e.key === "ArrowRight" && next) onStep(next.type);
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      {step && page && (
        <Window
          key={`${step.type}:${at}`}
          page={page}
          host={host}
          label={label}
          number={number}
          pages={step.pages.length}
          at={at}
          onAt={onAt}
          prev={prev}
          next={next}
          onStep={onStep}
          onClose={onClose}
          viewport={viewport}
          onViewport={onViewport}
          markers={markers}
          onMarkers={onMarkers}
          takeScroll={takeScroll}
          onLeave={onLeave}
        />
      )}
    </dialog>
  );
}

function Window({
  page,
  host,
  label,
  number,
  pages,
  at,
  onAt,
  prev,
  next,
  onStep,
  onClose,
  viewport: wanted,
  onViewport,
  markers,
  onMarkers,
  takeScroll,
  onLeave,
}: {
  page: ProfilePage;
  host: string;
  label: string;
  number: number;
  /** How many pages the step has, and which this is. */
  pages: number;
  at: number;
  onAt: (n: number) => void;
  prev: FlowStep | null;
  next: FlowStep | null;
  onStep: (type: FlowStepType) => void;
  onClose: () => void;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  markers: boolean;
  onMarkers: (on: boolean) => void;
  takeScroll: () => number;
  onLeave: (scroll: number) => void;
}) {
  const access = useAccess();
  const scroller = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const path = pathOf(page);

  // An API page comes as a full-page screenshot; its blocks are fetched on
  // request, as the site profile does, so every section becomes a link. The
  // screenshot shows meanwhile, and stays if the blocks cannot be had (a
  // failure counts as fetched with none, so the page is still "ready").
  const [fetched, setFetched] = useState<{ key: string; desktop: Block[]; mobile: Block[] } | null>(null);
  const needsBlocks = page.blockCount > 0 && page.desktopBlocks.length === 0 && page.mobileBlocks.length === 0;
  useEffect(() => {
    if (!needsBlocks) return;
    let alive = true;
    loadPageBlocks(host, page.url).then(
      ({ desktop, mobile }) => alive && setFetched({ key: page.key, desktop, mobile }),
      () => alive && setFetched({ key: page.key, desktop: [], mobile: [] }),
    );
    return () => {
      alive = false;
    };
  }, [needsBlocks, host, page.url, page.key]);
  const ready = !needsBlocks || fetched?.key === page.key;
  const withBlocks = fetched?.key === page.key ? { ...page, desktopBlocks: fetched.desktop, mobileBlocks: fetched.mobile } : page;
  const shown = pageView(withBlocks, wanted);

  // The place to go back to, read once as the window first draws: the flow
  // spends it in an effect, so reading it in one here could come too late (and
  // React runs effects twice in development).
  const [initialScroll] = useState(takeScroll);

  // Focus on Close as the window opens. A step change draws a new window, and
  // without this the arrow keys would stop stepping.
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  // Back from a block: the same place down the page. Not until the page is
  // drawn at full height (its blocks in, for an API page; their frames take
  // their size from the blocks' known dimensions) and the dialog is open: it
  // opens in the parent's effect, after this one, and a closed dialog cannot
  // scroll. So the next frame.
  useEffect(() => {
    if (!ready || !initialScroll) return;
    const frame = requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = initialScroll;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, initialScroll]);

  const mobile = shown?.viewport === "mobile";
  const native = shown?.blocks[0]?.w ?? (mobile ? PHONE_W : DESKTOP_W);
  const width = mobile ? Math.min(native, PHONE_W) : native;
  const both = Boolean((withBlocks.desktop || withBlocks.desktopBlocks.length) && (withBlocks.mobile || withBlocks.mobileBlocks.length));

  const switches = (
    <>
      {both && <ViewportSwitch value={shown?.viewport ?? wanted} onChange={onViewport} size="sm" />}
      <Button variant="outline" size="sm" active={markers} aria-pressed={markers} onClick={() => onMarkers(!markers)}>
        <Tag className="size-3.5" /> Markers
      </Button>
    </>
  );

  const stepLink = (to: FlowStep | null, side: "prev" | "next") => {
    const name = to ? (PAGE_TYPE_LABEL[to.type] ?? to.type) : null;
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={!to}
        aria-label={to ? `${side === "prev" ? "Previous" : "Next"} step, ${name}` : undefined}
        onClick={() => to && onStep(to.type)}
        className={cn("min-w-0", side === "next" && "flex-row-reverse")}
      >
        {side === "prev" ? <ChevronLeft /> : <ChevronRight />}
        <span className="truncate">{name ?? (side === "prev" ? "Start" : "End")}</span>
      </Button>
    );
  };

  return (
    <div className={cn("relative flex h-dvh flex-col bg-card text-card-foreground shadow-2xl min-[700px]:rounded-2xl min-[700px]:border", INSET)}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 min-[700px]:h-16 min-[700px]:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <StepBadge number={number} captured className="size-8 text-[13px]" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-heading text-[17px] font-semibold min-[700px]:text-[19px]">{label}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {host}
              {path === "/" ? "" : path}
            </span>
          </span>
        </div>
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
            ref={close}
            type="button"
            data-autofocus
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
        {shown?.fallback && (
          <p className="border-b bg-muted/40 px-3 py-1.5 text-center text-[11px] text-muted-foreground min-[700px]:px-5">
            Only the {shown.viewport} page was captured.
          </p>
        )}
        <div
          ref={scroller}
          role="region"
          aria-label={`${label} page, ${shown?.viewport ?? wanted}`}
          className="min-h-0 flex-1 overflow-auto bg-muted/40 px-3 py-4 min-[700px]:px-10 min-[700px]:py-8"
        >
          <div
            className={cn("mx-auto overflow-hidden bg-background shadow-xl ring-1 ring-border", mobile ? "rounded-[28px]" : "rounded-lg")}
            style={{ width: `min(100%, ${width}px)` }}
          >
            {shown ? (
              <PageBody page={page} shown={shown} markers={markers} onLeave={() => onLeave(scroller.current?.scrollTop ?? 0)} />
            ) : (
              <p className="p-8 text-center text-[13px] text-muted-foreground">Nothing captured at this viewport.</p>
            )}
          </div>
        </div>

        <footer className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t px-2 py-2 text-[13px] min-[700px]:px-4">
          <div className="flex justify-start">{stepLink(prev, "prev")}</div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="whitespace-nowrap">
              Step <span className="font-mono tabular-nums">{number}</span> of {FLOW_STEPS.length}
            </span>
            {pages > 1 && (
              <>
                <Dot />
                <span className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Previous ${label.toLowerCase()}`} disabled={at === 0} onClick={() => onAt(at - 1)}>
                    <ChevronLeft />
                  </Button>
                  <span className="min-w-9 text-center font-mono text-[11px] tabular-nums">
                    {at + 1} of {pages}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Next ${label.toLowerCase()}`} disabled={at === pages - 1} onClick={() => onAt(at + 1)}>
                    <ChevronRight />
                  </Button>
                </span>
              </>
            )}
            {shown && shown.blocks.length > 0 && (
              <span className="hidden items-center gap-2 sm:flex">
                <Dot />
                <span className="font-mono text-[11px] tabular-nums">
                  {shown.blocks.length} block{shown.blocks.length === 1 ? "" : "s"}
                </span>
                <span className="hidden lg:inline">· Click a block to open it</span>
              </span>
            )}
          </div>
          <div className="flex justify-end">{stepLink(next, "next")}</div>
        </footer>
      </div>
    </div>
  );
}

/**
 * The page, top to bottom. With blocks, each is a link to its detail view and
 * carries a numbered marker; without, the full-page screenshot stands in.
 */
function PageBody({ page, shown, markers, onLeave }: { page: ProfilePage; shown: PageView; markers: boolean; onLeave: () => void }) {
  // Signed out, or Free after the trial: blurred, like the wall; each block still opens in full.
  const preview = usePreviewOnly();
  if (shown.blocks.length === 0 && shown.full) {
    const alt = `${page.title ?? PAGE_TYPE_LABEL[page.type] ?? page.type}, ${shown.viewport}`;
    return (
      <div className="overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(shown.full)} alt={alt} loading="lazy" className={cn("block w-full", preview && PREVIEW_BLUR)} />
      </div>
    );
  }

  return (
    <ol aria-label="Blocks on this page" className="bg-card">
      {shown.blocks.map((b, i) => {
        const name = labelFor(b.typeHint);
        return (
          <li key={b.id}>
            <Link
              href={`/?open=${encodeURIComponent(b.id)}`}
              onClick={() => {
                onLeave();
                markReturn(b.id);
              }}
              className="group relative block overflow-hidden border-t border-black/10 outline-none first:border-t-0"
              style={{ aspectRatio: `${b.w} / ${b.h}`, background: b.bg }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetUrl(b.src)}
                alt=""
                width={b.w}
                height={b.h}
                loading={i < 3 ? "eager" : "lazy"}
                decoding="async"
                className={cn("block h-full w-full", preview && PREVIEW_BLUR)}
              />
              {/* Where the block starts and ends, on hover or focus. */}
              <span className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-primary ring-inset transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
              {/* The marker names the link, so what is read out is what is shown. */}
              {markers ? (
                <span className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums shadow-sm group-hover:bg-primary group-hover:text-primary-foreground group-focus-visible:bg-primary group-focus-visible:text-primary-foreground">
                  {i + 1} · {name}
                  <span className="sr-only"> block, open its detail</span>
                </span>
              ) : (
                <span className="sr-only">
                  {i + 1} · {name} block, open its detail
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const pathOf = (page: ProfilePage) => page.url.replace(/^https?:\/\/[^/]+/, "") || "/";

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** The flow's shape with nothing in it, so nothing jumps when it loads. */
export function FlowSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading flow">
      <div className="flex flex-col gap-3">
        <div className="shimmer h-3 w-20 rounded bg-muted" />
        <div className="flex items-center gap-3">
          <div className="shimmer size-11 rounded-xl bg-muted" />
          <div className="flex flex-col gap-2">
            <div className="shimmer h-5 w-48 rounded bg-muted" />
            <div className="shimmer h-3 w-64 rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="-mx-3 flex gap-4 overflow-hidden px-3 pt-1 pb-4 sm:-mx-4 sm:px-4">
        {FLOW_STEPS.map((s, i) => (
          <div key={s} className="flex shrink-0 min-[900px]:min-w-[320px] min-[900px]:max-w-[600px] min-[900px]:flex-1">
            <div className="flex w-[min(360px,calc(100vw-3.5rem))] flex-col gap-2 min-[900px]:w-auto min-[900px]:min-w-0 min-[900px]:flex-1">
              <div className="flex min-h-7 items-center gap-2">
                <div className="shimmer size-6 rounded-full bg-muted" />
                <div className="shimmer h-3.5 w-24 rounded bg-muted" />
              </div>
              <div className="shimmer rounded-xl bg-muted" style={{ aspectRatio: `1 / ${SCREEN_RATIO.desktop + 0.08}` }} />
              <div className="shimmer h-3 w-32 rounded bg-muted" />
            </div>
            {i < FLOW_STEPS.length - 1 && <div className="hidden w-8 shrink-0 min-[900px]:block" />}
          </div>
        ))}
      </div>
    </div>
  );
}
