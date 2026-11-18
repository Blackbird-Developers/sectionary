// An empty cart is a state, not a cart design. The crawler opens every cart page in a fresh browser with
// nothing added, so every cart captured so far was empty (all 501 on 17 Nov 2026), and the wall filed
// "Your cart is empty" under Cart. Such blocks are typed "empty-cart" (shown as "Empty cart") instead.
// capture-page.ts applies this to new captures, retype-blocks.ts to the ones already captured.

/**
 * How stores say the cart is empty, in the languages of the library. Checked against the 501 cart pages;
 * the second half is the wording a re-read on 17 Nov 2026 found ("Ain't nothing in here", "You haven't added
 * anything to cart", "Your cart is dry", "0 Items ... Subtotal $0.00").
 */
export const EMPTY_CART =
  /\b(?:cart|bag|basket|panier|warenkorb|carrito|carrello|winkelwagen|kurv|koszyk)\b[^.!?]{0,40}\b(?:empty|vide|leer|vac[ií]o|vuoto|leeg|tom|pusty|dry)\b|\bnothing in your (?:shopping )?(?:cart|bag|basket)\b|\bno (?:items|products)(?: added)? (?:in|to) your (?:shopping )?(?:cart|bag|basket)\b|\bnothing in here\b|\bhaven['’]t added anything\b|\b0 items?\b|enable cookies to use the shopping cart/i;

// Blocks around every page. A closed cart drawer in the header can carry the same words on any page.
const FRAME = /(?:^|-)(?:header|footer|navigation|announcement)(?:-|$)/;

/** True for the block of a cart page that says the cart is empty. */
export function isEmptyCartBlock(pageType: string | null | undefined, typeHint: string, text: string | null | undefined): boolean {
  return pageType === 'cart' && !FRAME.test(typeHint) && EMPTY_CART.test(text || '');
}
