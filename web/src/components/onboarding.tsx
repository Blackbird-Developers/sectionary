"use client";

import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { useAccount } from "@/lib/account";

// Loaded only for the one visit that shows it.
const OnboardingDialog = lazy(() => import("@/components/onboarding-dialog").then((m) => ({ default: m.OnboardingDialog })));

const subscribe = () => () => {};
/** Development only: ?onboarding in the address shows the questions with no database or sign-in. */
const forced = () => process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).has("onboarding");

/** The questions after the first sign-in, for an account that has not answered or skipped them yet. */
export function Onboarding() {
  const account = useAccount();
  const preview = useSyncExternalStore(subscribe, forced, () => false);
  const [done, setDone] = useState(false);
  if (done || !(preview || (account && !account.onboarded))) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingDialog onDone={() => setDone(true)} />
    </Suspense>
  );
}
