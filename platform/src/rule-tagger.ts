// Rule tagger (SEC-31 step 0, free half): label blocks with a block_type from
// the theme's own section name (type_hint), the page type, the block's
// position and the text the crawler kept. No AI call, no cost.
//
//   npm run rule-tag                 # dry run: coverage and a sample per label, writes nothing
//   npm run rule-tag -- --write      # store the labels
//   npm run rule-tag -- --sample N   # N examples per rule in the dry run (default 3)
//
// What it writes: block_type, and ai_response = { source: "rules", prompt_version:
// RULES_VERSION, rule, page_role, has_price, has_reviews, has_video }, tag_model =
// RULES_VERSION, tagged_at. ai_description and style tags stay empty: those need
// the AI. A block the AI tagger already labelled is never touched, and a block
// no rule is sure about is left null for the paid AI run
// (`npm run tag-blocks -- run --untagged-only`).
//
// Rules are deliberately conservative: a wrong label is worse than none,
// because the AI only picks up what is still null.

import { resolve } from "node:path";
import postgres from "postgres";
import type { BlockType, PageRole } from "./taxonomy.js";

export const RULES_VERSION = "rules-v1";

export type RuleInput = {
  typeHint: string;
  pageType: string; // home | collection | product | cart
  blockIndex: number;
  /** Index of the last block on the same capture and viewport. */
  lastIndex: number;
  top: number;
  height: number;
  text: string;
  headline: string | null;
  buttons: number;
  images: number;
  videos: number;
};

export type RuleLabel = { blockType: BlockType; rule: string };

const PRICE = /(?:[$£€¥₹]|\b(?:USD|EUR|GBP|CAD|AUD)\s?)\s?\d{1,5}(?:[.,]\d{2})?|\d{1,5}[.,]\d{2}\s?(?:€|zł|kr|USD|EUR)/g;
const priceCount = (t: string) => (t.match(PRICE) ?? []).length;

/** Theme section name without noise: lowercase, no -part, no shopify-section/template ids, no trailing numbers or hashes. */
export function normaliseHint(hint: string): string {
  return hint.toLowerCase()
    .replace(/-part$/, "")
    .replace(/^shopify-section-/, "")
    .replace(/^(template--\d+__)/, "")
    .replace(/[-_][0-9a-f]{6,}.*$/, "")
    .replace(/[-_]?v?\d+$/, "")
    .replace(/_/g, "-");
}

const has = (h: string, re: RegExp) => re.test(h);

/** Labels read from the section name alone, checked in order (most specific first). Page-dependent names are handled in labelFromHint. */
const NAME_RULES: [RegExp, BlockType][] = [
  [/announcement|promo-?bar|top-?bar|ticker|scrolling-text|text-marquee|marquee/, "announcement-bar"],
  [/cart-?drawer|mini-?cart|side-?cart/, "cart-drawer"],
  [/sticky-?(atc|add|buy|cart)/, "sticky-add-to-cart"],
  [/footer|copyright/, "footer"],
  [/(^|-)header|(^|-)navigation$|^nav(bar)?$|mega-?menu|supporting-menu/, "header-navigation"],
  [/recently-?viewed/, "recently-viewed"],
  [/related|recommend|complete-the-look|upsell|cross-?sell|complementary|you-may|frequently-bought|shop-the-look/, "cross-sell-upsell"],
  [/testimonial/, "testimonials"],
  [/review|judge-?me|jdgm|yotpo|okendo|stamped|loox|junip|power-reviews/, "product-reviews"],
  [/newsletter|sign-?up|subscribe-form|email-capture|klaviyo/, "newsletter"],
  [/faq|question/, "faq"],
  [/size-?(guide|chart)|fit-guide/, "size-guide"],
  [/shipping|returns|delivery-info/, "shipping-returns"],
  [/compar/, "comparison-table"],
  [/how-it-works|steps|timeline|process/, "how-it-works"],
  [/(^|-)team|founder/, "team"],
  [/stats|counter|numbers/, "stats"],
  [/logo-?(list|bar|cloud|slider|carousel)|logos|press|as-seen|scrolling-logos/, "logo-press-bar"],
  [/instagram|ugc|tiktok|social-feed/, "ugc-gallery"],
  [/blog|article|journal|news-posts/, "blog-teasers"],
  [/contact/, "contact"],
  [/quiz|finder/, "quiz-finder"],
  [/store-?locator|stockist/, "store-locator"],
  [/gift-?card/, "gift-card"],
  [/bundle/, "bundle-builder"],
  [/app-download|download-app/, "app-download"],
  [/trust|reassurance|guarantee|badges/, "trust-badges"],
  [/featured-collection|featured-products|product-(carousel|slider|list)|best-?sellers|collection-(row|carousel|tabs)|featured-product$/, "featured-collection"],
  [/text-with-icons|icons?-row|icons-with|usp|benefit-bar|icon-bar/, "usp-bar"],
  [/multi-?column|(^|-)features?(-|$)|benefits|ingredient|columns|text-columns/, "features-grid"],
  [/image-with-text|media-with-(text|content)|image-text|text-with-(media|image)|split|two-column|feature-text/, "image-with-text"],
  [/video/, "video"],
  [/hero|slideshow|slider|image-banner|banner|carousel-hero/, "hero"],
  [/collection-list|list-collections|category-grid|collection-grid/, "collection-grid"],
  [/filter|facet|sort/, "filter-sort-bar"],
  [/product-(tabs|details|description|accordion)|collapsible|accordion/, "product-tabs"],
  [/search/, "search-results"],
  [/account|login|register/, "account"],
  [/cta|call-to-action/, "cta-band"],
];

