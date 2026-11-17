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
  /** Measured styling (SEC-31). Absent on captures made without --styles. */
  style?: BlockStyle;
  /** The block's contents top to bottom, depth 3, at most 40 nodes (SEC-31). */
  outline?: OutlineNode[];
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
  /** Page design profile per viewport (SEC-31). Absent on captures made without --styles. */
  pageStyles?: Partial<Record<Viewport, PageStyles>>;
  /** What the store did when the crawler used it. Absent when moments were not asked for. */
  moments?: ManifestMoment[];
};

// ---------------------------------------------------------------------------
// Design metadata (SEC-31, docs: CONTRACTS.md "Design metadata").
//
// Measurements of the rendered page, never its source: no HTML, CSS, class
// names, inline styles, font files or URLs to them. Every field is optional
// at the manifest level; inside an object, `null` means "measured, nothing
// there" or "could not be measured", never a guess.
// ---------------------------------------------------------------------------

/** #rrggbb, alpha already blended over the effective background. */
type Hex = string;

export type TextRole =
  | "heading-1" | "heading-2" | "heading-3" | "heading-4" | "heading-5" | "heading-6"
  | "body" | "button" | "link" | "price" | "label";

export type TextCase = "none" | "uppercase" | "lowercase" | "capitalize";

export type TextStyle = {
  role: TextRole;
  /** The family actually rendered, by name. Never a file or URL. A generic (serif, sans-serif, system) when no named family was loaded. */
  family: string;
  /** CSS pixels, rounded to 0.5. */
  size: number;
  weight: number;
  /** Unitless ratio of line height to font size, or null when "normal". */
  lineHeight: number | null;
  /** In em, 0 when none. */
  letterSpacing: number;
  case: TextCase;
  colour: Hex;
  /** Share of the measured characters carrying this style, 0 to 1. */
  share: number;
};

export type OutlineNodeType =
  | "heading" | "text" | "image" | "video" | "button" | "link-list" | "price" | "rating" | "form"
  | "badge" | "icon-row" | "product-card" | "accordion" | "carousel" | "table" | "group";

export type OutlineNode = {
  type: OutlineNodeType;
  /** heading: 1 to 6. */
  level?: number;
  /** heading (at most 80 characters) or button label (at most 40). */
  text?: string;
  /** text: word count. */
  words?: number;
  /** image: snapped aspect ratio, "1:1", "4:5", "3:4", "2:3", "3:2", "4:3", "16:9", "21:9". */
  ratio?: string;
  /** image: has non-empty alt text. */
  alt?: boolean;
  /** button: index into PageStyles.buttons.variants, or null when it matched none. */
  variant?: number | null;
  /** price: a struck-through compare-at price is shown. */
  compareAt?: boolean;
  /** rating: value out of 5 and review count, null when not shown. */
  rating?: { value: number | null; count: number | null };
  /** Repeats collapsed into this node (product cards, accordion items, slides, links, icons). */
  count?: number;
  columns?: number;
  /** table. */
  rows?: number;
  /** form: input types in order ("email", "text", "select", "checkbox", ...). */
  fields?: string[];
  children?: OutlineNode[];
};

export type BlockStyle = {
  /** Distinct text styles, largest share first, at most 8. */
  type: TextStyle[];
  background: { kind: "colour" | "image" | "video" | "gradient"; colour: Hex | null };
  /** At most 4, by share of characters. */
  textColours: { colour: Hex; share: number }[];
  /** Background of the block's primary button. */
  accent: Hex | null;
  border: Hex | null;
  /** Share of characters meeting WCAG AA, 0 to 1. Null when all text sits on imagery. */
  contrastPass: number | null;
  layout: {
    columns: number;
    mediaSide: "left" | "right" | "top" | "background" | "none";
    width: "full" | "contained";
    /** CSS pixels. */
    contentWidth: number;
    padTop: number;
    padBottom: number;
    align: "left" | "center" | "right";
  };
  radius: { button: number | null; image: number | null; card: number | null };
  shadows: boolean;
  imagery: { count: number; areaShare: number; ratio: string | null };
  commerce: {
    price: boolean;
    compareAt: boolean;
    /** e.g. "20% off", at most 40 characters. */
    discount: string | null;
    rating: { value: number | null; count: number | null } | null;
    /** e.g. "Free shipping over $50", at most 60 characters. */
    freeShipping: string | null;
    subscription: boolean;
    urgency: boolean;
    paymentBadges: boolean;
    products: number;
    gridColumns: number | null;
  };
};

