"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, KeyRound, LayoutGrid, LogOut, ShieldCheck } from "lucide-react";
import { logOutAction } from "@/app/(app)/account/actions";
import { useAccount } from "@/lib/account";
import { openSignIn } from "@/lib/sign-in";
import type { Account } from "@/contracts/api";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

/**
 * The header's right end. Signed out: Log in, which opens the popup
 * (sign-in-dialog.tsx). Signed in: a round avatar (the Google photo, or the
 * first letter of the name or email) opening a small menu with who you are,
 * your plan, and the account pages. A disclosure, not an ARIA menu: plain
 * links in tab order, closed by Escape, a click outside or a page change.
 */
export function AccountMenu() {
  const account = useAccount();
  if (account === undefined) return <span className="size-8 touch:size-11" aria-hidden />;
  if (account === null) {
    return (
      <button
        type="button"
        onClick={() => openSignIn()}
        className="inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch:h-11 touch:px-3.5"
      >
        Log in
      </button>
    );
  }
  return <Menu account={account} />;
}

function Menu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [leaving, startLeaving] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();

  // A page change (one of the menu's links) closes it.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const logOut = () =>
    startLeaving(async () => {
      await logOutAction();
      // In full, so everything on the page reads the signed-out account.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft navigation would keep the signed-in account in memory
      window.location.assign("/");
    });

  const item =
    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch:h-11 [&_svg]:size-4 [&_svg]:text-muted-foreground";

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account: ${account.email}`}
        className="inline-flex size-8 items-center justify-center rounded-full outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch:size-11"
      >
        <Avatar account={account} className="size-7" />
      </button>
      {open && (
        <div
          id={id}
          className="absolute top-full right-0 z-30 mt-2 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
            <Avatar account={account} className="size-9 text-[15px]" />
            <div className="min-w-0">
              {account.name && <p className="truncate text-[13px] font-medium">{account.name}</p>}
              <p className={cn("truncate text-[13px]", account.name ? "text-muted-foreground" : "font-medium")}>{account.email}</p>
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">{planLine(account)}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <nav aria-label="Account" className="flex flex-col">
            <Link href="/boards" className={item}><LayoutGrid />Boards</Link>
            <Link href="/account#security" className={item}><ShieldCheck />Account &amp; security</Link>
            <Link href="/account#api-keys" className={item}><KeyRound />API keys &amp; MCP</Link>
            <Link href="/account#plan" className={item}><CreditCard />Plan &amp; billing</Link>
          </nav>
          <div className="my-1 h-px bg-border" />
          <button type="button" onClick={logOut} disabled={leaving} className={cn(item, "w-full disabled:opacity-60")}>
            <LogOut />
            {leaving ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The Google photo, else the first letter of the name or the email on the brand colour. */
function Avatar({ account, className }: { account: Account; className?: string }) {
  const [broken, setBroken] = useState(false);
  const letter = (account.name || account.email).trim().charAt(0).toUpperCase() || "?";
  if (account.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small remote photo; next/image would need Google's host configured
      <img
        src={account.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground", className)}>
      {letter}
    </span>
  );
}

function planLine(account: Account): string {
  if (account.plan === "free" && account.access === "pro" && account.trialEndsAt) {
    const days = Math.max(1, Math.ceil((new Date(account.trialEndsAt).getTime() - Date.now()) / DAY));
    return `Pro trial · ${days} ${days === 1 ? "day" : "days"} left`;
  }
  return { free: "Free", pro: "Pro", team: "Team" }[account.plan];
}
