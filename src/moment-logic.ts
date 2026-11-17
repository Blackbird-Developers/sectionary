// Moments, the Node side that needs no browser: what appeared between two snapshots, what kind of panel
// it is, whether a popup is a marketing popup, and which kinds were asked for. Tested in
// src/moment-logic.test.ts; the browser half is src/moment-script.ts, the runner src/moments.ts.
import type { MomentKind } from '../web/src/contracts/manifest.js';
import type { Overlay } from './moment-script.js';

/** Every kind in the contract, in the order a page runs them (state-changing kinds last). */
export const ALL_KINDS: MomentKind[] = ['first-visit-popup', 'menu-open', 'sticky-atc', 'variant-change', 'quick-view', 'add-to-cart', 'cart-drawer'];
/** What this crawler can capture so far: phase 1 of the moments brief, and phase 3 (carts; cart brief option B). */
export const BUILT_KINDS: MomentKind[] = ['first-visit-popup', 'menu-open', 'sticky-atc', 'add-to-cart', 'cart-drawer'];
/** Kinds that never touch a cart (phases 1 and 2), for `--moments safe`. */
export const SAFE_KINDS: MomentKind[] = ['first-visit-popup', 'menu-open', 'sticky-atc', 'variant-change', 'quick-view'];

/** `--moments first-visit-popup,menu-open` | `safe` | `all`, limited to what is built. Throws on a typo or an unbuilt kind. */
export function parseMomentKinds(arg: string): MomentKind[] {
  const asked = arg === 'safe' ? SAFE_KINDS : arg === 'all' ? ALL_KINDS : arg.split(',').map((s) => s.trim()).filter(Boolean);
  const named = arg === 'safe' || arg === 'all';
  const out: MomentKind[] = [];
  for (const k of asked) {
    if (!ALL_KINDS.includes(k as MomentKind)) throw new Error(`unknown moment "${k}" (kinds: ${ALL_KINDS.join(', ')}, or safe, all)`);
    if (!BUILT_KINDS.includes(k as MomentKind)) {
      if (named) continue;
      throw new Error(`moment "${k}" is not built yet (built: ${BUILT_KINDS.join(', ')})`);
    }
    if (!out.includes(k as MomentKind)) out.push(k as MomentKind);
  }
  return out;
}

/**
 * The numbers detection runs on. Starting values from the moments brief (sections 6.5, 7.1 to 7.3), from
 * general knowledge of storefront themes; tune them on the review sheets and note here which stores
 * moved a number and why.
 */
export const MOMENT_THRESHOLDS = {
  /** A box that grew by more than this share, in width or height, counts as new. */
  grow: 0.3,
  /** Within this many pixels of an edge, a box touches it. */
  edge: 8,
  /** A full-screen backdrop: at least this share of width and height, fewer than this many characters. */
  backdrop: { w: 0.9, h: 0.8, maxText: 20 },
  desktop: {
    drawer: { minH: 0.6, minW: 0.18, maxW: 0.6 },
    modal: { minW: 0.2, maxW: 0.9, minH: 0.2, maxH: 0.95, centred: 0.1 },
    toast: { maxArea: 0.12, band: 0.35 },
  },
  phone: {
    drawer: { minW: 0.85, minHAtBottom: 0.5, minH: 0.85 },
    modal: { minW: 0.7, minH: 0.25, maxH: 0.85 },
    toast: { maxArea: 0.2, nearEdge: 120 },
  },
  toastText: { min: 3, max: 200 },
  /** menu-open on desktop: the open menu covers at least this share of the screen. */
  menuMinArea: 0.15,
  menuMinLinks: 4,
  /**
   * menu-open on a phone, a menu that is not a drawer: the header itself grows to hold it
   * (myirelandbox.com: the sticky header goes from 169 to 629px tall). At least this share of the screen.
   */
  phoneMenuInFlow: { minW: 0.85, minH: 0.5 },
  /** A box this much larger than at rest has grown; a text change alone is not a menu opening (myirelandbox.com's header). */
  menuGrow: 1.3,
};

export type PanelClass = 'drawer' | 'modal' | 'toast';

/** What appeared: new boxes, boxes that grew or whose words changed. Ancestors that only wrap a result go, so does a backdrop. */
export function diffOverlays(before: Overlay[], after: Overlay[], vw: number, vh: number): { found: Overlay[]; backdrop: boolean } {
  const T = MOMENT_THRESHOLDS;
  const was = new Map(before.map((o) => [o.key, o]));
  let changed = after.filter((o) => {
    const b = was.get(o.key);
    if (!b) return true;
    return o.w > b.w * (1 + T.grow) || o.h > b.h * (1 + T.grow) || (o.text !== b.text && o.textLength > 0);
  });
  let backdrop = false;
  changed = changed.filter((o) => {
    const full = o.w >= vw * T.backdrop.w && o.h >= vh * T.backdrop.h && o.textLength < T.backdrop.maxText;
    if (full) backdrop = true;
    return !full;
  });
  // Keep the innermost element that still holds the content: drop a result that only wraps another one
  // (box within 5%, same words). The snapshot has no tree, so containment is read from the boxes; for two
  // identical boxes the one scanned later (a child comes after its parent) is the inner one.
  const num = (o: Overlay) => parseInt(o.key.slice(1), 10) || 0;
  const inside = (a: Overlay, b: Overlay) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const wraps = (outer: Overlay, inner: Overlay) =>
    outer !== inner &&
    inside(inner, outer) &&
    inner.w * inner.h >= outer.w * outer.h * 0.95 &&
    inner.textLength >= outer.textLength * 0.95 &&
    (inner.w * inner.h < outer.w * outer.h || num(inner) > num(outer));
  const found = changed.filter((o) => !changed.some((c) => wraps(o, c)));
  return { found, backdrop };
}

