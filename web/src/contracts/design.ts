// CONTRACT v1 · additive (SEC-31). The store design profile (L3) and the
// benchmarks (L4), built by the platform's `profile-sites` and `benchmarks`
// jobs from captures made with --styles, and read by the API and the MCP
// server. See docs/CONTRACTS.md, "Design profiles and benchmarks".
//
// Pure types, no imports from Next.js or Node: the platform imports this file.
// Measurements only, never a store's source (docs/bot-page.md).

import type { Viewport } from "./block";
import type { ButtonVariant, PaletteColour, RadiusLabel } from "./manifest";

/** One page the profile was built from: the latest capture of each captured page with page styles. */
export type ProfileSource = { pageType: string; url: string; capturedAt: string; viewports: Viewport[] };

/** One heading level across the store's pages. */
export type HeadingSystemLevel = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Pages (page × viewport) where the level appears. */
  pages: number;
  /** Median of the pages' median sizes, per viewport; null where the level never appears. */
  size: Record<Viewport, number | null>;
  weight: number | null;
  family: string | null;
  /** True when most of the level's pages set it in uppercase. */
  uppercase: boolean | null;
  /**
   * Distinct sizes the level takes across pages at one viewport (desktop when
   * captured, else mobile). 1 means every page styles it alike; 5 means five
   * different sizes. A description, never a score.
   */
  distinctSizes: number;
};

/** Signals, not an audit (brief section 4.3). Served to signed-in accounts and MCP keys only. */
export type StoreAccessibility = {
  /** Medians across the store's pages. */
  altShare: number | null;
  contrastPass: number | null;
  labelledInputs: number | null;
  /** Phone only. */
  tapTargets: number | null;
  /** Share of pages whose headings go down one level at a time. */
  headingOrderValid: number | null;
  /** Every page declares its language. Null when no page says. */
  lang: boolean | null;
};

/** L3: one store's design system in one record (brief section 4.4). `sites.design_profile`. */
export type StoreDesignProfile = {
  /** Shape version, 1 for now. */
  version: 1;
  builtAt: string;
  sources: ProfileSource[];
  /** True when any source page's measuring stopped early. */
  partial: boolean;

  typography: {
    /** By heading characters across pages (count × median length). */
    heading: string | null;
    /** The family with the body role carrying the most characters. */
    body: string | null;
    /** The family with the button role carrying the most characters. */
    ui: string | null;
    /** Sizes used on at least two page types at one viewport (desktop when captured), smallest first; every size when only one page type is profiled. */
    scale: number[];
    bodySize: Record<Viewport, number | null>;
    bodyLineHeight: number | null;
  };

  /** Always six entries, h1 to h6. */
  headings: HeadingSystemLevel[];

  /** The roles from the page profiles merged across pages, at most one colour per role. */
  palette: PaletteColour[];
  /** The accent, named by its colour family. */
  accent: { colour: string; bucket: string | null } | null;

  buttons: { primary: ButtonVariant | null; secondary: ButtonVariant | null };

  shape: {
    label: RadiusLabel | null;
    radius: { button: number | null; image: number | null; card: number | null; input: number | null };
    shadows: boolean;
  };

  spacing: { contentWidth: number | null; gutter: number | null; blockPadding: number | null; baseUnit: 4 | 8 | null };

  layout: {
    /** Page length in screens and block count, per profiled page and viewport. */
    pages: { pageType: string; viewport: Viewport; screens: number; blocks: number }[];
    gridColumns: Record<Viewport, number | null>;
    /** Aspect ratios of product imagery, most used first. */
    productImageRatios: string[];
  };

  /** Distinct values across the store. Fewer means a tighter system; a description, never a score. */
  consistency: { families: number; sizes: number; textColours: number; buttonVariants: number };

  accessibility: StoreAccessibility;

  /** A DESIGN.md-style paragraph from a fixed template and the numbers above. No AI call: free and never drifts. */
  summary: string;
};

/** A benchmark is published only from this many stores. */
export const MIN_BENCHMARK_N = 10;

/** L4: one benchmark row (brief section 4.5). `benchmarks` table. */
export type Benchmark = {
  /** An industry key, or "all". */
  industry: string;
  /** A page type, or "all". */
  pageType: string;
  viewport: Viewport;
  /**
   * A metric key: numeric ("body-size", "blocks", ...), categorical
   * ("radius-label", ...), or "block:<block_type>" for how many stores have
   * that block on the page type (shares.present) and its median position (p50).
   */
  metric: string;
  /** Stores measured. */
  n: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  /** Categorical metrics: share of stores per value, 0 to 1. */
  shares: Record<string, number> | null;
  computedAt: string;
};
