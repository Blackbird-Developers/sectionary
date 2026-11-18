import type { Metadata } from "next";
import { Suspense } from "react";
import { SavedLibrary } from "@/components/saved-library";

export const metadata: Metadata = { title: "Boards" };

// Suspense: the page reads its tab from the URL (useSearchParams). The older list (components/boards-list.tsx) is kept.
export default function BoardsRoute() {
  return (
    <Suspense>
      <SavedLibrary />
    </Suspense>
  );
}
