import type { Metadata } from "next";
import { Suspense } from "react";
import { SitesGrid, SitesGridSkeleton } from "@/components/sites-grid";
import { FIRST_SITES_SRC, LIBRARY_COUNTS_SRC } from "@/lib/data-source";

export const metadata: Metadata = { title: "Sites" };

export default function SitesRoute() {
  return (
    <>
      {/* The list's first requests start with the page, not after its JavaScript (see FIRST_SITES_SRC). */}
      {FIRST_SITES_SRC && <link rel="preload" as="fetch" href={FIRST_SITES_SRC} crossOrigin="anonymous" />}
      {LIBRARY_COUNTS_SRC && <link rel="preload" as="fetch" href={LIBRARY_COUNTS_SRC} crossOrigin="anonymous" />}
      <Suspense fallback={<SitesGridSkeleton />}>
        <SitesGrid />
      </Suspense>
    </>
  );
}
