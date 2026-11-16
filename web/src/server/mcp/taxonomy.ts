// Mirror of platform/src/taxonomy.ts (block types, page roles, style tags,
// industries and the tagger's prompt version) for the MCP server. The web app
// cannot import from platform/ at runtime: turbopack.root is web/. Copied, not
// edited: src/server/mcp-taxonomy.test.ts fails when the two drift. To update,
// copy the same lines from platform/src/taxonomy.ts again.
//
// No imports, so node --test can load it as is.

export const PROMPT_VERSION = "tagger-v1.0";

/** PLAN.md section 8, global blocks, with the one-line meaning the model is given. */
export const GLOBAL_BLOCK_TYPES = {
  "announcement-bar": "thin strip above the header with a promo, shipping threshold or notice",
  "header-navigation": "logo, main menu, search, account and cart icons",
  hero: "the large opening banner of a page: headline, image or video, primary call to action",
  "usp-bar": "row of short selling points with icons (free shipping, returns, guarantees)",
  "logo-press-bar": "row of press, retailer or partner logos (\"as seen in\")",
  "image-with-text": "one image beside or behind a block of copy, a single story or feature",
  video: "a section whose main content is a video player or video embed",
  "features-grid": "grid or list of product or brand features, benefits or ingredients",
  testimonials: "customer quotes or written endorsements (not the product reviews widget)",
  "ugc-gallery": "grid or carousel of customer photos or social posts (Instagram, TikTok)",
  faq: "questions and answers, usually an accordion",
  newsletter: "email or SMS sign-up form",
  "cta-band": "short band whose job is one call to action",
  footer: "site footer: link columns, legal, payment icons, social links",
  "comparison-table": "table comparing products, plans or the brand against competitors",
  pricing: "plans or tiers with prices to choose between (not a single product's buy box)",
  team: "people: founders, team members, experts",
  "blog-teasers": "cards linking to articles, journal or blog posts",
  contact: "contact details or a contact form",
  stats: "large numbers as proof (\"1M customers\", \"4.8 stars\")",
  "how-it-works": "numbered steps or a timeline explaining a process",
  "app-download": "promotion of a mobile app with store badges",
  "trust-badges": "certification, security, payment or guarantee badges",
} as const;

/** PLAN.md section 8, e-commerce blocks. */
export const ECOMMERCE_BLOCK_TYPES = {
  "featured-collection": "a curated row or carousel of products on a home or landing page",
  "collection-grid": "the main product grid of a collection or category page, or a grid of collection tiles",
  "product-card": "a single product tile, or a section that is essentially one product card",
  "filter-sort-bar": "filters, facets and sort controls for a product listing",
  "product-gallery": "a product page's image gallery and thumbnails",
  "buy-box": "product title, price, variants and add to cart",
  "subscription-picker": "choice between one-time purchase and subscribe (and save), delivery frequency",
  "bundle-builder": "build-your-own bundle or kit: pick several items for a set price",
  "size-guide": "size chart, fit guide or measurement help",
  "shipping-returns": "shipping, delivery and returns information",
  "product-tabs": "product details in tabs or accordions (description, ingredients, how to use)",
  "product-reviews": "the reviews widget: star summary, review list, write a review",
  "cross-sell-upsell": "\"you may also like\", \"complete the look\", frequently bought together",
  "recently-viewed": "products the shopper viewed before",
  "sticky-add-to-cart": "add-to-cart bar fixed to the top or bottom while scrolling",
  "cart-drawer": "slide-out mini cart",
  "cart-page": "the cart page's line items, totals and checkout button",
  "checkout-step": "a checkout step: contact, shipping, payment",
  "order-confirmation": "thank-you or order status page content",
  account: "login, register or account dashboard",
  "search-results": "results of an on-site search",
  "quiz-finder": "a quiz or finder that recommends products",
  "store-locator": "find a physical store or stockist",
  "gift-card": "gift card purchase or balance",
} as const;

export const BLOCK_TYPES = [...Object.keys(GLOBAL_BLOCK_TYPES), ...Object.keys(ECOMMERCE_BLOCK_TYPES)] as BlockType[];
export type BlockType = keyof typeof GLOBAL_BLOCK_TYPES | keyof typeof ECOMMERCE_BLOCK_TYPES;

/** PLAN.md section 8, style. */
export const STYLE_TAGS = [
  "minimal", "bold", "playful", "luxury", "editorial", "brutalist",
  "dark", "pastel", "photo-led", "illustration-led", "typographic", "gradient",
] as const;
export type StyleTag = (typeof STYLE_TAGS)[number];

/** The app's industry keys (web/src/lib/stores.ts INDUSTRY_LABEL, src/fingerprints.ts), so tags and site filters agree. */
export const INDUSTRIES = [
  "fashion-apparel", "beauty-skincare", "food-drink", "supplements-wellness", "subscription-box", "kids-baby",
  "pets", "home-furniture", "jewellery-watches", "sports-outdoor", "tech-gadgets", "gifts-stationery", "other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Where the block sits in the page's story. */
export const PAGE_ROLES = {
  opening: "the first thing a visitor sees: top of the page, in the first screen",
  navigation: "site chrome that repeats on every page: announcement bar, header, menus",
  content: "the body of the page: what this page is about",
  conversion: "where the page asks for the purchase or sign-up: buy box, pricing, add to cart, sign-up",
  "social-proof": "reviews, testimonials, press, stats and badges that build trust",
  closing: "end of the page: final call to action, footer",
} as const;
export type PageRole = keyof typeof PAGE_ROLES;
export const PAGE_ROLE_KEYS = Object.keys(PAGE_ROLES) as PageRole[];
