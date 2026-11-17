// The store design profile (L3, SEC-31 brief section 4.4): one store's design
// system in one record, merged from the page profiles (L2) of its latest
// captures. Pure: profile.ts reads the database and calls buildDesignProfile.
//
// The summary is a fixed template filled from the numbers, never an AI call,
// so it is free to produce and reads the same every time for the same data.

import type { Viewport } from "../../web/src/contracts/block.js";
import type { HeadingSystemLevel, ProfileSource, StoreDesignProfile } from "../../web/src/contracts/design.js";
import type { ButtonVariant, PageStyles, PaletteColour, PaletteRole, RadiusLabel } from "../../web/src/contracts/manifest.js";
import { bucketFor, COLOUR_LABEL } from "../../web/src/lib/colour.js";

/** One captured page as the job reads it: its latest capture with page styles. */
export type ProfileInput = {
  pageType: string;
  url: string;
  capturedAt: string;
  styles: Partial<Record<Viewport, PageStyles>>;
  /** Aspect ratios of product imagery on the page (block style imagery.ratio on product and collection pages). */
  productRatios?: string[];
};

const VIEWPORTS: Viewport[] = ["desktop", "mobile"];
const ROLES: PaletteRole[] = ["background", "surface", "text", "text-muted", "accent", "accent-text", "border", "link"];

// ---------------------------------------------------------------- small statistics

