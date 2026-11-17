// npm test   (node:test via tsx)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyCartBlock } from './empty-cart.js';

test('empty-cart wording from real cart pages, in several languages', () => {
  for (const text of [
    'CART Your cart is currently empty. CONTINUE SHOPPING',
    'Your bag is empty Shop new arrivals',
    'No items added to your bag CONTINUE SHOPPING',
    'Shopping Cart You have no products in your shopping cart. EXPLORE COLLECTIONS',
    'Shopping Cart You have nothing in your shopping cart. Continue Shopping',
    'Ihr Warenkorb ist leer Weiter einkaufen',
    'Votre panier est vide',
    'Tu carrito está vacío',
    'Il tuo carrello è vuoto',
    'Je winkelwagen is leeg',
    'Twój koszyk jest pusty',
    "Shopping Cart Ain't nothing in here. Time to go shopping! Continue Shopping",
    'Shopping Cart CONTINUE SHOPPING You haven’t added anything to cart. START SHOPPING',
    "YOUR CART IS DRY Let's Get Wet",
    'My Cart 0 Items Product Price Quantity Subtotal $0.00',
    'Your cart Enable cookies to use the shopping cart',
  ]) assert.equal(isEmptyCartBlock('cart', 'main-cart-items', text), true, text);
});

test('not an empty cart', () => {
  // A cart with things in it.
  assert.equal(isEmptyCartBlock('cart', 'main-cart-items', 'Your cart Socks x 2 Subtotal $40.00 Check out'), false);
  // "cart" near a word that only starts like "tom".
  assert.equal(isEmptyCartBlock('cart', 'main-cart-items', 'Add to cart and get it tomorrow'), false);
  // "10 items" is not "0 items".
  assert.equal(isEmptyCartBlock('cart', 'main-cart-items', 'Your cart 10 items Subtotal $240.00 Check out'), false);
  // A closed cart drawer inside the header says it on every page.
  assert.equal(isEmptyCartBlock('cart', 'header', 'Menu Search Your cart is empty'), false);
  assert.equal(isEmptyCartBlock('cart', 'site-header', 'Menu Search Your cart is empty'), false);
  assert.equal(isEmptyCartBlock('cart', 'footer-part', 'Your cart is empty'), false);
  // Only on cart pages.
  assert.equal(isEmptyCartBlock('product', 'main', 'Your cart is empty'), false);
  assert.equal(isEmptyCartBlock(null, 'main', 'Your cart is empty'), false);
});
