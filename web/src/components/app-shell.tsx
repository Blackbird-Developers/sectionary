import Link from "next/link";
import { CircleUser } from "lucide-react";
import { Logo } from "@/components/logo";
import { MobileTabs, NavLinks, ScrollFlag } from "@/components/nav-links";
import { CommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { PlanBadge } from "@/components/plan-badge";
import { AuthHashRedirect } from "@/components/auth-hash-redirect";
import { DevPlanSwitch } from "@/components/dev-plan-switch";
import { NavTracker } from "@/components/back-link";

/**
 * Top bar plus the page. From tablet width up: logo, the four sections, the
 * search in the middle where the eye lands, then plan, theme and account.
 * On phones the sections move to a tab bar along the bottom and the top bar
 * keeps the logo, search and account. The bar sits flat on the page at the
 * top and lifts onto a blurred strip once content scrolls under it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AuthHashRedirect />
      <NavTracker />
      {/* The first thing Tab reaches, so keyboard users can go straight past the bar. */}
      <a
        href="#main"
        className="sr-only z-30 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to content
      </a>
      <ScrollFlag />
      <header className="sticky top-0 z-20 border-b border-transparent bg-background transition-[background-color,border-color,box-shadow] duration-200 [html[data-scrolled]_&]:border-border [html[data-scrolled]_&]:bg-background/80 [html[data-scrolled]_&]:shadow-[0_1px_12px_rgb(0_0_0/0.05)] [html[data-scrolled]_&]:backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-2 px-3 sm:px-4">
          <Link href="/welcome" aria-label="Blimp home" className="flex items-center gap-2 rounded-md outline-none touch:h-11 focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
            <span className="font-heading text-[17px] font-extrabold tracking-[-0.045em]">blimp</span>
          </Link>
          <NavLinks />
          {/* The search: centred and wide from tablet up, an icon on phones. */}
          <div className="flex min-w-0 flex-1 justify-end md:justify-center md:px-4">
            <CommandPalette />
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground xl:inline">preview · sample data</span>
            <PlanBadge />
            <ThemeToggle />
            <Link
              href="/account"
              aria-label="Account"
              title="Account"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <CircleUser className="size-4" />
            </Link>
          </div>
        </div>
      </header>
      {/* Bottom padding on phones clears the tab bar and the home indicator. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1800px] flex-1 px-3 pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none sm:px-4 md:pb-4">{children}</main>
      <MobileTabs />
      {process.env.NODE_ENV === "development" && <DevPlanSwitch />}
    </div>
  );
}