/** Names that mean nothing on their own: the rules below look at the page instead. */
const VAGUE = /^(unknown|main|section|blocks|content|custom-(liquid|html|content|code)|apps?|template|grid|text|richtext|rich-text|gp-(global-)?section|home|local|core|co|titan|double|layout|page|wrapper|container|shopify-section)$/;

function labelFromHint(h: string, b: RuleInput): RuleLabel | null {
  const p = b.pageType;
  // Page-dependent names first.
  if (/^empty-cart$|^(main-)?cart(-items|-page|-template)?$/.test(h)) return { blockType: "cart-page", rule: "name:cart" };
  if (p === "cart" && /^cart-footer$|^cart-summary$/.test(h)) return { blockType: "cart-page", rule: "name:cart" };
  if (/^(main-)?product(-template|-main|-info|-hero|-page)?$|^product-?page$|^main-product|^smart-main-product|buy-?box|^react-pdp$/.test(h)) {
    if (p === "product") return b.blockIndex <= 4 ? { blockType: "buy-box", rule: "name:product high on product page" } : { blockType: "product-card", rule: "name:product low on product page" };
    if (p === "collection" || p === "home") return { blockType: "product-card", rule: "name:product on listing" };
    return null;
  }
  if (/^(main-)?collection(-template|-product-grid|-products)?$|^product-grid$|^main-collection(-product-grid)?$|^collection-product-grid$|^shop-all-products$/.test(h)) {
    if (p === "collection") return { blockType: "collection-grid", rule: "name:collection grid on collection page" };
    if (p === "home") return { blockType: "featured-collection", rule: "name:collection grid on home" };
    return null;
  }
  if (/^(main-)?collection-(banner|header|hero|image-with-title)$|^main-collection-banner$/.test(h)) return { blockType: "hero", rule: "name:collection banner" };
  if (/^gallery$|product-gallery|product-media/.test(h) && p === "product" && b.blockIndex <= 4) return { blockType: "product-gallery", rule: "name:gallery high on product page" };
  if (VAGUE.test(h)) return null;
  for (const [re, type] of NAME_RULES) {
    if (!has(h, re)) continue;
    // A header in the middle of the page or a footer far from the end is something else the theme wrapped; leave it to the AI.
    if (type === "header-navigation" && b.blockIndex > 2) return null;
    if (type === "footer" && b.blockIndex < b.lastIndex - 2) return null;
    // A product row on a product page sells something else alongside: cross-sell, not a featured collection.
    if (type === "featured-collection" && b.pageType === "product") return { blockType: "cross-sell-upsell", rule: `name:${re.source} on product page` };
    // A banner far down the page is a promo band, not the opening hero.
    if (type === "hero" && b.blockIndex > 3 && !/hero/.test(h)) return { blockType: "image-with-text", rule: `name:${re.source} low on page` };
    return { blockType: type, rule: `name:${re.source}` };
  }
  return null;
}

