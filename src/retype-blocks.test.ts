// npm test   (node:test via tsx)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIdKey, nameFromKey, retype, type Stored } from './retype-blocks.js';

const block = (over: Partial<Stored>): Stored => ({ typeHint: 'unknown', parentType: null, elementId: null, classes: 'shopify-section', headline: null, tag: 'div', height: 400, ...over });
const sid = (key: string) => `shopify-section-template--15921970937904__${key}`;

test('IDs are IDs, short real names are not', () => {
  for (const id of ['1148845a-a334-49ac-8a50-943995d6922a', 'ad1c7de4-6c16-4f51-815d-9fe8f7a3a', '16359276425da8ce', '1566389874427', '1653644353f', '', 'template--23023421489227__1695849321ce59c7f4', 'eb1589f0104cabd'])
    assert.equal(isIdKey(id), true, id);
  for (const name of ['faq', 'ugc', 'cta', 'main', 'hero-banner', 'image-with-text', 'deco'])
    assert.equal(isIdKey(name), false, name);
});

test('key names keep their words, lose the random tag', () => {
  assert.equal(nameFromKey('hero_banner_kCjXcf'), 'hero-banner');
  assert.equal(nameFromKey('image_banner'), 'image-banner');
  assert.equal(nameFromKey('featured_collection'), 'featured-collection');
  assert.equal(nameFromKey('footer_custom_dpdhwt'), 'footer-custom');
  assert.equal(nameFromKey('header_section'), 'header');
  assert.equal(nameFromKey('slideshow_2'), 'slideshow');
  assert.equal(nameFromKey('shogun-custom-html-2660ea50-7bd9-4956-ba0d-02d2a9e15c3f'), 'shogun-custom-html');
});

test('an ID type takes the name in the wrapper class', () => {
  const key = '1634081007a6f67ae9';
  assert.deepEqual(retype(block({ typeHint: '1634081007a6f67ae', elementId: sid(key), classes: 'shopify-section section-product-quick-features' })), { typeHint: 'product-quick-features', parentType: null });
  assert.equal(retype(block({ typeHint: '1148845a-a334-49ac-8a50-943995d6922a', elementId: sid('1148845a-a334-49ac-8a50-943995d6922a'), classes: 'shopify-section shopify-section--video' })).typeHint, 'video');
});

test('an ID type falls back to class words, then the heading, then the section group, then "unknown"', () => {
  const id = 'd0359d86-9115-47a8-9629-183f723f6a85';
  const base = { typeHint: 'd0359d86-9115-47a8-9629-183f723f6a', elementId: sid(id) };
  assert.equal(retype(block({ ...base, classes: 'shopify-section full-width-hero' })).typeHint, 'hero');
  assert.equal(retype(block({ ...base, headline: 'Questions? We\'re all ears' })).typeHint, 'faq');
  assert.equal(retype(block({ ...base, headline: 'Customer reviews' })).typeHint, 'review');
  assert.equal(retype(block({ ...base, classes: 'shopify-section shopify-section-group-footer-group' })).typeHint, 'footer');
  assert.equal(retype(block({ ...base, headline: 'Welcome to Wonder Valley' })).typeHint, 'unknown');
  assert.equal(retype(block({ ...base, classes: 'shopify-section index-section', height: 435, headline: null })).typeHint, 'unknown');
});

test('the piece of a section with an ID key loses the ID', () => {
  assert.deepEqual(retype(block({ typeHint: 'eb1589f0104cabd-part', parentType: 'eb1589f0104cabd', classes: null })), { typeHint: 'unknown', parentType: null });
  assert.deepEqual(retype(block({ typeHint: '1662295323b8b15fea-part', parentType: '1662295323b8b15fea', classes: 'pin-spacer', headline: 'Lifecycle study results: Proven better' })), { typeHint: 'unknown', parentType: null });
});

test('an empty type (all-digit key) and an ID data-section-type are fixed', () => {
  assert.equal(retype(block({ typeHint: '', elementId: 'shopify-section-1596832133778' })).typeHint, 'unknown');
  assert.equal(retype(block({ typeHint: '', elementId: sid('1603404609097'), classes: 'shopify-section fifty-fifty' })).typeHint, 'unknown');
  assert.equal(retype(block({ typeHint: 'template--23023421489227__1695849321ce59c7f4', elementId: sid('1695849321ce59c7f4'), headline: 'Frequently asked questions' })).typeHint, 'faq');
});

test('names cut short by the old clean-up are repaired', () => {
  assert.equal(retype(block({ typeHint: 'image', elementId: sid('image_banner') })).typeHint, 'image-banner');
  assert.equal(retype(block({ typeHint: 'featured', elementId: sid('featured_collection') })).typeHint, 'featured-collection');
  assert.equal(retype(block({ typeHint: 'footer-section', elementId: 'shopify-section-sections--123__footer-section' })).typeHint, 'footer');
});

test('the empty-cart message on a cart page becomes "empty-cart", nowhere else', () => {
  const text = 'CART Your cart is currently empty. CONTINUE SHOPPING';
  assert.equal(retype(block({ typeHint: 'main', elementId: sid('main'), pageType: 'cart', text })).typeHint, 'empty-cart');
  assert.equal(retype(block({ typeHint: 'header', elementId: 'shopify-section-sections--1__header', pageType: 'cart', text })).typeHint, 'header');
  assert.equal(retype(block({ typeHint: 'main', elementId: sid('main'), pageType: 'product', text })).typeHint, 'main');
  assert.equal(retype(block({ typeHint: 'main', elementId: sid('main'), pageType: 'cart', text: 'Socks x 2 Subtotal $40.00' })).typeHint, 'main');
});

test('names from anything but the key stay', () => {
  // data-section-type said pxs-slideshow; the key would say dynamic-slideshow.
  assert.equal(retype(block({ typeHint: 'pxs-slideshow', elementId: sid('dynamic_slideshow') })).typeHint, 'pxs-slideshow');
  assert.equal(retype(block({ typeHint: 'main', elementId: sid('main') })).typeHint, 'main');
  assert.equal(retype(block({ typeHint: 'hero', elementId: null, classes: 'hero-area', tag: 'section' })).typeHint, 'hero');
  assert.equal(retype(block({ typeHint: 'unknown', elementId: null, classes: 'w-full grid' })).typeHint, 'unknown');
  assert.equal(retype(block({ typeHint: 'product-grid-part', parentType: 'product-grid', elementId: null })).parentType, 'product-grid');
});
