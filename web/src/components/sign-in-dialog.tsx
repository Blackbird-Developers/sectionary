"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Logo } from "@/components/logo";
import { SignInForm, TermsNote } from "@/components/sign-in-form";
import { useAccount } from "@/lib/account";
import { onOpenSignIn, type SignInRequest } from "@/lib/sign-in";

/**
 * The log-in popup over the page, mounted once in the app shell. Opens from
 * the header's Log in button (openSignIn), and from any link to /account
 * while signed out: the "Sign in" and "Start free trial" links all over the
 * app open it in place instead of leaving the page, and the person comes
 * back to where they were (or to the link's ?next=). A link opened in a new
 * tab, or any link once signed in, still goes to /account as before.
 */
export function SignInDialog() {
  const account = useAccount();
  const [request, setRequest] = useState<(SignInRequest & { next: string }) | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const here = () => window.location.pathname + window.location.search;
    const show = (r: SignInRequest) => {
      setJoining(false);
      setRequest({ ...r, next: r.next ?? here() });
    };
    const stop = onOpenSignIn(show);

    // Only once the account has answered "signed out": while it loads, links behave as links.
    if (account !== null) return stop;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== "/account") return;
      e.preventDefault();
      show({ next: url.searchParams.get("next") ?? here() });
    };
    // Capture: ahead of next/link's own click handler.
    document.addEventListener("click", onClick, true);
    return () => {
      stop();
      document.removeEventListener("click", onClick, true);
    };
  }, [account]);

  return (
    <Dialog open={request !== null} onClose={() => setRequest(null)} className="max-w-[400px]">
      {request && (
        <div className="flex flex-col gap-5 px-6 pt-7 pb-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo className="size-9" />
            <div>
              <h2 className="font-heading text-[20px] font-extrabold tracking-[-0.03em]">{joining ? "Create your Blimp account" : "Log in to Blimp"}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                {request.reason ?? "No password: we email you a code."}
              </p>
            </div>
          </div>
          <SignInForm next={request.next} />
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[13px] text-muted-foreground">
              {joining ? "Already have an account? " : "New to Blimp? "}
              <button
                type="button"
                onClick={() => setJoining((j) => !j)}
                className="rounded font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {joining ? "Log in" : "Join"}
              </button>
            </p>
            <TermsNote />
          </div>
        </div>
      )}
    </Dialog>
  );
}