export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The most common value; ties go to the first seen, so the result is stable for the same input order. */
export function mode<T>(values: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null && v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/** The key with the largest summed weight; ties go to the first seen. */
function heaviest(weights: Map<string, number>): string | null {
  let best: string | null = null, w = -Infinity;
  for (const [k, v] of weights) if (v > w) { best = k; w = v; }
  return best;
}

const round = (n: number | null, step = 0.5) => (n === null ? null : Math.round(n / step) * step);

export function radiusLabel(radius: number | null, height?: number | null): RadiusLabel | null {
  if (radius === null) return null;
  if (height && radius >= height / 2 - 1) return "pill";
  if (radius <= 2) return "sharp";
  if (radius <= 8) return "soft";
  if (radius <= 20) return "rounded";
  return "pill";
}

const variantKey = (v: ButtonVariant) => `${v.background ?? "none"}|${v.text}|${v.border ?? "none"}|${Math.round(v.radius)}|${v.case}`;

// ---------------------------------------------------------------- the profile

export function buildDesignProfile(inputs: ProfileInput[], builtAt = new Date().toISOString()): StoreDesignProfile | null {
  // Every page × viewport that was measured, in a fixed order.
  const pages = inputs
    .slice()
    .sort((a, b) => a.pageType.localeCompare(b.pageType) || a.url.localeCompare(b.url))
    .flatMap((p) => VIEWPORTS.filter((vp) => p.styles[vp]).map((vp) => ({ page: p, vp, s: p.styles[vp]! })));
  if (!pages.length) return null;
  const at = (vp: Viewport) => pages.filter((x) => x.vp === vp);
  const preferred = at("desktop").length ? at("desktop") : at("mobile");

  const sources: ProfileSource[] = inputs
    .filter((p) => VIEWPORTS.some((vp) => p.styles[vp]))
    .map((p) => ({ pageType: p.pageType, url: p.url, capturedAt: p.capturedAt, viewports: VIEWPORTS.filter((vp) => p.styles[vp]) }))
    .sort((a, b) => a.pageType.localeCompare(b.pageType) || a.url.localeCompare(b.url));

  // Typography: heading family by heading characters (count × median length, so a page of small labels does not outweigh its h1), body and UI families by characters in that role.
  const headingFamilies = new Map<string, number>();
  for (const { s } of pages) for (const l of s.headings.levels) if (l.family && l.count) headingFamilies.set(l.family, (headingFamilies.get(l.family) ?? 0) + l.count * (l.length ?? 1));
  const roleFamily = (role: "body" | "button") => {
    const w = new Map<string, number>();
    for (const { s } of pages) for (const f of s.typography.families) if (f.roles.includes(role)) w.set(f.family, (w.get(f.family) ?? 0) + f.share * Math.max(1, s.chars));
    return heaviest(w);
  };
  const body = roleFamily("body");

  // Type scale, at one viewport (desktop when captured; phone sizes differ): sizes carrying at least 1% of a
  // page's characters, on at least two page types.
  const sizeTypes = new Map<number, Set<string>>();
  for (const { page, s } of preferred) for (const { size, share } of s.typography.scale) if (share >= 0.01) {
    if (!sizeTypes.has(size)) sizeTypes.set(size, new Set());
    sizeTypes.get(size)!.add(page.pageType);
  }
  const pageTypes = new Set(preferred.map((x) => x.page.pageType)).size;
  const scale = [...sizeTypes].filter(([, t]) => pageTypes < 2 || t.size >= 2).map(([size]) => size).sort((a, b) => a - b);

  // Heading system, one entry per level.
  const headings: HeadingSystemLevel[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => {
    const found = pages.map(({ vp, s }) => ({ vp, l: s.headings.levels.find((x) => x.level === level) })).filter((x) => x.l && x.l.count > 0);
    const sizeAt = (vp: Viewport) => round(median(found.filter((x) => x.vp === vp).map((x) => x.l!.size)));
    const preferredVp: Viewport = found.some((x) => x.vp === "desktop") ? "desktop" : "mobile";
    const upper = found.map((x) => x.l!.uppercaseShare).filter((u): u is number => u !== null);
    return {
      level, pages: found.length,
      size: { desktop: sizeAt("desktop"), mobile: sizeAt("mobile") },
      weight: median(found.map((x) => x.l!.weight)),
      family: mode(found.map((x) => x.l!.family)),
      uppercase: upper.length ? upper.filter((u) => u >= 0.5).length > upper.length / 2 : null,
      distinctSizes: new Set(found.filter((x) => x.vp === preferredVp).map((x) => x.l!.size)).size,
    };
  });

  // Palette: per role, the colour with the most share across pages.
  const palette: PaletteColour[] = [];
  for (const role of ROLES) {
    const w = new Map<string, number>(), shares = new Map<string, number[]>();
    for (const { s } of pages) for (const c of s.colour.palette) if (c.role === role) {
      w.set(c.colour, (w.get(c.colour) ?? 0) + c.share);
      shares.set(c.colour, [...(shares.get(c.colour) ?? []), c.share]);
    }
    const colour = heaviest(w);
    if (!colour) continue;
    const list = shares.get(colour)!;
    palette.push({ role, colour, share: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100, bucket: bucketFor(colour) ?? undefined });
  }
  const accentColour = palette.find((c) => c.role === "accent")?.colour ?? null;

  // Buttons: the most used primary variant, then the most used other variant.
  const primaryWeights = new Map<string, number>(), allWeights = new Map<string, number>(), byKey = new Map<string, ButtonVariant>();
  for (const { s } of pages) {
    s.buttons.variants.forEach((v, i) => {
      const k = variantKey(v);
      if (!byKey.has(k)) byKey.set(k, v);
      allWeights.set(k, (allWeights.get(k) ?? 0) + v.count);
      if (i === s.buttons.primary) primaryWeights.set(k, (primaryWeights.get(k) ?? 0) + Math.max(1, v.count));
    });
  }
  const primaryKey = heaviest(primaryWeights);
  allWeights.delete(primaryKey ?? "");
  const secondaryKey = heaviest(allWeights);

  // Shape and spacing: medians, from desktop pages when there are any.
  const radius = {
    button: median(preferred.map((x) => x.s.shape.radius.button)),
    image: median(preferred.map((x) => x.s.shape.radius.image)),
    card: median(preferred.map((x) => x.s.shape.radius.card)),
    input: median(preferred.map((x) => x.s.shape.radius.input)),
  };
  const primary = primaryKey ? byKey.get(primaryKey)! : null;

  const gridAt = (vp: Viewport) => mode(at(vp).map((x) => x.s.layout.gridColumns));
  const ratios = new Map<string, number>();
  for (const p of inputs) for (const r of p.productRatios ?? []) ratios.set(r, (ratios.get(r) ?? 0) + 1);

  const textColours = new Set<string>(), families = new Set<string>(), sizes = new Set<number>();
  for (const { s } of pages) {
    for (const c of s.colour.palette) if (c.role === "text" || c.role === "text-muted" || c.role === "link") textColours.add(c.colour);
    for (const f of s.typography.families) families.add(f.family);
    for (const { size } of s.typography.scale) sizes.add(size);
  }

  const langs = pages.map((x) => x.s.accessibility.lang);
  const profile: StoreDesignProfile = {
    version: 1,
    builtAt,
    sources,
    partial: pages.some((x) => x.s.partial),
    typography: {
      heading: heaviest(headingFamilies),
      body,
      ui: roleFamily("button"),
      scale,
      bodySize: { desktop: round(median(at("desktop").map((x) => x.s.typography.bodySize))), mobile: round(median(at("mobile").map((x) => x.s.typography.bodySize))) },
      bodyLineHeight: round(median(pages.map((x) => x.s.typography.bodyLineHeight)), 0.05),
    },
    headings,
    palette,
    accent: accentColour ? { colour: accentColour, bucket: bucketFor(accentColour) } : null,
    buttons: { primary, secondary: secondaryKey ? byKey.get(secondaryKey)! : null },
    shape: {
      label: mode(pages.map((x) => x.s.shape.label)) ?? radiusLabel(radius.button ?? radius.card),
      radius,
      shadows: pages.some((x) => x.s.shape.shadows),
    },
    spacing: {
      contentWidth: median(preferred.map((x) => x.s.spacing.contentWidth)),
      gutter: median(preferred.map((x) => x.s.spacing.gutter)),
      blockPadding: median(preferred.map((x) => x.s.spacing.blockPadding)),
      baseUnit: mode(pages.map((x) => x.s.spacing.baseUnit)),
    },
    layout: {
      pages: pages.map(({ page, vp, s }) => ({ pageType: page.pageType, viewport: vp, screens: Math.round(s.layout.screens * 10) / 10, blocks: s.layout.blocks })),
      gridColumns: { desktop: gridAt("desktop"), mobile: gridAt("mobile") },
      productImageRatios: [...ratios].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r]) => r),
    },
    consistency: { families: families.size, sizes: sizes.size, textColours: textColours.size, buttonVariants: byKey.size },
    accessibility: {
      altShare: median(pages.map((x) => x.s.accessibility.altShare)),
      contrastPass: median(pages.map((x) => x.s.accessibility.contrastPass)),
      labelledInputs: median(pages.map((x) => x.s.accessibility.labelledInputs)),
      tapTargets: median(at("mobile").map((x) => x.s.accessibility.tapTargets)),
      headingOrderValid: Math.round((pages.filter((x) => x.s.accessibility.headingOrderValid).length / pages.length) * 100) / 100,
      lang: langs.length ? langs.every(Boolean) : null,
    },
    summary: "",
  };
  profile.summary = designSummary(profile);
  return profile;
}