/** Labels from what the block contains and where it sits, for vague or unknown names. Only patterns that are hard to mistake. */
function labelFromContent(b: RuleInput): RuleLabel | null {
  const t = `${b.headline ?? ""}\n${b.text}`.toLowerCase();
  const len = b.text.length;
  const prices = priceCount(b.text);
  const isLast = b.blockIndex === b.lastIndex;
  // The buy box shows stars, review counts and sometimes FAQ links: settle it before the rules that read those.
  const buyZone = b.pageType === "product" && b.blockIndex <= 3;
  if (b.pageType === "product" && b.blockIndex <= 4 && prices >= 1 && /add to (cart|bag|basket)|buy (it )?now|subscribe & save/.test(t)) return { blockType: "buy-box", rule: "content:price and add to cart high on product page" };
  if (b.blockIndex === 0 && b.top < 80 && b.height <= 70 && len > 0 && len < 160 && b.images === 0) return { blockType: "announcement-bar", rule: "content:thin first strip" };
  if (b.pageType === "cart" && /your (cart|bag|basket)|you don.t have any items|subtotal|check ?out|order summary/.test(t)) return { blockType: "cart-page", rule: "content:cart text" };
  if (b.blockIndex <= 1 && (b.pageType !== "product" || b.blockIndex === 0) && b.top < 200 && b.height < 220 && prices === 0 && len < 400 && /\b(cart|bag|basket|search|account|log ?in|menu)\b/.test(t)) return { blockType: "header-navigation", rule: "content:top bar with cart or menu" };
  if (b.blockIndex >= 3 && (isLast || b.blockIndex >= b.lastIndex - 1) && len < 3000 && /©|&copy;|copyright|all rights reserved|privacy policy|terms of (service|use)/.test(t)) return { blockType: "footer", rule: "content:last block with legal text" };
  if (/recently viewed/.test(t)) return { blockType: "recently-viewed", rule: "content:recently viewed" };
  if (/you may also like|you might also like|related products|complete the look|frequently bought|pairs well with|customers also (bought|viewed)/.test(t) && prices >= 2) return { blockType: "cross-sell-upsell", rule: "content:also-like heading with prices" };
  if (!buyZone && prices <= 1 && /(customer )?reviews?\b/.test(t) && (/based on [\d,]+ reviews|\d(\.\d)? out of 5|write a review|[\d,]+ reviews/.test(t))) return { blockType: "product-reviews", rule: "content:review summary" };
  if (!buyZone && /frequently asked|\bfaqs?\b/.test(t) && len > 80) return { blockType: "faq", rule: "content:faq heading" };
  if (len < 600 && /(subscribe|sign up|join)\b/.test(t) && /(newsletter|email|inbox|\boff your first|discount)/.test(t) && prices === 0) return { blockType: "newsletter", rule: "content:email sign-up" };
  if (b.pageType === "collection" && prices >= 6) return { blockType: "collection-grid", rule: "content:many prices on collection page" };
  if (b.pageType === "home" && prices >= 3 && b.images >= 3) return { blockType: "featured-collection", rule: "content:product row on home" };
  return null;
}

export function labelBlock(b: RuleInput): RuleLabel | null {
  return labelFromHint(normaliseHint(b.typeHint), b) ?? labelFromContent(b);
}

const ROLE: Partial<Record<BlockType, PageRole>> = {
  "announcement-bar": "navigation", "header-navigation": "navigation", footer: "closing", hero: "opening",
  "buy-box": "conversion", "subscription-picker": "conversion", "sticky-add-to-cart": "conversion", "bundle-builder": "conversion",
  pricing: "conversion", newsletter: "conversion", "cart-page": "conversion",
  testimonials: "social-proof", "product-reviews": "social-proof", "logo-press-bar": "social-proof", stats: "social-proof",
  "trust-badges": "social-proof", "ugc-gallery": "social-proof", "cta-band": "closing",
};

