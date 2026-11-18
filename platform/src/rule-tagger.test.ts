import { test } from "node:test";
import assert from "node:assert/strict";
import { labelBlock, normaliseHint, pageRoleOf, type RuleInput } from "./rule-tagger.js";
import { BLOCK_TYPES } from "./taxonomy.js";

const block = (o: Partial<RuleInput>): RuleInput => ({
  typeHint: "unknown", pageType: "home", blockIndex: 5, lastIndex: 12, top: 2000, height: 500,
  text: "", headline: null, buttons: 0, images: 0, videos: 0, ...o,
});
const label = (o: Partial<RuleInput>) => labelBlock(block(o))?.blockType ?? null;

test("normaliseHint strips -part, theme ids and trailing numbers", () => {
  assert.equal(normaliseHint("product-grid-part"), "product-grid");
  assert.equal(normaliseHint("shopify-section-template--17147943845955__image_banner"), "image-banner");
  assert.equal(normaliseHint("banner-v2"), "banner");
  assert.equal(normaliseHint("pf-7c18a1a"), "pf");
});

test("theme names map to block types", () => {
  assert.equal(label({ typeHint: "footer", blockIndex: 12 }), "footer");
  assert.equal(label({ typeHint: "header", blockIndex: 1 }), "header-navigation");
  assert.equal(label({ typeHint: "review", pageType: "product", blockIndex: 10 }), "product-reviews");
  assert.equal(label({ typeHint: "newsletter" }), "newsletter");
  assert.equal(label({ typeHint: "faq" }), "faq");
  assert.equal(label({ typeHint: "image-with-text" }), "image-with-text");
  assert.equal(label({ typeHint: "empty-cart", pageType: "cart", blockIndex: 2 }), "cart-page");
});

test("'featured' is a collection, not a features grid", () => {
  assert.equal(label({ typeHint: "featured-collections" }), "featured-collection");
  assert.equal(label({ typeHint: "featured-collection", pageType: "product" }), "cross-sell-upsell");
  assert.equal(label({ typeHint: "multicolumn" }), "features-grid");
  assert.equal(label({ typeHint: "feature" }), "features-grid");
});

test("'product' depends on the page and the position", () => {
  assert.equal(label({ typeHint: "product", pageType: "product", blockIndex: 2 }), "buy-box");
  assert.equal(label({ typeHint: "product", pageType: "product", blockIndex: 13 }), "product-card");
  assert.equal(label({ typeHint: "product", pageType: "collection" }), "product-card");
  assert.equal(label({ typeHint: "collection", pageType: "collection" }), "collection-grid");
  assert.equal(label({ typeHint: "collection", pageType: "home" }), "featured-collection");
});

test("a banner low on the page is not the hero", () => {
  assert.equal(label({ typeHint: "image-banner", blockIndex: 1 }), "hero");
  assert.equal(label({ typeHint: "image-banner", blockIndex: 6 }), "image-with-text");
  assert.equal(label({ typeHint: "hero", blockIndex: 6 }), "hero");
});

test("headers and footers in the wrong place are left for the AI", () => {
  assert.equal(label({ typeHint: "header", pageType: "product", blockIndex: 7, text: "Customer reviews" }), null);
  assert.equal(label({ typeHint: "footer", blockIndex: 3, lastIndex: 12 }), null);
});

test("vague names fall through to content rules or stay null", () => {
  assert.equal(label({ typeHint: "main" }), null);
  assert.equal(label({ typeHint: "rich-text", text: "Our story began in a small kitchen" }), null);
  assert.equal(label({ typeHint: "unknown", pageType: "product", blockIndex: 7, text: "Customer Reviews 4.6 Based on 32 reviews Write A Review" }), "product-reviews");
  assert.equal(label({ typeHint: "section", text: "Sign up to the Penguin newsletter for news and offers" }), "newsletter");
});

test("the buy box wins over the review and FAQ text it contains", () => {
  const buyBox = { typeHint: "main", pageType: "product", blockIndex: 2, text: "Daily Focus $39.00 4.8 Based on 120 reviews Add to cart FAQ" };
  assert.equal(label(buyBox), "buy-box");
  assert.equal(label({ ...buyBox, text: "Daily Focus Supplement 4.8 Based on 120 reviews" }), null);
});

test("a product card with a star rating is not a reviews block", () => {
  assert.equal(label({ typeHint: "unknown", text: "Top Seller $30.00 Rated 4.8 out of 5 120 reviews Wine Down $25.00 ADD TO BAG" }), null);
});

test("cart text on the cart page, not a header", () => {
  assert.equal(label({ typeHint: "rich-text", pageType: "cart", blockIndex: 1, top: 100, height: 120, text: "Your Cart" }), "cart-page");
});

test("legal text marks the footer only near the end of a real page", () => {
  assert.equal(label({ typeHint: "unknown", blockIndex: 11, lastIndex: 12, text: "© 2026 Brand. All rights reserved. Privacy policy" }), "footer");
  assert.equal(label({ typeHint: "unknown", blockIndex: 1, lastIndex: 1, text: "Shop Bag Shirt $136 © 2026 privacy policy" }), null);
});

test("every label is in the taxonomy and gets a page role", () => {
  const hints = ["footer", "header", "review", "newsletter", "faq", "hero", "video", "testimonials", "logo-list", "instagram", "blog", "compare",
    "timeline", "contact", "quiz", "gift-card", "bundle", "trust-icons", "text-with-icons", "collection-list", "product-tabs", "cta", "announcement-bar"];
  for (const typeHint of hints) {
    const b = block({ typeHint, blockIndex: typeHint === "header" || typeHint === "announcement-bar" ? 0 : typeHint === "footer" ? 12 : 5 });
    const l = labelBlock(b);
    assert.ok(l, typeHint);
    assert.ok(BLOCK_TYPES.includes(l.blockType), `${typeHint} -> ${l.blockType}`);
    assert.ok(pageRoleOf(l.blockType, b));
  }
});
