import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowsIndex, FlowsSkeleton } from "@/components/flows-index";
import { FIRST_FLOWS_SRC } from "@/lib/data-source";

export const metadata: Metadata = { title: "Flows" };

export default function FlowsRoute() {
  return (
    <>
      {/* The index's first page starts with the page, not after its JavaScript (see FIRST_FLOWS_SRC). */}
      {FIRST_FLOWS_SRC && <link rel="preload" as="fetch" href={FIRST_FLOWS_SRC} crossOrigin="anonymous" />}
      <Suspense fallback={<FlowsSkeleton />}>
        <FlowsIndex />
      </Suspense>
    </>
  );
}