// ---------------------------------------------------------------- the summary template

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);
const px = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}px`;

/** How a neutral reads in a sentence; hues use their family name. */
const TONE: Record<string, string> = { white: "white", light: "off-white", grey: "grey", dark: "dark grey", black: "near-black" };
const tone = (c: PaletteColour | undefined) => (c ? TONE[c.bucket ?? ""] ?? (COLOUR_LABEL[c.bucket ?? ""] ?? "coloured").toLowerCase() : null);

/**
 * "Headings in Canela 600, body in Inter 16px. Type scale 12, 14, 16, 20, 28,
 * 40, 64. Near-black text on off-white, accent green #1f4d3a for buttons. Pill
 * buttons, 48px tall. Product images 4:5, four columns on desktop, two on phone."
 * Each sentence is left out when its numbers are missing.
 */
export function designSummary(p: StoreDesignProfile): string {
  const out: string[] = [];
  const t = p.typography;
  const h = p.headings.find((l) => l.level === 1 && l.pages) ?? p.headings.find((l) => l.pages);
  const headingWeight = h?.weight ? ` ${Math.round(h.weight)}` : "";
  const upper = h?.uppercase ? ", uppercase" : "";
  const bodySize = t.bodySize.desktop ?? t.bodySize.mobile;
  const bodyPart = t.body ? `body in ${t.body}${bodySize ? ` ${px(bodySize)}` : ""}` : bodySize ? `body ${px(bodySize)}` : "";
  if (t.heading && t.heading === t.body) out.push(`Headings and body in ${t.heading}; headings${headingWeight || " bold"}${upper}${bodySize ? `, body ${px(bodySize)}` : ""}.`);
  else if (t.heading) out.push(`Headings in ${t.heading}${headingWeight}${upper}${bodyPart ? `, ${bodyPart}` : ""}.`);
  else if (bodyPart) out.push(`${bodyPart[0].toUpperCase()}${bodyPart.slice(1)}.`);

  if (t.scale.length) out.push(`Type scale ${t.scale.join(", ")}.`);

  const text = p.palette.find((c) => c.role === "text"), bg = p.palette.find((c) => c.role === "background");
  if (text && bg) {
    const accent = p.accent ? `, accent ${(COLOUR_LABEL[p.accent.bucket ?? ""] ?? "").toLowerCase() || "colour"} ${p.accent.colour} for buttons` : "";
    const sentence = `${tone(text)} text on ${tone(bg)}${accent}.`;
    out.push(sentence[0].toUpperCase() + sentence.slice(1));
  }

  const b = p.buttons.primary;
  if (b) {
    const shape = radiusLabel(b.radius, b.height);
    const label = shape ? `${shape[0].toUpperCase()}${shape.slice(1)} buttons` : "Buttons";
    out.push(`${label}, ${px(b.height)} tall${b.case === "uppercase" ? ", uppercase labels" : ""}.`);
  }

  const ratio = p.layout.productImageRatios[0];
  const cols = p.layout.gridColumns;
  const grid = [cols.desktop ? `${count(cols.desktop)} columns on desktop` : "", cols.mobile ? `${count(cols.mobile)} on phone` : ""].filter(Boolean).join(", ");
  if (ratio || grid) out.push(`${ratio ? `Product images ${ratio}` : "Product grid"}${grid ? `, ${grid}` : ""}.`);

  return out.join(" ");
}