export function pageRoleOf(type: BlockType, b: RuleInput): PageRole {
  if (type === "hero" && b.blockIndex > 3) return "content";
  return ROLE[type] ?? "content";
}

// --------------------------------------------------------------------------

async function main() {
  try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (platform/.env)");
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const sampleN = Number(args[args.indexOf("--sample") + 1]) || 3;
  const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
  try {
    const counts = new Map<string, number>();
    const byRule = new Map<string, { n: number; samples: string[] }>();
    const unlabelled = new Map<string, number>();
    let total = 0, skippedAi = 0, labelled = 0, written = 0;
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = await sql`
        SELECT b.id, b.type_hint, p.type AS page_type, b.block_index, b.top, b.height, left(b.text, 2000) AS text, b.headline,
          b.buttons, b.images, b.videos, b.block_type, b.tag_model,
          (SELECT max(b2.block_index) FROM blocks b2 WHERE b2.capture_id = b.capture_id AND b2.viewport = b.viewport) AS last_index
        FROM blocks b JOIN captures c ON c.id = b.capture_id JOIN pages p ON p.id = c.page_id
        WHERE b.id > ${after}
        ORDER BY b.id LIMIT 2000`;
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const updates: { id: string; type: string; resp: Record<string, unknown> }[] = [];
      for (const r of rows) {
        total += 1;
        if (r.block_type && r.tag_model !== RULES_VERSION) { skippedAi += 1; continue; }
        const input: RuleInput = {
          typeHint: r.type_hint, pageType: r.page_type, blockIndex: r.block_index, lastIndex: Number(r.last_index), top: r.top,
          height: r.height, text: r.text ?? "", headline: r.headline, buttons: r.buttons, images: r.images, videos: r.videos,
        };
        const label = labelBlock(input);
        if (!label) { const h = normaliseHint(r.type_hint); unlabelled.set(h, (unlabelled.get(h) ?? 0) + 1); continue; }
        labelled += 1;
        counts.set(label.blockType, (counts.get(label.blockType) ?? 0) + 1);
        const e = byRule.get(label.rule) ?? { n: 0, samples: [] };
        e.n += 1;
        if (e.samples.length < sampleN) e.samples.push(`${r.page_type}#${r.block_index} "${r.type_hint}" ${String(r.headline ?? r.text ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
        byRule.set(label.rule, e);
        const t = `${r.headline ?? ""} ${r.text ?? ""}`;
        updates.push({
          id: r.id, type: label.blockType,
          resp: {
            source: "rules", prompt_version: RULES_VERSION, rule: label.rule, block_type: label.blockType,
            page_role: pageRoleOf(label.blockType, input), has_price: priceCount(t) > 0,
            has_reviews: label.blockType === "product-reviews" || label.blockType === "testimonials", has_video: r.videos > 0,
          },
        });
      }
      if (write && updates.length) {
        await sql.begin(async (tx) => {
          for (const u of updates) {
            const res = await tx`
              UPDATE blocks SET block_type = ${u.type}, ai_response = ${tx.json(u.resp as never)}, tag_model = ${RULES_VERSION},
                tagged_at = now(), updated_at = now()
              WHERE id = ${u.id} AND (block_type IS NULL OR tag_model = ${RULES_VERSION})`;
            written += res.count;
          }
        });
      }
    }
    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    console.log(`${RULES_VERSION} · ${write ? "WRITE" : "dry run (nothing written)"}`);
    console.log(`  ${total} blocks · ${skippedAi} already labelled by the AI (left alone) · ${labelled} labelled by rules (${pct(labelled)}) · ${total - skippedAi - labelled} left for the AI (${pct(total - skippedAi - labelled)})`);
    if (write) console.log(`  ${written} rows written`);
    console.log("\nBy label:");
    for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${n}`);
    console.log("\nBy rule (with samples):");
    for (const [k, e] of [...byRule].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${e.n.toString().padStart(6)}  ${k}`);
      for (const s of e.samples) console.log(`          ${s}`);
    }
    console.log("\nMost common names left for the AI:");
    console.log("  " + [...unlabelled].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([h, n]) => `${h}:${n}`).join(", "));
  } finally { await sql.end(); }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/rule-tagger.ts")) await main();
