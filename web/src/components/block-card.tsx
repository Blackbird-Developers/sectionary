"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Share } from "lucide-react";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { blurOf, labelFor, thumbOf, type Block } from "@/lib/blocks";
import { StoreIcon } from "@/components/store-icon";
import { SaveToBoard } from "@/components/save-to-board";
import { BlockClip } from "@/components/block-clip";
import { PREVIEW_BLUR, usePreviewOnly } from "@/lib/account";

/**
 * A block on the wall. The frame reserves the block's exact aspect ratio and
 * paints its real background colour, so nothing shifts when the screenshot
 * arrives; the shimmer runs until then and the image fades in over 200 ms.
 *
 * At rest the wall is only screenshots. Hovering or focusing a card brings up
 * three controls over it: the store's mark (to its profile), share, and Save.
 * They never show at rest, on any screen.
 *
 * On the virtualised wall the height is already known (see lib/wall-layout.ts),
 * so it is passed in and the card fills it exactly rather than deriving its own
 * aspect ratio. That keeps the rendered card and the computed layout identical,
 * which is what stops the wall drifting as you scroll. Every card in a row has
 * the same height, so a screenshot taller than its cell is cropped from the
 * top and a shorter one is shown whole, centred on its background colour
 * (`fit`, decided by the layout).
 */
export function BlockCard({
  block,
  onOpen,
  onIntent,
  width,
  height,
  fit = "cover",
  priority = false,
}: {
  block: Block;
  onOpen: (b: Block) => void;
  /** The pointer rests on the card, or it is pressed or focused: a chance to start loading what opening it needs. */
  onIntent?: (b: Block) => void;
  /** The card's width on the wall, which tells the browser which image to fetch. */
  width?: number;
  height?: number;
  fit?: "cover" | "contain";
  /** On the first screen: fetched at once and ahead of the rest, not lazily. */
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  // Hovered or focused: a block that moves plays its clip (BlockClip; touch screens play what is on screen instead).
  const [hovering, setHovering] = useState(false);
  // A pointer passing over on its way somewhere is not intent; one that stays a moment is.
  const rest = useRef(0);
  useEffect(() => () => window.clearTimeout(rest.current), []);
  const intent = () => onIntent?.(block);
  const hover = onIntent
    ? {
        onPointerEnter: () => {
          window.clearTimeout(rest.current);
          rest.current = window.setTimeout(intent, 120);
        },
        onPointerLeave: () => window.clearTimeout(rest.current),
        onPointerDown: intent,
        onFocus: intent,
      }
    : {};
  // The thumbnail first (see thumbOf); the full screenshot if it will not load.
  const [full, setFull] = useState(false);
  const thumb = full ? undefined : thumbOf(block);
  const mobile = block.viewport === "mobile";
  const fixed = height != null;
  const blur = blurOf(block);
  // Signed out, or Free after the trial (gates on): a blurred preview; opening the block shows it in full.
  const preview = usePreviewOnly();
  // Thumbnail or full capture, the browser's choice (see srcSetOf). A blurred
  // preview never needs the full capture.
  const srcSet = thumb && !preview ? srcSetOf(block, thumb) : undefined;
  const fitClass = fit === "contain" ? "object-contain object-center" : "object-cover object-top";
  // A phone-width cell has no room for the host as well; the label and size stay.
  const narrow = width != null && width < 220;
  const kind = labelFor(block.typeHint);
  return (
    <figure
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovering(false);
      }}
      className={cn(
        // No overflow clip here: the Save menu opens out of the card. The screenshot's own frame clips it.
        "group relative rounded-lg border bg-card transition-colors duration-150 hover:border-primary/60",
        fixed ? "flex h-full flex-col" : mobile && "mx-auto max-w-[300px]",
      )}
    >
      {/* The button's ::after stretches over the whole card, so a 26px-tall
          header block is still a full-size tap target. The focus ring is
          drawn on that layer too, round the whole card. */}
      <button
        type="button"
        onClick={() => onOpen(block)}
        {...hover}
        className={cn(
          "block w-full cursor-zoom-in outline-none after:absolute after:inset-0 after:z-10 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset",
          fixed && "min-h-0 flex-1",
        )}
        aria-label={`${kind} block from ${block.host}, ${block.viewport}, ${block.h} pixels tall`}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[calc(var(--radius-lg)-1px)]"
          style={fixed ? { background: block.bg } : { aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}
        >
          {/* The placeholder: a real blur when SEC-9 ships one, the captured
              background colour until then, with the shimmer over it. Both sit
              inside the card's reserved box, so none of this moves anything. */}
          {!loaded && (
            <>
              {blur && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={blur} alt="" aria-hidden className={cn("absolute inset-0 h-full w-full scale-105 blur-lg", fitClass)} />
              )}
              <div className="shimmer absolute inset-0 opacity-70" aria-hidden />
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(thumb ?? block.src)}
            srcSet={srcSet}
            sizes={srcSet && width ? `${Math.round(width * SIZES_FACTOR)}px` : undefined}
            alt=""
            width={block.w}
            height={block.h}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={thumb ? () => setFull(true) : undefined}
            className={cn(
              // Blur to sharp rather than a plain fade, so the screenshot
              // resolves into place. Filter and opacity only: no layout.
              "block h-full w-full transition-[opacity,filter,scale] duration-200 group-hover:scale-[1.02] group-focus-within:scale-[1.02]",
              fitClass,
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-md",
              preview && PREVIEW_BLUR,
            )}
          />
          {/* A block that moves: its clip over the screenshot, playing while the card is hovered. Same scale on hover as the image. */}
          <BlockClip
            block={block}
            active={hovering}
            fit={fixed ? fit : "width"}
            hidden={preview}
            className="transition-[scale] duration-200 group-hover:scale-[1.02] group-focus-within:scale-[1.02]"
          />
          {/* A light veil so the white controls read on a white screenshot. */}
          <div
            className="pointer-events-none absolute inset-0 bg-black/15 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-hidden
          />
        </div>
      </button>

      {/* The controls, above the open-the-block layer, shown only on hover or
          keyboard focus. The
          store's mark goes to its profile (every page, full length), the
          arrow shares this block, Save files it on a board. */}
      <Link
        href={`/sites/${encodeURIComponent(block.host)}`}
        aria-label={`${block.host}: all pages`}
        title={`${block.host} · ${kind}`}
        className={cn(CONTROL, "bottom-2 left-2 size-8 overflow-hidden", REVEAL)}
      >
        {/* The mark at its normal size, with the circle tinted to its edge colour. */}
        <StoreIcon host={block.host} brand={block.host} size={32} fill />
      </Link>
      <ShareControl block={block} kind={kind} className={cn("top-2 right-2", REVEAL)} />
      <div className={cn("absolute right-2 bottom-2 z-20", REVEAL)}>
        <SaveControl block={block} compact={narrow} />
      </div>
    </figure>
  );
}

