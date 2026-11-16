import { Suspense } from "react";
import { Wall, WallFallback } from "@/components/wall";
import { FIRST_COUNTS_SRC, FIRST_WALL_SRC } from "@/lib/data-source";

export default function Home() {
  return (
    <>
      {/* Starts the wall's first data requests while the JavaScript is still
          downloading; the wall's own fetches then reuse the responses. */}
      <link rel="preload" as="fetch" href={FIRST_WALL_SRC} crossOrigin="anonymous" />
      {FIRST_COUNTS_SRC && <link rel="preload" as="fetch" href={FIRST_COUNTS_SRC} crossOrigin="anonymous" />}
      <Suspense fallback={<WallFallback />}>
        <Wall />
      </Suspense>
    </>
  );
}
