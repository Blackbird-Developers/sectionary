"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { requestSignIn, signInWithCode, type SignInState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { CODE_LENGTH, googleSignIn, RESEND_SECONDS } from "@/lib/sign-in";
import { useFinishSignIn } from "@/lib/finish-sign-in";
import { cn } from "@/lib/utils";

const idle: SignInState = { status: "idle" };
export const field =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive dark:bg-input/30";

const quiet =
  "rounded text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

/**
 * Log in and sign up are one flow (SEC-27): a new address simply gets an
 * account. Step one is Google or an email address; step two is the six-digit
 * code from the email. Until custom SMTP lets us change Supabase's email
 * (docs/AUTH-AND-BILLING.md) the email holds a link instead, which works too.
 */
export function SignInForm({ next }: { next: string }) {
  // "Use a different email" starts over with fresh form state.
  const [round, setRound] = useState(0);
  return <Steps key={round} next={next} restart={() => setRound((n) => n + 1)} />;
}

function Steps({ next, restart }: { next: string; restart: () => void }) {
  const [sent, send, sending] = useActionState(requestSignIn, idle);
  // The address the code went to, kept when a resend fails so the code step
  // stays; and how many emails have gone, which restarts the resend countdown.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sends, setSends] = useState(0);
  const [seen, setSeen] = useState(sent);
  if (seen !== sent) {
    setSeen(sent);
    if (sent.status === "sent") {
      setSentTo(sent.email);
      setSends((n) => n + 1);
    }
  }

  if (sentTo) {
    const resendError = sent.status === "error" ? sent.message : null;
    return <CodeStep email={sentTo} sends={sends} next={next} resend={send} resending={sending} resendError={resendError} restart={restart} />;
  }
  return <EmailStep next={next} sent={sent} send={send} sending={sending} />;
}

function EmailStep({ next, sent, send, sending }: { next: string; sent: SignInState; send: (form: FormData) => void; sending: boolean }) {
  const id = useId();
  const error = sent.status === "error" ? sent.message : null;
  return (
    <div className="flex flex-col gap-4">
      {googleSignIn && (
        <>
          {/* A full page load, not a client navigation: the route sends the browser on to Google. */}
          <a
            href={`/auth/google?next=${encodeURIComponent(next)}`}
            className="inline-flex h-11 items-center justify-center gap-2.5 rounded-lg border bg-card text-[14px] font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            or use email
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form action={send} noValidate className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <label htmlFor={`${id}-email`} className="text-[13px] text-muted-foreground">
          Email
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@studio.com"
          defaultValue={sent.status === "error" ? sent.email : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={field}
        />
        <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>
          {error}
        </p>
        <Button type="submit" size="lg" disabled={sending} className="group h-11 text-[14px] font-semibold">
          {sending ? "Sending…" : "Send code"}
          {!sending && <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" />}
        </Button>
      </form>
    </div>
  );
}

function CodeStep({
  email,
  sends,
  next,
  resend,
  resending,
  resendError,
  restart,
}: {
  email: string;
  sends: number;
  next: string;
  resend: (form: FormData) => void;
  resending: boolean;
  resendError: string | null;
  restart: () => void;
}) {
  const [checked, check, submitting] = useActionState(signInWithCode, idle);
  const checking = useFinishSignIn(checked) || submitting;
  const [code, setCode] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const error = checked.status === "error" ? checked.message : null;

  // A wrong code clears the boxes for the next try.
  const [seen, setSeen] = useState(checked);
  if (seen !== checked) {
    setSeen(checked);
    if (checked.status === "error") setCode("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
        <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-[14px] leading-snug text-pretty">
          <span className="font-medium">Check your email.</span>{" "}
          <span className="text-muted-foreground">
            We sent a sign-in code to <span className="text-foreground">{email}</span>. It works for an hour.
          </span>
        </p>
      </div>
      <form ref={form} action={check} className="flex flex-col gap-2" noValidate>
        <input type="hidden" name="email" value={email} />
        {/* Where to go, sent with the code: it holds for the code's whole hour, whatever this device's cookies say. */}
        <input type="hidden" name="next" value={next} />
        <label htmlFor={`${id}-code`} className="text-[13px] text-muted-foreground">
          Sign-in code
        </label>
        <CodeBoxes
          id={`${id}-code`}
          value={code}
          invalid={Boolean(error)}
          describedBy={error ? `${id}-code-error` : undefined}
          disabled={checking}
          onChange={(value) => {
            setCode(value);
            // All six typed or pasted: sign in without a click.
            if (value.length === CODE_LENGTH) queueMicrotask(() => form.current?.requestSubmit());
          }}
        />
        <p id={`${id}-code-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>
          {error}
        </p>
        <Button type="submit" size="lg" disabled={checking || code.length < CODE_LENGTH} className="h-11 text-[14px] font-semibold">
          {checking ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="text-[13px] text-muted-foreground">If the email has a link instead, opening it signs you in too.</p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <form action={resend}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <ResendButton key={sends} resending={resending} />
        </form>
        <button type="button" onClick={restart} className={quiet}>
          Use a different email
        </button>
      </div>
      {resendError && (
        <p aria-live="polite" className="text-[13px] text-destructive">
          {resendError}
        </p>
      )}
    </div>
  );
}

/**
 * Six boxes on one real input: typing, pasting, the phone's "from Messages /
 * Mail" suggestion and screen readers all see a single code field, and the
 * boxes are only how it looks.
 */
function CodeBoxes({
  id,
  value,
  invalid,
  describedBy,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  describedBy?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name="code"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        autoFocus
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === CODE_LENGTH - 1 && value.length === CODE_LENGTH));
          return (
            <div
              key={i}
              className={cn(
                "flex h-12 items-center justify-center rounded-lg border bg-background font-mono text-[20px] tabular-nums transition-colors dark:bg-input/30",
                invalid ? "border-destructive" : active ? "border-ring ring-2 ring-ring/40" : "border-input",
              )}
            >
              {value[i] ?? (active ? <span className="h-5 w-px animate-pulse bg-foreground" /> : null)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "Resend code", waiting RESEND_SECONDS from when it appeared. Keyed by the number of sends, so each email restarts the wait. */
function ResendButton({ resending }: { resending: boolean }) {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  const wait = Math.max(0, Math.ceil((shownAt + RESEND_SECONDS * 1000 - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= shownAt + RESEND_SECONDS * 1000) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [shownAt]);
  return (
    <button type="submit" disabled={resending || wait > 0} className={quiet}>
      {resending ? "Sending…" : wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

/** Under the sign-in form: continuing is the agreement, so there is no checkbox. */
export function TermsNote() {
  return (
    <p className="text-[12px] text-muted-foreground text-pretty">
      By continuing you agree to the{" "}
      <a href="/terms" className="underline underline-offset-2 hover:text-foreground">Terms</a> and{" "}
      <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</a>.
    </p>
  );
}
