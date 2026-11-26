"use client";

import { useEffect } from "react";

/**
 * After a sign-in action says "done": a full page load of where to go, not a
 * client navigation. The account is read once per page load (lib/account.ts),
 * so a soft redirect would leave the header, the plan locks and the questions
 * after the first sign-in showing the signed-out page. Returns true while the
 * page is on its way, so the form can keep saying "Signing in…".
 */
export function useFinishSignIn(state: { status: string; next?: string }): boolean {
  const done = state.status === "done" && typeof state.next === "string";
  useEffect(() => {
    if (done) window.location.assign(state.next!);
  }, [done, state.next]);
  return done;
}