/** Which kind of panel a box is, if any: the brief's table in 6.5. */
export function classOf(o: Overlay, vw: number, vh: number, phone: boolean, backdrop: boolean): PanelClass | null {
  const T = MOMENT_THRESHOLDS;
  const wPct = Math.min(o.w, vw) / vw;
  const hPct = Math.min(o.h, vh) / vh;
  const left = o.x <= T.edge;
  const right = o.x + o.w >= vw - T.edge;
  const top = o.y <= T.edge;
  const bottom = o.y + o.h >= vh - T.edge;
  const area = (Math.min(o.w, vw) * Math.min(o.h, vh)) / (vw * vh);
  const toastText = o.textLength >= T.toastText.min && o.textLength <= T.toastText.max;
  if (!phone) {
    const d = T.desktop;
    if (hPct >= d.drawer.minH && wPct >= d.drawer.minW && wPct <= d.drawer.maxW && (left || right)) return 'drawer';
    const centred = Math.abs(o.x + o.w / 2 - vw / 2) <= vw * d.modal.centred;
    if (wPct >= d.modal.minW && wPct <= d.modal.maxW && hPct >= d.modal.minH && hPct <= d.modal.maxH && !left && !right && (backdrop || centred)) return 'modal';
    const cx = (o.x + o.w / 2) / vw;
    const cy = (o.y + o.h / 2) / vh;
    const inBand = cx <= d.toast.band || cx >= 1 - d.toast.band || cy <= d.toast.band || cy >= 1 - d.toast.band;
    if (area <= d.toast.maxArea && toastText && inBand) return 'toast';
    return null;
  }
  const p = T.phone;
  if (wPct >= p.drawer.minW && ((hPct >= p.drawer.minHAtBottom && bottom) || hPct >= p.drawer.minH)) return 'drawer';
  if (wPct >= p.modal.minW && hPct >= p.modal.minH && hPct < p.modal.maxH && !top && !bottom) return 'modal';
  const nearEdge = o.y <= p.toast.nearEdge || vh - (o.y + o.h) <= p.toast.nearEdge;
  if (area <= p.toast.maxArea && toastText && nearEdge) return 'toast';
  return null;
}

/** The best panel among candidates: drawer, then modal, then toast; the largest within a class. */
export function classifyResponse(candidates: Overlay[], vw: number, vh: number, phone: boolean, backdrop: boolean): { cls: PanelClass; overlay: Overlay } | null {
  const rank: Record<PanelClass, number> = { drawer: 0, modal: 1, toast: 2 };
  let best: { cls: PanelClass; overlay: Overlay } | null = null;
  for (const o of candidates) {
    const cls = classOf(o, vw, vh, phone, backdrop);
    if (!cls) continue;
    if (!best || rank[cls] < rank[best.cls] || (rank[cls] === rank[best.cls] && o.w * o.h > best.overlay.w * best.overlay.h)) best = { cls, overlay: o };
  }
  return best;
}

const OFFER = /\b(\d{1,2}\s?%|off|discount|subscribe|sign up|signup|newsletter|join|unlock|welcome|first order|free shipping|giveaway)\b/i;
const NOT_MARKETING: [RegExp, string][] = [
  [/cookie|gdpr|consent|privacy preferences/i, 'consent'],
  [/\b(18|21)\+?\b.*\b(age|old|years)\b|are you over|of legal (drinking )?age|date of birth/i, 'age-gate'],
  [/choose your (country|location|region|language)|shipping to|select your (country|region)|change (country|region)|you('re| are) (visiting|viewing|shopping)/i, 'location-picker'],
];

/** The brief's rules 5 and 6 (7.1): a marketing popup has a sign-up field or offer words; consent, age and country dialogs are not. */
export function popupVerdict(o: Overlay): { ok: boolean; reason: string } {
  for (const [re, reason] of NOT_MARKETING) if (re.test(o.text)) return { ok: false, reason };
  if (o.email || o.tel) return { ok: true, reason: o.email ? 'email field' : 'phone field' };
  if (OFFER.test(o.text)) return { ok: true, reason: 'offer wording' };
  return { ok: false, reason: 'no sign-up field or offer' };
}
