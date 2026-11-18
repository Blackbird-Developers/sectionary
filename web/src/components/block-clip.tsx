"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assetUrl } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/blocks";

/** How the screenshot under the clip is drawn: at the box's width, cropped from the top, or whole and centred. */
type Fit = "width" | "cover" | "contain";

/**
 * A block's recording over its screenshot. The crawler records blocks that move
 * by themselves (hero videos, slideshows, marquees: Block.clip) and the
 * screenshot is the clip's poster. The video is drawn over exactly the part of
 * the block that was recorded (clip.rect), at the size the screenshot is shown,
 * and fades in only once it is really playing, so nothing flickers or shifts.
 *
 * When it plays:
 * - "hover" (wall cards): while `active`, the card hovered or focused. On a
 *   touch screen, where nothing hovers, while the card is mostly on screen, one
 *   card at a time.
 * - "view" (the block viewer, a page opened in Flows): while it is mostly on screen.
 * Never when the system asks for reduced motion or Save-Data is on: the
 * screenshot stays. The MP4 is not fetched until the clip first plays.
 * `hidden` (a blurred preview) draws nothing, so a clip never shows what the
 * preview blurs.
 *
 * Put it inside the screenshot's box (position: relative), after the image.
 */
export function BlockClip({
  block,
  active = false,
  mode = "hover",
  fit = "width",
  hidden = false,
  className,
}: {
  block: Block;
  active?: boolean;
  mode?: "hover" | "view";
  fit?: Fit;
  hidden?: boolean;
  /** For the box over the screenshot, e.g. the same hover scale as the image so the two stay aligned. */
  className?: string;
}) {
  const clip = hidden ? undefined : block.clip;
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [me] = useState(() => Symbol("clip"));
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [inView, setInView] = useState(false);
  // Fetched only once the clip first plays, then kept for the next hover.
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const reduced = useMedia(REDUCED);
  const hoverable = useMedia(HOVER);
  const touchTurn = useSyncExternalStore(onTouchTurn, touchTurnNow, noTurn);
  const touch = mode === "hover" && !hoverable;

  // The box over the screenshot follows it as the card or viewer resizes (or zooms).
  useEffect(() => {
    const el = box.current;
    if (!el || !clip) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clip]);

  // On screen or not: only where it decides anything.
  const watch = Boolean(clip) && (mode === "view" || touch);
  useEffect(() => {
    const el = box.current;
    if (!el || !watch) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    observer.observe(el);
    return () => observer.disconnect();
  }, [watch]);

  // Touch screens: the card that came on screen last has the turn.
  useEffect(() => {
    if (!touch) return;
    if (inView) claimTouchTurn(me);
    else releaseTouchTurn(me);
    return () => releaseTouchTurn(me);
  }, [touch, inView, me]);

  const wants = Boolean(clip) && !reduced && !saveData() && (mode === "view" ? inView : touch ? inView && touchTurn === me : active);
  // The first time it wants to play, the source is set (state from this render, as React recommends over an effect).
  if (wants && !started) setStarted(true);
  const src = started && clip ? assetUrl(clip.src) : null;
  // The video is drawn once the box is measured; playing waits for that too.
  const ready = Boolean(clip && size && block.w > 0 && block.h > 0);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (wants) {
      v.muted = true;
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    }
  }, [wants, src, ready]);

  if (!clip) return null;
  const rect = clip.rect ?? { x: 0, y: 0, w: block.w, h: block.h };
  let place: React.CSSProperties | undefined;
  if (size && block.w > 0 && block.h > 0) {
    const scale = fit === "width" ? size.w / block.w : fit === "cover" ? Math.max(size.w / block.w, size.h / block.h) : Math.min(size.w / block.w, size.h / block.h);
    const left = fit === "width" ? 0 : (size.w - block.w * scale) / 2;
    const top = fit === "contain" ? (size.h - block.h * scale) / 2 : 0;
    place = { left: left + rect.x * scale, top: top + rect.y * scale, width: rect.w * scale, height: rect.h * scale };
  }
  return (
    <div ref={box} aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {place && src && (
        <video
          ref={video}
          src={src}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setPlaying(false)}
          className={cn("absolute object-cover transition-opacity duration-300", playing ? "opacity-100" : "opacity-0")}
          style={place}
        />
      )}
    </div>
  );
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const HOVER = "(hover: hover) and (pointer: fine)";

/** A media query as state, one subscription per query for every clip on the page. */
const mediaStores = new Map<string, { subscribe: (cb: () => void) => () => void; get: () => boolean }>();
function mediaStore(query: string) {
  let store = mediaStores.get(query);
  if (!store) {
    store = {
      subscribe: (cb) => {
        const list = window.matchMedia(query);
        list.addEventListener("change", cb);
        return () => list.removeEventListener("change", cb);
      },
      get: () => window.matchMedia(query).matches,
    };
    mediaStores.set(query, store);
  }
  return store;
}
function useMedia(query: string): boolean {
  const store = mediaStore(query);
  return useSyncExternalStore(store.subscribe, store.get, () => false);
}

function saveData(): boolean {
  return typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

// Touch screens play one card at a time: the last one to come on screen.
let touchHolder: symbol | null = null;
const touchListeners = new Set<() => void>();
function onTouchTurn(cb: () => void): () => void {
  touchListeners.add(cb);
  return () => {
    touchListeners.delete(cb);
  };
}
const touchTurnNow = () => touchHolder;
const noTurn = () => null;
function claimTouchTurn(id: symbol) {
  if (touchHolder === id) return;
  touchHolder = id;
  touchListeners.forEach((cb) => cb());
}
function releaseTouchTurn(id: symbol) {
  if (touchHolder !== id) return;
  touchHolder = null;
  touchListeners.forEach((cb) => cb());
}
