"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { cn } from "@/lib/utils";
import { loadFlowPage, loadFlowSummaries } from "@/lib/load-blocks";
import { PAGE_TYPE_LABEL } from "@/lib/blocks";
import { flowCounts, type FlowCounts, type FlowSummary } from "@/lib/flows";
import { BlimpLoader } from "@/components/blimp-loader";

/**
 * Flows per load. From the API each load is one request for the next 40
 * (loadFlowPage); on the sample the whole index is already in the browser and
 * 40 more rows are drawn. More join as the end of the list scrolls into view.
 */
const STEP = 40;

/**
 * What has been loaded. `flows` is the index from its start, in order,
 * complete flows first. `paged` when it arrives a page at a time, and then
 * `ended` says which of the two lists, complete only and all, has no more to
 * ask for. Otherwise `flows` is the whole index.
 */
type Loaded = { flows: FlowSummary[]; counts: FlowCounts; paged: boolean; ended: { complete: boolean; all: boolean } };

/** Step thumbnails are cut to this shape (height over width). */
const THUMB_RATIO = 4 / 3;

/**
 * Every captured store's flow (SEC-20), and the count the task is measured by:
 * stores whose home, collection and product pages are all captured. Complete
 * flows by default; "Show incomplete" lists the rest with what they lack.
 *
 * Counted from /api/sites when NEXT_PUBLIC_SITES_SRC is set (SEC-47), the
 * same source each store's flow page reads, so the two always agree. Without
 * it, from the block set, which every store's blocks pass through.
 *
 * From the API the index loads 40 flows at a time, already in order
 * (`order=flow`), so the first rows do not wait for every store's pages: the
 * whole list is five requests and 2 MB, and took seconds whenever the server
 * had to build it. The counts in the heading come with the first page.
 */
