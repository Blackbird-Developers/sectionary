// Where the person has been inside the app, so a page's Back link can return
// them to the page they actually came from (Flows, a search, a board) rather
// than to a fixed parent they never visited.
//
// A stack of pathnames, mirrored from route changes by <NavTracker />. Query
// changes (filters, toggles) use router.replace and don't add entries, so only
// the pathname is compared. A change to the page just below the top is taken
// as a step back (browser Back, or a BackLink) and pops; anything else pushes.
//
// Module state, like lib/return-to.ts: it lives only as long as this tab's
// in-app session, so a pasted or refreshed link starts with nothing behind it
// and its Back link falls back to the page's usual parent.

let stack: string[] = [];
const listeners = new Set<() => void>();

/** Record a route change. Called by <NavTracker /> on every pathname change. */
export function recordVisit(pathname: string): void {
  const top = stack[stack.length - 1];
  if (top === pathname) return;
  if (stack.length >= 2 && stack[stack.length - 2] === pathname) stack = stack.slice(0, -1);
  else stack = [...stack, pathname].slice(-50);
  for (const listener of listeners) listener();
}

/**
 * The in-app page behind `pathname`, or null when there is none. Works whether
 * or not this page's own visit has been recorded yet, so a Back link is right
 * on its first render instead of correcting itself a frame later.
 */
export function previousPath(pathname: string): string | null {
  const path = trail(pathname);
  return path[path.length - 2] ?? null;
}

/** The visits up to and including `pathname`, whether or not it has been recorded yet. */
function trail(pathname: string): string[] {
  const n = stack.length;
  if (stack[n - 1] === pathname) return stack; // recorded already
  if (stack[n - 2] === pathname) return stack.slice(0, -1); // arriving by a step back
  return [...stack, pathname]; // arriving forward
}

/** The four sections of the top bar and tab bar, by their href. */
export type Section = "/" | "/flows" | "/sites" | "/boards";

/** Store and flow pages (/sites/<host>, /sites/<host>/flow) belong to whichever section led there. */
const isDetail = (pathname: string) => /^\/sites\/[^/]+/.test(pathname);

/** The section a page belongs to on its own, ignoring how the person got there. */
function ownSection(pathname: string): Section | null {
  if (pathname === "/") return "/";
  for (const s of ["/flows", "/sites", "/boards"] as const) if (pathname === s || pathname.startsWith(`${s}/`)) return s;
  return null;
}

/** The section a page shows as current when nothing led to it: a flow is Flows, a store is Sites. */
export function defaultSection(pathname: string): Section | null {
  if (/^\/sites\/[^/]+\/flow$/.test(pathname)) return "/flows";
  return ownSection(pathname);
}

/**
 * The section to light up in the nav for `pathname`. A store or flow page
 * keeps the section the person came from (Flows → a flow stays on Flows, a
 * search from Blocks stays on Blocks), walking back past other store and flow
 * pages; anything else is its own section.
 */
export function currentSection(pathname: string): Section | null {
  if (!isDetail(pathname)) return ownSection(pathname);
  const path = trail(pathname);
  for (let i = path.length - 2; i >= 0; i--) {
    if (isDetail(path[i])) continue;
    return ownSection(path[i]) ?? defaultSection(pathname);
  }
  return defaultSection(pathname);
}

export function subscribeVisits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A short name for an in-app page, for "← Flows" style links. */
export function pageLabel(pathname: string): string {
  if (pathname === "/") return "Blocks";
  if (pathname === "/flows") return "Flows";
  if (pathname === "/sites") return "Sites";
  if (/^\/sites\/[^/]+\/flow$/.test(pathname)) return "Flow";
  if (pathname.startsWith("/sites/")) return decodeURIComponent(pathname.split("/")[2] ?? "Store");
  if (pathname === "/boards") return "Boards";
  if (pathname.startsWith("/boards/") || pathname.startsWith("/b/")) return "Board";
  if (pathname === "/account") return "Account";
  return "Back";
}
