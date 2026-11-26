"use client";

import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { useAccount } from "@/lib/account";

// Loaded only for the one visit that shows it.
const OnboardingDialog = lazy(() => import("@/components/onboarding-dialog").then((m) => ({ default: m.OnboardingDialog })));

const subscribe = () => () => {};
/** Development only: ?onboarding in the address shows the questions with no database or sign-in. */
const forced = () => process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).has("onboarding");

/**
 * This browser has seen the questions for this account. The database is what
 * decides (users.onboarded_at); this only stops them coming back on this
 * device if saving the answers ever fails.
 */
const seenKey = (id: string) => `blimp-onboarded:${id}`;
const seenHere = (id: string) => {
  try {
    return localStorage.getItem(seenKey(id)) !== null;
  } catch {
    return false;
  }
};

/** The questions after a new account's first sign-in, until they are answered or skipped. */
export function Onboarding() {
  const account = useAccount();
  const preview = useSyncExternalStore(subscribe, forced, () => false);
  const seen = useSyncExternalStore(subscribe, () => (account ? seenHere(account.id) : false), () => false);
  const [done, setDone] = useState(false);
  if (done || !(preview || (account && !account.onboarded && !seen))) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingDialog
        onDone={() => {
          if (account) {
            try {
              localStorage.setItem(seenKey(account.id), new Date().toISOString());
            } catch {
              // Private mode or storage full: the database still has the answer.
            }
          }
          setDone(true);
        }}
      />
    </Suspense>
  );
}