export function FlowsIndex() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The next page: being fetched, or failed (the list stays, with a way to try again). */
  const [next, setNext] = useState<"idle" | "loading" | "failed">("idle");

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const all = params.get("all") === "1";

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    // Always the complete flows first, whatever the toggle says: they open both lists.
    loadFlowPage(false, 0)
      .then(async (page): Promise<Loaded> => {
        if (page) return { flows: page.flows, counts: page.counts, paged: true, ended: { complete: !page.more, all: false } };
        const flows = await loadFlowSummaries();
        return { flows, counts: flowCounts(flows), paged: false, ended: { complete: true, all: true } };
      })
      .then(
        (first) => alive.current && setLoaded(first),
        (e: Error) => alive.current && setError(e.message),
      );
    return () => {
      alive.current = false;
    };
  }, []);

  const list = loaded?.flows ?? null;
  const counts = loaded?.counts ?? { complete: 0, withCart: 0, captured: 0 };
  const shown = useMemo(() => (list ?? []).filter((s) => all || s.flow.complete), [list, all]);
  const incomplete = counts.captured - counts.complete;

  // On the sample the whole index is here: draw it a step at a time. Reset when the toggle changes.
  const [limit, setLimit] = useState({ all, n: STEP });
  const n = limit.all === all ? limit.n : STEP;
  const rows = loaded?.paged ? shown : shown.slice(0, n);
  const paged = loaded?.paged ?? false;
  const loadedCount = list?.length ?? 0;
  // The complete list has ended once an incomplete flow has arrived, too.
  const ended = !loaded || (all ? loaded.ended.all : loaded.ended.complete || loadedCount > shown.length);
  const more = paged ? !ended : n < shown.length;

  /** Asks for the page after what is loaded and adds it to the end. One at a time. */
  const fetching = useRef(false);
  const loadNext = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    setNext("loading");
    loadFlowPage(all, loadedCount).then(
      (page) => {
        fetching.current = false;
        if (!alive.current) return;
        setNext("idle");
        setLoaded((was) => {
          // Not the list this page was asked for (it cannot change under one request, but never add a page twice).
          if (!was || was.flows.length !== loadedCount) return was;
          const done = !page || !page.more;
          const have = new Set(was.flows.map((f) => f.store.host));
          return {
            flows: [...was.flows, ...(page?.flows ?? []).filter((f) => !have.has(f.store.host))],
            counts: page?.counts ?? was.counts,
            paged: true,
            // A page of all of them may still be complete flows: only the end of all ends both.
            ended: all ? { complete: was.ended.complete || done, all: done } : { complete: done, all: was.ended.all },
          };
        });
      },
      () => {
        fetching.current = false;
        if (alive.current) setNext("failed");
      },
    );
  }, [all, loadedCount]);

  // Grow the list as its end comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || next === "failed") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (paged) loadNext();
      else setLimit({ all, n: n + STEP });
    }, { rootMargin: "1200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [all, n, more, paged, next, loadNext, rows.length]);

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (all) next.delete("all");
    else next.set("all", "1");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="font-heading text-[22px] leading-tight font-extrabold tracking-[-0.03em]">Flows</h1>
          <p className="mt-1 text-[13px]" aria-live="polite">
            {list ? (
              <>
                <span className="font-semibold tabular-nums">{counts.complete.toLocaleString("en-US")}</span>{" "}
                {counts.complete === 1 ? "store has" : "stores have"} a complete flow
                <span className="text-muted-foreground">
                  {" "}
                  · {counts.withCart.toLocaleString("en-US")} with cart · {counts.captured.toLocaleString("en-US")} captured
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Counting flows…</span>
            )}
          </p>
          <p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">
            A flow is complete when a store&apos;s home, collection and product pages are captured. Cart joins when the
            store&apos;s robots.txt lets us in.
          </p>
          {list && all && incomplete > 0 && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-md bg-muted px-2.5 py-1 text-[12px]">
              <span>
                Showing all {counts.captured.toLocaleString("en-US")} captured stores, including{" "}
                <span className="font-semibold tabular-nums">{incomplete.toLocaleString("en-US")}</span> incomplete.
              </span>
              <button type="button" onClick={toggle} className="rounded-sm text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                Complete only
              </button>
            </p>
          )}
        </div>
        {list && incomplete > 0 && (
          <Button variant="outline" size="sm" active={all} aria-pressed={all} onClick={toggle}>
            {all && <Check aria-hidden className="size-3.5" strokeWidth={2.5} />}
            {all ? "Showing incomplete" : "Show incomplete"}
            <span className={cn("font-mono text-[11px] tabular-nums", all ? "text-primary-foreground" : "text-muted-foreground")}>
              {incomplete.toLocaleString("en-US")}
            </span>
          </Button>
        )}
      </header>

      {error ? (
        <Empty>The flows could not be loaded ({error}).</Empty>
      ) : !list ? (
        <FlowsSkeleton />
      ) : rows.length === 0 && !more ? (
        <Empty>
          <p className="text-foreground">No store has a complete flow yet.</p>
          {incomplete > 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={toggle}>
              Show the {incomplete.toLocaleString("en-US")} incomplete
            </Button>
          )}
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((summary, i) => {
              // Complete flows sort first, so the incomplete ones start here.
              const firstIncomplete = all && !summary.flow.complete && (i === 0 || rows[i - 1].flow.complete);
              return (
                <li key={summary.store.host} className="flex flex-col gap-2">
                  {firstIncomplete && (
                    <h2 className="mt-4 flex items-baseline gap-2 border-t pt-4 text-[13px] font-semibold">
                      Incomplete flows
                      <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">{incomplete.toLocaleString("en-US")}</span>
                      <span className="text-[12px] font-normal text-muted-foreground">Missing a home, collection or product page</span>
                    </h2>
                  )}
                  <FlowRow summary={summary} />
                </li>
              );
            })}
          </ul>
          {more && <div ref={sentinel} aria-hidden className="h-px" />}
          {more && paged && next !== "failed" && (
            <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading more flows">
              <SkeletonRow />
              <SkeletonRow />
            </ul>
          )}
          {next === "failed" && (
            <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground" role="status">
              The next flows could not be loaded.
              <Button variant="outline" size="sm" onClick={loadNext}>
                Try again
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One store: who it is, then its four steps as thumbnails, gaps dashed. */
function FlowRow({ summary }: { summary: FlowSummary }) {
  const { store, flow } = summary;
  const got = flow.steps.filter((s) => s.pages.length > 0).map((s) => PAGE_TYPE_LABEL[s.type].toLowerCase());
  const gaps = flow.steps.filter((s) => s.pages.length === 0).map((s) => PAGE_TYPE_LABEL[s.type].toLowerCase());
  return (
    <Link
      href={`/sites/${encodeURIComponent(store.host)}/flow`}
      className={cn(
        "group flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors duration-150 outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center",
        !flow.complete && "border-dashed bg-card/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
        <StoreIcon host={store.host} brand={store.brand} size={36} className="rounded-[10px]" />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold group-hover:text-link">{store.brand}</span>
            {!flow.complete && (
              <span className="shrink-0 rounded border border-dashed px-1 font-mono text-[10px] leading-4 text-muted-foreground uppercase">Incomplete</span>
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{store.host}</p>
          {!flow.complete && (
            <p className="text-[12px] text-muted-foreground">
              Missing {flow.missing.map((t) => PAGE_TYPE_LABEL[t].toLowerCase()).join(", ")}
            </p>
          )}
          <span className="sr-only">
            , captured: {got.join(", ")}; not captured: {gaps.join(", ")}
          </span>
        </div>
      </div>
      <ol aria-hidden className="grid flex-1 grid-cols-4 gap-1.5 sm:max-w-md sm:gap-2">
        {flow.steps.map((step) => {
          const page = step.pages[0];
          const blocks = page ? (page.desktopBlocks.length ? page.desktopBlocks : page.mobileBlocks) : [];
          return (
            <li key={step.type} className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  "relative block overflow-hidden rounded-md border",
                  page ? "bg-muted" : "border-dashed bg-transparent",
                )}
                style={{ aspectRatio: `1 / ${THUMB_RATIO}` }}
              >
                {page && <Stack src={page.desktop ?? page.mobile} blocks={blocks} ratio={THUMB_RATIO} />}
              </span>
              <span className={cn("truncate text-center text-[10px]", page ? "text-foreground" : "text-muted-foreground")}>
                {PAGE_TYPE_LABEL[step.type]}
              </span>
            </li>
          );
        })}
      </ol>
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** Rows with nothing in them, so nothing jumps when the index arrives. */
export function FlowsSkeleton() {
  return (
    <div className="relative">
      <BlimpLoader overlay label="Loading flows…" />
      <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading flows">
      {Array.from({ length: 6 }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
      </ul>
    </div>
  );
}

/** One row's outline: while the index loads, and under the list while its next page does. */
function SkeletonRow() {
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center" aria-hidden>
      <div className="flex items-center gap-3 sm:w-64">
        <div className="shimmer size-9 rounded-[10px] bg-muted" />
        <div className="flex flex-col gap-1.5">
          <div className="shimmer h-3 w-28 rounded bg-muted" />
          <div className="shimmer h-3 w-36 rounded bg-muted" />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-1.5 sm:max-w-md sm:gap-2">
        {Array.from({ length: 5 }, (_, j) => (
          <div key={j} className="shimmer rounded-md bg-muted" style={{ aspectRatio: `1 / ${THUMB_RATIO}` }} />
        ))}
      </div>
    </li>
  );
}