/**
 * Hidden until the card is hovered or holds keyboard focus, at every width.
 * While hidden they take no clicks either, so a tap on a phone opens the block
 * instead of landing on a button nobody can see; Save and the store are in the
 * block's own view there.
 */
const REVEAL =
  "pointer-events-none opacity-0 transition-[opacity,translate,scale] duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

/** A round white control on the screenshot. */
const CONTROL =
  "absolute z-20 inline-flex items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_rgb(0_0_0/0.12)] outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95";

/** Share this block: the phone's share sheet where there is one, otherwise the link is copied. */
function ShareControl({ block, kind, className }: { block: Block; kind: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/?open=${encodeURIComponent(block.id)}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${kind} from ${block.host}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissed share sheet, or a clipboard the browser will not hand over: nothing to report.
    }
  };
  return (
    <button type="button" onClick={share} aria-label={copied ? "Link copied" : "Share this block"} title={copied ? "Link copied" : "Copy link"} className={cn(CONTROL, "size-8", className)}>
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Share className="size-4" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </button>
  );
}

/**
 * Save on the card. The board list (SaveToBoard) asks the server for the
 * visitor's boards as soon as it mounts, which on a wall of cards would be one
 * request per card; so the card shows a plain button and mounts the real
 * control, already open, only when it is pressed.
 */
function SaveControl({ block, compact }: { block: Block; compact: boolean }) {
  const [armed, setArmed] = useState(false);
  const pill = cn(
    "h-8 rounded-full border-0 bg-white text-[12px] font-semibold text-neutral-900 shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_rgb(0_0_0/0.12)] hover:bg-white hover:scale-105 active:scale-95",
    compact ? "w-8 px-0" : "px-3.5",
  );
  if (armed) return <SaveToBoard block={block} up="end" defaultOpen className={pill} iconOnly={compact} />;
  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      aria-haspopup="dialog"
      aria-label="Save to a board"
      className={cn("inline-flex items-center justify-center gap-1.5 outline-none transition-[scale] duration-150 focus-visible:ring-2 focus-visible:ring-ring", pill)}
    >
      {/* The same bookmark and word the real control shows, so nothing shifts when it takes over. */}
      <Bookmark className="size-4" aria-hidden />
      {!compact && "Save"}
    </button>
  );
}

/**
 * The thumbnail is 600 pixels wide; the full capture is 2x the block's width
 * (2,880 on desktop). Offered both, the browser fetches the thumbnail while a
 * card is small and the full capture once the page is zoomed in or the card
 * is drawn wider, which is when the thumbnail went blurry.
 */
function srcSetOf(block: Block, thumb: string): string {
  return `${assetUrl(thumb)} 600w, ${assetUrl(block.src)} ${block.w * 2}w`;
}

/**
 * `sizes` is declared a little under the card's real width. A wall card is
 * 300 to 340 pixels, so on a 2x screen the 600px thumbnail is 1.75 to 2 image
 * pixels per CSS pixel, which reads sharp; without the margin the browser
 * would skip it for the full capture on every retina screen, at several times
 * the bytes. At 110% zoom and up it takes the full capture.
 */
const SIZES_FACTOR = 0.85;

/**
 * The same frame with nothing in it, for loading states. `fill` takes its
 * cell's full width, as on the grid.
 */
export function BlockCardSkeleton({ ratio, mobile, fill }: { ratio: number; mobile?: boolean; fill?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", mobile && !fill && "mx-auto max-w-[300px]")} aria-hidden>
      <div className="shimmer w-full bg-muted" style={{ aspectRatio: `1 / ${ratio}` }} />
    </div>
  );
}
