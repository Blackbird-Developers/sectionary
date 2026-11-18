import { cn } from "@/lib/utils";

/**
 * The loading state: the Blimp mark flying, with wind gusts streaming off its
 * tail and a couple of clouds drifting past. No card, no caption on screen:
 * just the mark and the wind (the label is read out to screen readers). Same
 * shape as the logo (nose up at 10 degrees), in the brand blue, which reads on
 * the light and the dark theme alike; the wind and clouds take the theme's
 * muted colour.
 *
 * It only shows for a real wait: it fades in after a short delay
 * (.blimp-appear in globals.css), so something that loads quickly never
 * flashes it. With reduced motion it appears still.
 *
 * `overlay` floats it over a skeleton (the page's shape stays, so nothing
 * jumps when the content arrives); otherwise it takes a block of its own.
 */
export function BlimpLoader({ label = "Loading…", overlay = false, className }: { label?: string; overlay?: boolean; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "blimp-appear flex justify-center",
        overlay ? "pointer-events-none absolute inset-x-0 top-10 z-10" : "min-h-[50vh] items-center py-16",
        className,
      )}
    >
      <BlimpFlying width={180} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * The flying blimp on its own, at any width (height is half): for a small
 * spot such as a button, where the card and the label would not fit.
 */
export function BlimpFlying({ width = 48, className }: { width?: number; className?: string }) {
  return (
    <svg viewBox="0 0 200 100" width={width} height={width / 2} aria-hidden className={cn("shrink-0 overflow-visible text-primary", className)}>
      {/* Clouds, far behind, drifting the other way. */}
      <g className="blimp-cloud text-muted-foreground/25" fill="currentColor">
        <path d="M150 22 a7 7 0 0 1 13 -3 a6 6 0 0 1 9 5 a5 5 0 0 1 0 10 h-21 a6 6 0 0 1 -1 -12 z" />
      </g>
      <g className="blimp-cloud blimp-cloud-slow text-muted-foreground/20" fill="currentColor">
        <path d="M40 78 a6 6 0 0 1 11 -2 a5 5 0 0 1 8 4 a4 4 0 0 1 0 8 h-18 a5 5 0 0 1 -1 -10 z" />
      </g>

      {/* Wind gusts off the tail: dashes that stream back and fade, in the colour of air rather than the brand. */}
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3.6" className="text-muted-foreground">
        <path className="blimp-gust" style={{ animationDelay: "0ms" }} d="M88 38 C72 38 62 32 46 34 S24 40 8 36" />
        <path className="blimp-gust" style={{ animationDelay: "290ms" }} d="M80 49 C64 49 54 47 38 49 S16 52 2 50" />
        <path className="blimp-gust" style={{ animationDelay: "580ms" }} d="M88 61 C72 61 62 67 46 65 S24 59 8 63" />
        <path className="blimp-gust blimp-gust-short" style={{ animationDelay: "870ms" }} d="M84 55 C74 55 66 56 56 55" />
      </g>

      {/* The blimp: the logo's silhouette, bobbing. */}
      <g className="blimp-fly">
        <g transform="translate(84 4) scale(.92) rotate(-10 50 50)" fill="currentColor">
          <path d="M97 50 C97 33 78 25 58 25 C36 25 16 40 5 50 C16 60 36 75 58 75 C78 75 97 67 97 50 Z" />
          <path d="M9 27 L25 24 L36 37 L17 45 Z M9 73 L25 76 L36 63 L17 55 Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <rect x="50" y="78" width="22" height="8" rx="4" />
          {/* A glint along the envelope. */}
          <path d="M44 36 C56 31 72 31 84 36" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="3" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
