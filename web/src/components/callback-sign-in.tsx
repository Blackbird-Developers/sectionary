"use client";

import { useActionState, useEffect, useRef, useSyncExternalStore } from "react";
import { useFinishSignIn } from "@/lib/finish-sign-in";
import Link from "next/link";
import { signInWithAccessToken, type CallbackState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

const idle: CallbackState = { status: "idle" };

type Landing = { token: string } | { error: string } | null;

/** Reads the fragment Supabase redirected with, once, and takes it out of the address bar. */
let landing: Landing | undefined;
function readLanding(): Landing {
  if (landing !== undefined) return landing;
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const token = params.get("access_token");
  const error = params.get("error_code") ?? params.get("error");
  landing = token ? { token } : error ? { error } : null;
  // The token should not sit in the address bar, the history or a copied link.
  if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
  return landing;
}
const subscribe = () => () => {};

/**
 * Signs in with the token from Supabase's default email link or Google: on its
 * own when this browser started that sign-in, otherwise after "Continue as …?".
 */
export function CallbackSignIn() {
  const found = useSyncExternalStore(subscribe, readLanding, () => undefined);
  const [state, submit, submitting] = useActionState(signInWithAccessToken, idle);
  const pending = useFinishSignIn(state) || submitting;
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (found && "token" in found) form.current?.requestSubmit();
  }, [found]);

  if (found === undefined) return <Signing />;

  if (!found || "error" in found) {
    const expired = found && /expired|denied/i.test(found.error);
    return (
      <p className="text-[14px] text-muted-foreground">
        {expired ? "That sign-in expired, was already used or was cancelled." : "This link is missing its sign-in token."}{" "}
        <Link href="/account" className="text-link underline-offset-4 hover:underline">Try again</Link>.
      </p>
    );
  }

  // This browser did not start the sign-in (another device, or a link someone
  // else made from their own token): say whose account it is and wait for a press.
  if (state.status === "confirm") {
    return (
      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="access_token" value={found.token} />
        <input type="hidden" name="confirmed" value="1" />
        <p className="text-[14px] text-foreground">
          Sign in to Blimp as <strong className="font-semibold break-all">{state.email}</strong>?
        </p>
        <p className="text-[13px] text-muted-foreground">Only continue if you asked for this sign-in and this is your email.</p>
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-[14px] font-semibold">
          {pending ? "Signing you in…" : "Continue"}
        </Button>
        <Link href="/" className="text-center text-[13px] text-link underline-offset-4 hover:underline">
          That&apos;s not me
        </Link>
      </form>
    );
  }

  return (
    <form ref={form} action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="access_token" value={found.token} />
      <Signing label={pending ? "Signing you in…" : "Finishing sign-in on this device."} busy={pending || state.status !== "error"} />
      {state.status === "error" && (
        <>
          <p aria-live="polite" className="text-[13px] text-destructive">
            {state.message}{" "}
            <Link href="/account" className="text-link underline-offset-4 hover:underline">Send a new link</Link>
          </p>
          <Button type="submit" size="lg" variant="outline" disabled={pending} className="h-11 text-[14px] font-semibold">
            Try again
          </Button>
        </>
      )}
    </form>
  );
}

/** The wait, with the Blimp tile drifting beside it. */
function Signing({ label = "Signing you in…", busy = true }: { label?: string; busy?: boolean }) {
  return (
    <p role="status" className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
      <Logo spinning={busy} className="size-5" />
      {label}
    </p>
  );
}
