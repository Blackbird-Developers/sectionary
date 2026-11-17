// npm test   (node:test via tsx)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classOf, classifyResponse, diffOverlays, parseMomentKinds, popupVerdict, BUILT_KINDS } from './moment-logic.js';
import type { Overlay } from './moment-script.js';

let seq = 0;
const o = (over: Partial<Overlay>): Overlay => ({ key: `m${++seq}`, x: 0, y: 0, w: 100, h: 100, position: 'fixed', z: 10, text: '', textLength: 0, links: 0, buttons: 0, email: false, tel: false, ...over });
const withText = (text: string, over: Partial<Overlay> = {}) => o({ text, textLength: text.length, ...over });

test('which moments can be asked for', () => {
  // "safe" never touches a cart.
  assert.deepEqual(parseMomentKinds('safe'), ['first-visit-popup', 'menu-open', 'sticky-atc']);
  assert.deepEqual(parseMomentKinds('all'), BUILT_KINDS);
  assert.ok(parseMomentKinds('all').includes('add-to-cart'));
  assert.deepEqual(parseMomentKinds('menu-open, sticky-atc'), ['menu-open', 'sticky-atc']);
  assert.throws(() => parseMomentKinds('variant-change'), /not built yet/);
  assert.throws(() => parseMomentKinds('menu'), /unknown moment/);
});

test('panel shapes on a desktop screen (1440x900)', () => {
  // Cart drawer on the right edge.
  assert.equal(classOf(o({ x: 1040, y: 0, w: 400, h: 900 }), 1440, 900, false, false), 'drawer');
  // Centred modal over a backdrop.
  assert.equal(classOf(o({ x: 420, y: 200, w: 600, h: 500 }), 1440, 900, false, true), 'modal');
  // Off-centre box with no backdrop is not a modal.
  assert.equal(classOf(o({ x: 100, y: 200, w: 600, h: 500 }), 1440, 900, false, false), null);
  // Toast in a corner.
  assert.equal(classOf(withText('Added to your cart', { x: 1100, y: 20, w: 320, h: 80 }), 1440, 900, false, false), 'toast');
  // A full-width banner along the top is none of them.
  assert.equal(classOf(withText('Free shipping over $50', { x: 0, y: 0, w: 1440, h: 120 }), 1440, 900, false, false), null);
});

test('panel shapes on a phone screen (390x844)', () => {
  // Bottom sheet.
  assert.equal(classOf(o({ x: 0, y: 400, w: 390, h: 444 }), 390, 844, true, false), 'drawer');
  // Full-height menu drawer.
  assert.equal(classOf(o({ x: 0, y: 60, w: 390, h: 784 }), 390, 844, true, false), 'drawer');
  // Card in the middle.
  assert.equal(classOf(o({ x: 20, y: 200, w: 350, h: 400 }), 390, 844, true, false), 'modal');
});

test('the best panel: drawer, then modal, then toast', () => {
  const toast = withText('Added', { x: 1100, y: 20, w: 300, h: 70 });
  const drawer = o({ x: 1040, y: 0, w: 400, h: 900 });
  assert.equal(classifyResponse([toast, drawer], 1440, 900, false, false)?.overlay, drawer);
  assert.equal(classifyResponse([toast], 1440, 900, false, false)?.cls, 'toast');
  assert.equal(classifyResponse([], 1440, 900, false, false), null);
});

test('what appeared between two snapshots', () => {
  const header = withText('Shop About Cart', { key: 'm1', x: 0, y: 0, w: 1440, h: 80 });
  const before = [header];
  // Nothing new.
  assert.deepEqual(diffOverlays(before, [header], 1440, 900).found, []);
  // A backdrop and a modal: the backdrop goes, but is remembered.
  const backdrop = o({ key: 'm2', x: 0, y: 0, w: 1440, h: 900 });
  const modal = withText('Get 10% off your first order', { key: 'm3', x: 420, y: 200, w: 600, h: 500, email: true });
  const d = diffOverlays(before, [header, backdrop, modal], 1440, 900);
  assert.deepEqual(d.found.map((x) => x.key), ['m3']);
  assert.equal(d.backdrop, true);
  // A wrapper exactly around the modal: the inner one (scanned later) stays.
  const wrapper = withText('Get 10% off your first order', { key: 'm4', x: 420, y: 200, w: 600, h: 500 });
  const inner = withText('Get 10% off your first order', { key: 'm5', x: 420, y: 200, w: 600, h: 500, email: true });
  assert.deepEqual(diffOverlays(before, [header, wrapper, inner], 1440, 900).found.map((x) => x.key), ['m5']);
  // The header grew into a mega menu.
  const grown = withText('Shop About Cart Shirts Trousers Shoes Bags Hats', { key: 'm1', x: 0, y: 0, w: 1440, h: 420 });
  assert.deepEqual(diffOverlays(before, [grown], 1440, 900).found.map((x) => x.key), ['m1']);
});

test('marketing popups, and the dialogs that are not', () => {
  assert.equal(popupVerdict(withText('Join our list and get 15% off', { email: true })).ok, true);
  assert.equal(popupVerdict(withText('Unlock free shipping on your first order')).ok, true);
  assert.equal(popupVerdict(withText('We use cookies to improve your experience. Accept')).ok, false);
  assert.equal(popupVerdict(withText('Are you over 21 years old? Yes No')).ok, false);
  assert.equal(popupVerdict(withText('Choose your country to see local prices United States')).ok, false);
  assert.equal(popupVerdict(withText('Our story begins in 1998')).ok, false);
});
