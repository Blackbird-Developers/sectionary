// CONTRACT v1 · shared between lanes. Change only through a pull request
// labelled `contract`, reviewed by every lane. Additive changes only within a
// milestone; a breaking change bumps CONTRACT_VERSION in ./api.ts.
//
// Pure types, no imports from Next.js or Node: the crawler and the platform
// import this file too.

export type Viewport = "desktop" | "mobile";

/** One captured block as the web app receives it (sample JSON today, /api/blocks tomorrow). */
export type Block = {
  /** Stable id: `<host>/<page-slug>/<viewport>/<index>` until the database issues uuids. */
  id: string;
  host: string;
  pageType: string;
  pageUrl: string;
  pageTitle: string | null;
  viewport: Viewport;
  /** Raw type from capture ("featured-collection"); the AI tagger adds `blockType` later. */
  typeHint: string;
  headline: string | null;
  /** CSS colour of the block background, painted behind the image while it loads. */
  bg: string;
  /** CSS pixel size of the block. The image may be 2x on mobile; use these for aspect ratio. */
  w: number;
  h: number;
  /** Path or absolute URL of the screenshot. Relative paths resolve against the asset base. */
  src: string;
  platform: string | null;
  theme: string | null;
  apps: string[];
  buttons: number;
  images: number;
  videos: number;
  /** First 400 characters of the block's visible text. */
  text: string;
  /** Set when the block is the panel a moment revealed ("cart-drawer", "menu-open" ...). Absent for blocks of the page at rest. */
  moment?: string;
  /** A short silent looping recording of the block, when it moves by itself. The screenshot is its poster. */
  clip?: BlockClip;
};

/**
 * `src` is a path or absolute URL that resolves like `Block.src`; `w` and `h` are the file's pixels, `ms` its length.
 * `rect` is the recorded part of the block in CSS pixels from its top-left corner; absent means the whole block.
 */
export type BlockClip = { kind: string; src: string; w: number; h: number; ms: number; rect?: { x: number; y: number; w: number; h: number } };

export type BlockSet = { generatedAt: string; blocks: Block[] };