export type PaletteRole = "background" | "surface" | "text" | "text-muted" | "accent" | "accent-text" | "border" | "link";

export type PaletteColour = {
  role: PaletteRole;
  colour: Hex;
  /** Background and surface by painted area; text roles by characters; accent by button count. 0 to 1 within its kind. */
  share: number;
  /** Colour family from web/src/lib/colour.ts bucketFor. The crawler may omit it; the importer fills it. */
  bucket?: string;
};

export type ButtonVariant = {
  /** Null when transparent (an outline or text button). */
  background: Hex | null;
  text: Hex;
  /** Border colour, null when none. */
  border: Hex | null;
  radius: number;
  height: number;
  paddingX: number;
  fontSize: number;
  weight: number;
  case: TextCase;
  /** Buttons on the page in this variant. */
  count: number;
};

export type HeadingLevel = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  count: number;
  /** Medians across the level's headings; null when count is 0. */
  size: number | null;
  weight: number | null;
  family: string | null;
  uppercaseShare: number | null;
  /** Median length in characters. */
  length: number | null;
};

export type RadiusLabel = "sharp" | "soft" | "rounded" | "pill";

/** L2: the design profile of one page at one viewport. */
export type PageStyles = {
  /** Shape version of this object, 1 for now. */
  version: 1;
  /** True when the time or element budget ran out and some readings stopped early. */
  partial: boolean;
  /** Time spent measuring, in milliseconds. */
  ms: number;
  /** Characters of visible text measured. */
  chars: number;

  typography: {
    /** By share of characters, largest first. */
    families: { family: string; share: number; roles: ("heading" | "body" | "button")[] }[];
    /** Every distinct size in use, smallest to largest. */
    scale: { size: number; share: number }[];
    /** The size carrying the most body characters. */
    bodySize: number | null;
    bodyLineHeight: number | null;
    /** Ratio of each heading level's median size to the next level present below it, h1/h2 first. */
    headingRatios: number[];
    /** Weights in use, ascending. */
    weights: number[];
    /** Share of heading characters set in uppercase. */
    headingUppercaseShare: number | null;
  };

  headings: {
    /** Always six entries, h1 to h6. */
    levels: HeadingLevel[];
    h1Count: number;
    /** Times the level rose by more than one going down the page (h2 then h4). */
    skips: number;
    /** Large, bold, short text that is not marked up as a heading. */
    styledNotMarked: number;
    /** Headings as a share of all text characters. */
    share: number;
    perScreen: number;
  };

  colour: {
    /** At most 8, one per role at most. */
    palette: PaletteColour[];
    /** Distinct non-neutral hues among text, buttons and painted areas. */
    hues: number;
    /** Share of characters meeting WCAG AA; text over imagery excluded. */
    contrastPass: number | null;
  };

  buttons: {
    /** At most 3, most used first. */
    variants: ButtonVariant[];
    /** Index into variants, or null when there are no buttons. */
    primary: number | null;
    /** The 5 most common labels, at most 40 characters each. */
    labels: string[];
  };

  shape: {
    /** Median corner radius in CSS pixels. */
    radius: { button: number | null; image: number | null; card: number | null; input: number | null };
    /** From the button radius, else the card radius. */
    label: RadiusLabel | null;
    shadows: boolean;
  };

  spacing: {
    contentWidth: number | null;
    gutter: number | null;
    /** Median vertical padding of blocks. */
    blockPadding: number | null;
    /** Spacing values cluster on multiples of this, or null. */
    baseUnit: 4 | 8 | null;
  };

  layout: {
    /** Page height divided by viewport height. */
    screens: number;
    blocks: number;
    wordsPerScreen: number;
    imagesPerScreen: number;
    /** Share of the page's area that is imagery. */
    imageryShare: number;
    /** Columns of the largest product grid, null when none. */
    gridColumns: number | null;
  };

  components: {
    forms: number;
    inputs: number;
    accordions: number;
    carousels: number;
    tabs: number;
    tables: number;
    videos: number;
    sticky: number;
  };

  /** Signals, not an audit. */
  accessibility: {
    altShare: number | null;
    headingOrderValid: boolean;
    contrastPass: number | null;
    lang: boolean;
    labelledInputs: number | null;
    /** Phone only: share of buttons and links at least 44px tall. Null on desktop. */
    tapTargets: number | null;
  };
};
