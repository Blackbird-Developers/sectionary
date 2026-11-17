// CONTRACT v1 · the capture manifest. Lane A (capture) writes one
// data/<host>/<page-slug>/manifest.json per page; Lane B (platform) imports it.
// src/contract-check.ts in the repo root fails the type-check if the crawler's
// own types drift from this file. Sample: fixtures/manifests/.

// Self-contained on purpose (no imports): the crawler type-checks this file
// under NodeNext resolution, where extensionless relative imports are errors.
type Viewport = "desktop" | "mobile";

export type ManifestSite = {
  host: string;
  origin: string;
  platform?: string;
  theme?: Record<string, unknown> | null;
  builder?: string | null;
  apps?: string[];
  currency?: string | null;
  locale?: string | null;
};

export type ManifestPage = {
  url: string;
  /** home | collection | collection-list | product | cart | checkout | search | account | article | blog | page | other */
  type: string;
  slug: string;
  capturedAt: string;
  title?: string;
  description?: string | null;
  canonical?: string | null;
  ogImage?: string | null;
  lang?: string | null;
  h1?: string | null;
};

export type ManifestViewport =
  | { file: string; width: number; fullHeight: number; strategy: string; status: number | null; ms: number }
  | { error: string; status: number | null };

// Moments and clips (additive, docs/CONTRACTS.md). Both are off by default in the crawler
// (--moments, --clips): a capture without them has no `moments` key and no `moment`,
// `motionHint` or `clip` field, exactly as before.

/** What a store does when a shopper uses it. */
export type MomentKind =
  | "first-visit-popup" | "menu-open" | "sticky-atc"
  | "variant-change" | "quick-view"
  | "add-to-cart" | "cart-drawer";

/** How the store answered an add to cart. */
export type MomentResponse = "drawer" | "modal" | "toast" | "redirect" | "inline" | "none";

export type MomentFrame = {
  /** before = the page as it was; after = the screen once the store answered; panel = the element that appeared, alone. */
  role: "before" | "after" | "panel";
  /** Path relative to the manifest's folder. before/after: moments/<d|m>-<kind>-<role>.jpg; panel: the panel block's image. */
  file: string;
  /** CSS pixels. */
  width: number;
  height: number;
};

export type ManifestMoment = {
  /** `<d|m>-<kind>`, with `-2`, `-3` appended if a kind repeats on a page. Unique within the manifest. */
  id: string;
  kind: MomentKind;
  viewport: Viewport;
  trigger: {
    action: "none" | "scroll" | "hover" | "click" | "select";
    /** The element acted on: its visible text or aria-label, at most 80 characters. */
    label: string | null;
    /** How it was found, for debugging. */
    via: string | null;
  };
  /** add-to-cart only. */
  response?: MomentResponse;
  frames: MomentFrame[];
  /** The `ref` of the block written for the panel that appeared (that block has `moment` set), when there is one. */
  panelRef?: string | null;
  /** high = every check for the kind passed; low = kept for tuning detection, never shown. */
  confidence: "high" | "low";
  ms: number;
  error?: string;
};

/** Why a block was considered for a clip. */
export type MotionKind = "video" | "embed" | "carousel" | "marquee" | "animation";

/** A short, silent, looping recording of a block that moves by itself. The block's screenshot is its poster. */
export type ManifestClip = {
  kind: MotionKind;
  /** Path relative to the manifest's folder (blocks/d-02-hero.mp4), or null when recording or encoding failed. */
  file: string | null;
  /** Pixels of the encoded file. */
  width: number;
  height: number;
  durationMs: number;
  bytes: number;
  /** The part of the block that was recorded, in CSS pixels from the block's top-left corner. */
  rect: { x: number; y: number; width: number; height: number };
  error?: string;
};

export type ManifestBlock = {
  ref: string;
  index: number;
  typeHint: string;
  parentType: string | null;
  tag: string;
  id: string | null;
  classes: string | null;
  top: number;
  height: number;
  width: number;
  text: string;
  textLength: number;
  headline: string | null;
  buttons: number;
  images: number;
  videos: number;
  bg: string;
  viewport: Viewport;
  /** Path relative to the manifest's folder, or null when the screenshot failed. */
  file: string | null;
  error?: string;
  /** Set when this block is the panel a moment revealed (a cart drawer, an open menu), not part of the page at rest. */
  moment?: MomentKind;
  /** Set whenever the crawler considered the block for a clip, recorded or not. */
  motionHint?: MotionKind;
  /** The recorded clip, when the block was seen moving. */
  clip?: ManifestClip;
};

export type Manifest = {
  site: ManifestSite;
  page: ManifestPage;
  viewports: Partial<Record<Viewport, ManifestViewport>>;
  blocks: ManifestBlock[];
  /** What the store did when the crawler used it. Absent when moments were not asked for. */
  moments?: ManifestMoment[];
};
