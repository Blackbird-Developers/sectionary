import Link from "next/link";
import { Logo } from "@/components/logo";
import { LEGAL_PAGES } from "@/lib/site";

// Marketing words (brand voice): Blocks are "sections", Flows are "journeys".
// Same routes as the app's own nav.
const NAV = [
  { href: "/", label: "Sections" },
  { href: "/flows", label: "Journeys" },
  { href: "/sites", label: "Sites" },
];

/**
 * The footer under the landing page and the legal pages (SEC-25, SEC-29):
 * the wordmark, the attribution note, and the library and legal links.
 * Moved here from the marketing layout when those pages took the app's bar.
 */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm space-y-3">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="font-heading text-[17px] font-extrabold tracking-[-0.045em]">
              blimp
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Every section links back to the store it came from. Brand names
            identify a store; they don&apos;t mean it endorses us. We host our
            screenshots only, never a store&apos;s code or images.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-10 text-[13px]">
          <ul className="space-y-2">
            <li className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Library
            </li>
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            <li className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Legal
            </li>
            {LEGAL_PAGES.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-[1200px] px-4 pb-8 font-mono text-[11px] text-muted-foreground sm:px-6">
        © 2026 Blimp
      </div>
    </footer>
  );
}
