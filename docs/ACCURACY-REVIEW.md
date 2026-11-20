# SEC-31 design metadata: the 20-store accuracy review

The release gate in brief section 10. Until it passes, `--styles` stays off by
default and there is no full recapture. A person does this with the browser's
developer tools; nothing here can be automated away.

## The 20 stores

Picked 20 Nov 2026 from production: every captured store with a home and a
product page at both viewports, one Shopify store per main industry (the
best-ranked), then every other platform in the library. **Swap in our own sites**
for any row (the brief asks for them; the repo has no list of them), keeping
the platform and industry spread.

| # | Store | Platform | Industry | Country | Home | Product |
|---|---|---|---|---|---|---|
| 1 | store.duolingo.com | shopify | fashion-apparel | EU | https://store.duolingo.com/ | https://store.duolingo.com/products/oscar-plushie |
| 2 | plumgoodness.com | shopify | beauty-skincare | IN | https://plumgoodness.com/ | https://plumgoodness.com/products/sebacleartm-mattifying-gel-creme-with-matcha-sebacic-acid-50g-full-size |
| 3 | stanley1913.com | shopify | food-drink | US | https://stanley1913.com/ | https://www.stanley1913.com/products/stanley-x-togethxr-adventure-stacking-beer-pint-16-oz |
| 4 | shop.penguin.co.uk | shopify | gifts-stationery | GB | https://shop.penguin.co.uk/ | https://shop.penguin.co.uk/products/pick-and-mix-deal-penguin-english-library |
| 5 | society6.com | shopify | home-furniture | US | https://society6.com/ | https://society6.com/products/orange-traditional-moroccan-design6407376_iphone-case |
| 6 | onlinedoctor.lloydspharmacy.com | shopify | supplements-wellness | GB | https://onlinedoctor.lloydspharmacy.com/ | https://onlinedoctor.lloydspharmacy.com/products/wegovy-tablets |
| 7 | nanit.com | shopify | kids-baby | US | https://nanit.com/ | https://www.nanit.com/products/the-best-sellers-bundle |
| 8 | choosemuse.com | shopify | sports-outdoor | US | https://choosemuse.com/ | https://choosemuse.com/products/muse-s-athena-premium-subscription-bundle-carbon |
| 9 | shop.hodinkee.com | shopify | jewellery-watches | US | https://shop.hodinkee.com/ | https://shop.hodinkee.com/products/zenith-chronomaster-original-triple-calendar-limited-edition-for-hodinkee |
| 10 | store-usa.arduino.cc | shopify | tech-gadgets | US | https://store-usa.arduino.cc/ | https://store-usa.arduino.cc/products/ventuno-q |
| 11 | openfarmpet.com | shopify | pets | US | https://openfarmpet.com/ | https://openfarmpet.com/products/wild-caught-salmon-ancient-grains-dry-dog-food |
| 12 | papyrusonline.com | woocommerce | gifts-stationery | US | https://papyrusonline.com/ | https://www.papyrusonline.com/product/recipe-for-perfection-birthday-greeting-card |
| 13 | aarkcollective.com | woocommerce | jewellery-watches | AU | https://aarkcollective.com/ | https://aarkcollective.com/products/era-gold/ |
| 14 | jcrew.com | nextjs | fashion-apparel |  | https://jcrew.com/ | https://www.jcrew.com/p/womens/categories/clothing/tees-and-tanks/CX381?display=standard&fit=Classic&colorProductCode=CX381&color_name=grey |
| 15 | merch.raycast.com | nextjs | kids-baby |  | https://merch.raycast.com/ | https://merch.raycast.com/product/heavy-tee-black |
| 16 | aaksonline.com | squarespace | other | GB | https://aaksonline.com/ | https://www.aaksonline.com/shop/p/curve-shoulder |
| 17 | americanleather.com | bigcommerce | home-furniture |  | https://americanleather.com/ | https://www.americanleather.com/products/cumulus-echo/ |
| 18 | veja-store.com | salesforce-commerce-cloud | sports-outdoor |  | https://veja-store.com/ | https://www.veja-store.com/fr_fr/p/campo-leather-white-grenat-CP0522144.html |
| 19 | hummingbirdbakery.com | magento | food-drink |  | https://hummingbirdbakery.com/ | https://www.hummingbirdbakery.com/product/pastel-rainbow-frosting-cake |
| 20 | alvamaice.com | webflow | other |  | https://alvamaice.com/ | https://www.alvamaice.com/product/sudadera-ziper |

## Step 1: capture them with styles (Lane A)

Only Lane A runs the crawler against third-party stores (CONTRIBUTING.md). One
capture per store, home and product page, both viewports:

```bash
npm run capture -- <home url> <product url> --styles
```

Then import as usual (`npm run import` in `platform/`, which also rebuilds
store profiles and benchmarks). Each capture's log line shows
`styles <ms>ms` per viewport and says when the design metadata was trimmed
to fit (`partial`).

**Also check here, from the 40 manifests:** design metadata under **20 KB per
viewport** and measuring under **1.5 s per viewport** (`pageStyles.ms`).

## Step 2: compare (a person, about 10 minutes a page)

Blimp's values: on the site, or through the API
(`/api/sites/<host>/design`, `/api/blocks/<id>`) or the MCP
(`blimp_get_page_profile`, `blimp_get_block` with `include: ["outline"]`).
Open the same page in Chrome at the same width (desktop 1440, phone 390),
Developer tools → Elements → Computed, and the Rendered Fonts list at the
bottom of the Computed tab.

For each of the 80 page views (20 stores × home, product × desktop, phone),
fill one row per check:

| Check | What to compare | Counts toward |
|---|---|---|
| Body font | family and size of a paragraph | fonts and sizes |
| Heading fonts | family and size of the h1 and of one h2 | fonts and sizes |
| Palette | the three largest colours (background, surface, text) | palette roles |
| Accent | the main button's background | palette roles |
| Primary button | background, text colour, corner radius, height | palette roles (colours), fonts and sizes (radius, height) |
| Headings | number of h1s; count per level (Elements, search `h2`) | fonts and sizes |
| Outlines | five blocks per page: is Blimp's outline a fair description of the screenshot? yes / no | outlines |

## The bars (all three must pass)

| | Bar |
|---|---|
| Fonts and sizes right | at least **95%** of checks |
| Palette roles right | at least **85%** of checks |
| Outlines judged fair | at least **85%** of blocks |

## Every miss

Record each miss, and its cause once known:

| Store | Page | Viewport | Check | Blimp said | Dev tools said | Cause |
|---|---|---|---|---|---|---|
| | | | | | | |

Tune only `STYLE_THRESHOLDS` in `src/style-script.ts`, with a comment naming the
stores behind each change, then run `npm run styles-check` and `npm test`.
Capture the stores whose checks failed again and recompare them.

## When the bars pass

1. Turn `--styles` on by default (`src/crawl.ts`, `src/capture.ts`), PR, deploy.
2. First controlled recapture (a few dozen stores). Watch capture errors,
   partial profiles, timing, manifest growth and bucket storage.
3. Then the full recapture.
