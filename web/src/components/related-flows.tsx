"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { cn } from "@/lib/utils";
import { loadRelatedFlows, type RelatedFlow } from "@/lib/load-blocks";
import { PAGE_TYPE_LABEL } from "@/lib/blocks";
import { industryLabel, platformLabel, type Store } from "@/lib/stores";
import type { Viewport } from "@/lib/flows";

/** Each step's thumbnail is cut to this shape (height over width): a page's top, or a phone. */
const THUMB_RATIO: Record<Viewport, number> = { desktop: 4 / 3, mobile: 2 };

/** A card's place in the row: most of a phone's width, so the next card shows; a grid cell from sm up. */
const CARD_SLOT = "w-[min(320px,82vw)] shrink-0 snap-start sm:w-auto";

/**
 * The foot of a store's flow page: other stores' flows to compare it with,
 * ranked by what they share with it (see loadRelatedFlows). Each card shows
 * its store, its four steps and why it is here, and opens that store's flow,
 * keeping the viewport when one was picked (?v=). Nothing shows when no other store has a flow.
 */
export function RelatedFlows({ store, viewport, picked }: { store: Store; viewport: Viewport; picked: Viewport | null }) {
  const [state, setState] = useState<{ host: string; list: RelatedFlow[] } | null>(null);

  useEffect(() => {
    let alive = true;
    loadRelatedFlows(store).then(
      (list) => alive && setState({ host: store.host, list }),
      () => alive && setState({ host: store.host, list: [] }),
    );
    return () => {
      alive = false;
    };
  }, [store]);

  const loading = !state || state.host !== store.host;
  if (!loading && state.list.length === 0) return null;

  return (
    <section aria-labelledby="related-flows" className="mt-4 flex flex-col gap-4 border-t pt-8">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="related-flows" className="font-heading text-[18px] leading-tight font-semibold">
            Related flows
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Stores like {store.brand}, matched on industry, platform and theme. Compare how they take a shopper from home to
            cart.
          </p>
        </div>
        <Link
          href="/flows"
          className="group inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring underline-offset-4 touch:-my-3 touch:h-11"
        >
          Every flow <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      </header>

      {/* On phones the cards swipe sideways, the next one peeking in, as the strip above does; from sm up, a grid. */}
      <ul
        className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
        aria-busy={loading || undefined}
      >
        {loading
          ? Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} viewport={viewport} />)
          : state.list.map((item) => (
              <li key={item.summary.store.host} className={CARD_SLOT}>
                <FlowCard item={item} viewport={viewport} picked={picked} />
              </li>
            ))}
      </ul>
    </section>
  );
}

/** One related store: who it is, its four steps, and what it shares with this one. */
function FlowCard({ item, viewport, picked }: { item: RelatedFlow; viewport: Viewport; picked: Viewport | null }) {
  const { store, flow } = item.summary;
  const ratio = THUMB_RATIO[viewport];
  const href = `/sites/${encodeURIComponent(store.host)}/flow${picked ? `?v=${picked}` : ""}`;
  const tags = sharedTags(item);

  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-3 transition-[border-color,box-shadow,translate] duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center gap-2.5">
        <StoreIcon host={store.host} brand={store.brand} size={32} className="rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold group-hover:text-link">{store.brand}</p>
          <p className="truncate font-mono text-[10.5px] text-muted-foreground">{store.host}</p>
        </div>
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-150 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>

      <ol aria-label={`${store.brand} flow`} className="grid grid-cols-4 gap-1.5">
        {flow.steps.map((step) => {
          const page = step.pages[0];
          const src = page ? (viewport === "mobile" ? (page.mobile ?? page.desktop) : (page.desktop ?? page.mobile)) : null;
          const blocks = page
            ? viewport === "mobile"
              ? page.mobileBlocks.length
                ? page.mobileBlocks
                : page.desktopBlocks
              : page.desktopBlocks.length
                ? page.desktopBlocks
                : page.mobileBlocks
            : [];
          return (
            <li key={step.type} className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  "relative block overflow-hidden border",
                  viewport === "mobile" ? "rounded-[10px]" : "rounded-md",
                  page ? "bg-muted" : "border-dashed bg-transparent",
                )}
                style={{ aspectRatio: `1 / ${ratio}` }}
              >
                {page && <Stack src={src} blocks={blocks} ratio={ratio} />}
              </span>
              <span className={cn("relative truncate text-center text-[10px]", page ? "text-foreground" : "text-muted-foreground")}>
                {PAGE_TYPE_LABEL[step.type]}
                {!page && <span className="sr-only">, not captured</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-link">
            {tag}
          </span>
        ))}
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-[10.5px]",
            flow.complete ? "text-muted-foreground" : "text-muted-foreground/80",
          )}
        >
          {flow.complete && <span aria-hidden className="size-1.5 rounded-full bg-signal" />}
          {flow.complete ? "Complete" : `Missing ${flow.missing.map((t) => PAGE_TYPE_LABEL[t].toLowerCase()).join(", ")}`}
        </span>
      </div>
    </Link>
  );
}

/** What the related store has in common with this one, in words; its own platform when nothing matches. */
function sharedTags({ summary, shared }: RelatedFlow): string[] {
  const { store } = summary;
  const tags: string[] = [];
  if (shared.includes("industry")) tags.push(industryLabel(store.industry));
  if (shared.includes("platform") && store.platform) tags.push(platformLabel(store.platform));
  if (shared.includes("theme") && store.theme) tags.push(`${store.theme} theme`);
  if (tags.length === 0 && store.platform) tags.push(platformLabel(store.platform));
  return tags;
}

function CardSkeleton({ viewport }: { viewport: Viewport }) {
  return (
    <li aria-hidden className={cn(CARD_SLOT, "flex flex-col gap-3 rounded-xl border bg-card p-3")}>
      <div className="flex items-center gap-2.5">
        <div className="shimmer size-8 rounded-[9px] bg-muted" />
        <div className="flex flex-col gap-1.5">
          <div className="shimmer h-3 w-24 rounded bg-muted" />
          <div className="shimmer h-2.5 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="shimmer rounded-md bg-muted" style={{ aspectRatio: `1 / ${THUMB_RATIO[viewport]}` }} />
        ))}
      </div>
      <div className="shimmer h-4 w-20 rounded-full bg-muted" />
    </li>
  );
}
