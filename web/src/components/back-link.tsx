"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageLabel, previousPath, recordVisit, subscribeVisits } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

/** Mirrors route changes into lib/nav-history. Mounted once, in the app shell. */
export function NavTracker() {
  const pathname = usePathname();
  useEffect(() => recordVisit(pathname), [pathname]);
  return null;
}

/**
 * A page's Back link. When the person reached this page from another page in
 * the app, it goes back there (a real history step, so that page's filters and
 * scroll come back with it) and is named after it. Opened straight from a
 * link or a refresh, it goes to the page's usual parent instead.
 */
export function BackLink({ fallbackHref, fallbackLabel, className }: { fallbackHref: string; fallbackLabel: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // Server render and first paint use the fallback, so hydration matches.
  const previous = useSyncExternalStore(subscribeVisits, () => previousPath(pathname), () => null);
  const label = !previous ? fallbackLabel : previous === fallbackHref ? fallbackLabel : pageLabel(previous);

  return (
    <Link
      href={previous ?? fallbackHref}
      onClick={(event) => {
        if (!previous || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.back();
      }}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:-my-3 touch:h-11 touch:pr-3",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" /> {label}
    </Link>
  );
}
