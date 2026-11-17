"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, LayoutGrid, Route, Store } from "lucide-react";
import { currentSection, defaultSection, subscribeVisits } from "@/lib/nav-history";

const NAV = [
  { href: "/", label: "Blocks", icon: LayoutGrid },
  { href: "/flows", label: "Flows", icon: Route },
  { href: "/sites", label: "Sites", icon: Store },
  { href: "/boards", label: "Boards", icon: Bookmark },
];

/**
 * The section to mark as current. Store and flow pages keep the section the
 * person came from (lib/nav-history), so arriving from Flows or a search
 * doesn't light up Sites. Server render and first paint use the page's own
 * default, so hydration matches.
 */
function useSection() {
  const pathname = usePathname();
  return useSyncExternalStore(subscribeVisits, () => currentSection(pathname), () => defaultSection(pathname));
}

/**
 * The four sections, in the top bar from tablet width up. A client component
 * only to mark the current one, which screen readers announce ("current
 * page") and the pill picks up. On phones the same four are the tab bar below.
 */
export function NavLinks() {
  const section = useSection();
  return (
    <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 md:flex">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={section === n.href ? "page" : undefined}
          className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Phones: the sections as a tab bar along the bottom edge, where a thumb
 * reaches, instead of four words squeezed into the top bar. 56px tall plus
 * the home-indicator inset; the page leaves room for it (see AppShell).
 */
export function MobileTabs() {
  const section = useSection();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex h-14 max-w-[480px] items-stretch">
        {NAV.map((n) => {
          const current = section === n.href;
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={current ? "page" : undefined}
              className="group flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground outline-none transition-colors duration-150 focus-visible:bg-muted aria-[current=page]:text-foreground"
            >
              <span className="flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,scale] duration-200 group-active:scale-90 group-aria-[current=page]:bg-primary/12 group-aria-[current=page]:text-primary">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Marks the page as scrolled (`data-scrolled` on <html>) so the top bar can sit
 * flat on the page at the top and lift onto a blurred, bordered strip once
 * content passes under it. One passive listener, one attribute; no state.
 */
export function ScrollFlag() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => root.toggleAttribute("data-scrolled", window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      root.removeAttribute("data-scrolled");
    };
  }, []);
  return null;
}
