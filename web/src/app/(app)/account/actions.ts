"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { currentUser, EMAIL_COOKIE, endOtherSessions, finishTwoStep, rememberSignIn, safeNext, signOut, signOutEverywhere, startSession, takeNext } from "@/server/auth";
import { AuthError, sendMagicLink, userFromAccessToken, verifyCode, verifyTokenHash } from "@/server/supabase-auth";
import { portalUrl } from "@/server/paddle";
import { beginSetup, confirmSetup, disable, regenerateRecoveryCodes, TwoStepCodeError } from "@/server/two-step";
import { TwoStepError } from "@/server/totp";
import { revalidatePath } from "next/cache";
import { clientIp, hit, limitKey, RateLimitError } from "@/server/rate-limit";
import { configuredOrigin } from "@/server/site-url";
import { ApiKeyError, createApiKey, revokeApiKey } from "@/server/api-keys";
import { saveOnboarding } from "@/server/accounts";
import { PAGES, ROLES } from "@/lib/sign-in";
import { INDUSTRY_LABEL } from "@/lib/stores";

const ROLE_VALUES = new Set<string>(ROLES.map((r) => r.value));
const PAGE_VALUES = new Set<string>(PAGES.map((p) => p.value));
const INDUSTRY_VALUES = new Set(Object.keys(INDUSTRY_LABEL));

// SEC-27 sign-in and SEC-28 billing actions. Thin: the work is in src/server.

const MINUTE = 60;
const ip = async () => clientIp(await headers());

// Every sign-in step is limited per visitor IP, and by address or account
// where there is one (server/rate-limit.ts says why Supabase's own are not enough).
/** Sign-in emails: five an hour per address, twenty per IP. */
const emailLimits = async (email: string) => [
  { key: limitKey("signin-email", email), max: 5, windowSeconds: 60 * MINUTE },
  { key: limitKey("signin-email-ip", await ip()), max: 20, windowSeconds: 60 * MINUTE },
];
/** Guesses at the email code: ten per address in fifteen minutes, thirty per IP. */
const codeLimits = async (email: string) => [
  { key: limitKey("signin-code", email), max: 10, windowSeconds: 15 * MINUTE },
  { key: limitKey("signin-code-ip", await ip()), max: 30, windowSeconds: 15 * MINUTE },
];
/** Email links and authenticator codes at sign-in: thirty per IP in fifteen minutes. */
const linkLimits = async () => [{ key: limitKey("signin-link-ip", await ip()), max: 30, windowSeconds: 15 * MINUTE }];
/**
 * Authenticator codes from a signed-in account (turning two-step on or off,
 * new recovery codes): ten in fifteen minutes, so a stolen session cannot
 * guess its way to switching two-step off.
 */
const accountCodeLimits = (userId: string) => [{ key: `two-step:u:${userId}`, max: 10, windowSeconds: 15 * MINUTE }];

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  /** Signed in: the page loads `next` in full (lib/finish-sign-in.ts), so the header and everything else read the new account. */
  | { status: "done"; next: string }
  | { status: "error"; message: string; email: string; step: "email" | "code" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const message = (error: unknown) => {
  if (error instanceof AuthError || error instanceof TwoStepCodeError || error instanceof TwoStepError || error instanceof RateLimitError || error instanceof ApiKeyError) return error.message;
  console.error("[auth]", error);
  return "Something went wrong on our side. Try again in a minute.";
};

/**
 * This site's /auth/callback, where Supabase's default email link comes back
 * to. From NEXT_PUBLIC_SITE_URL; the request's host only when that is unset
 * (local development), since a client can set the Host headers behind some proxies.
 */
async function callbackUrl(): Promise<string | undefined> {
  const configured = configuredOrigin();
  if (configured) return `${configured}/auth/callback`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return undefined;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/auth/callback`;
}

/** Step 1: email the link and the code. */
export async function requestSignIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    return { status: "error", message: "That doesn't look like an email address. Check for a typo.", email, step: "email" };
  }
  try {
    await hit(await emailLimits(email), "Too many sign-in emails for now. Wait a few minutes, then try again.");
    await sendMagicLink(email, await callbackUrl());
    await rememberSignIn(email, safeNext(form.get("next")));
    return { status: "sent", email };
  } catch (error) {
    return { status: "error", message: message(error), email, step: "email" };
  }
}

/** Step 2, on the same device: the six-digit code from the email instead of the link. */
export async function signInWithCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? (await cookies()).get(EMAIL_COOKIE)?.value ?? "").trim().toLowerCase();
  let next: string;
  try {
    await hit(await codeLimits(email), "Too many tries for now. Wait a few minutes, or use the link in the email.");
    const verified = await verifyCode(email, String(form.get("code") ?? ""));
    // The form says where to go; the cookie only when it does not (an older page). Both are cleared.
    const remembered = await takeNext();
    next = safeNext(form.get("next"), remembered);
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error), email, step: "code" };
  }
  return { status: "done", next };
}

export type ConfirmState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; next: string };

/**
 * The link from the email, on any device. A button press rather than on page
 * load, so a mail scanner that opens links to check them does not use up the
 * one-time token before the person gets there.
 */
export async function confirmSignIn(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    await hit(await linkLimits());
    const verified = await verifyTokenHash(String(form.get("token_hash") ?? ""), String(form.get("type") ?? "email"));
    next = await takeNext();
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  return { status: "done", next };
}

/**
 * Supabase's default email link, after Supabase verified it: the page hands
 * over the access token from the URL fragment, Supabase says whose it is.
 */
export async function signInWithAccessToken(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    await hit(await linkLimits());
    const verified = await userFromAccessToken(String(form.get("access_token") ?? ""));
    next = await takeNext();
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  return { status: "done", next };
}

export async function signOutAction() {
  await signOut();
  redirect("/account");
}

/** Log out from the avatar menu. No redirect: the menu loads the page in full, so the header reads the signed-out account. */
export async function logOutAction(): Promise<void> {
  await signOut();
}

export async function signOutEverywhereAction() {
  const user = await currentUser();
  if (user) await signOutEverywhere(user.id);
  redirect("/account");
}

// ---------------------------------------------------------------- two-step sign-in

/** The step after the email link: the code from the authenticator app, or a recovery code. */
export async function submitTwoStepCode(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    await hit(await linkLimits());
    next = safeNext(await finishTwoStep(String(form.get("code") ?? "")));
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  return { status: "done", next };
}

export type TwoStepState =
  | { status: "idle" }
  | { status: "codes"; codes: string[] }
  | { status: "off" }
  | { status: "error"; message: string };

/** Setup step 1: a new secret; the page shows it as a QR code. */
export async function beginTwoStep() {
  const user = await currentUser();
  if (!user) redirect("/account");
  try {
    await beginSetup(user.id);
  } catch (error) {
    console.error("[two-step]", error);
    redirect("/account?two_step=unavailable");
  }
  redirect("/account?two_step=setup");
}

/** Setup step 2: a code from the app turns it on and returns the recovery codes. */
export async function confirmTwoStep(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    await hit(accountCodeLimits(user.id));
    const codes = await confirmSetup(user.id, String(form.get("code") ?? ""));
    // Two-step now guards this account: any other device signed in before it has to sign in again.
    await endOtherSessions(user.id);
    return { status: "codes", codes };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

export async function disableTwoStep(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    await hit(accountCodeLimits(user.id));
    await disable(user.id, String(form.get("code") ?? ""));
    await endOtherSessions(user.id);
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  revalidatePath("/account");
  return { status: "off" };
}

export async function newRecoveryCodes(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    await hit(accountCodeLimits(user.id));
    return { status: "codes", codes: await regenerateRecoveryCodes(user.id, String(form.get("code") ?? "")) };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

/** Paddle's customer portal: invoices, card, plan changes, cancelling. */
export async function openBillingPortal(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/account");
  if (!user.paddleCustomerId) redirect("/account?billing=none");
  let url: string;
  try {
    url = await portalUrl(user.paddleCustomerId, user.paddleSubscriptionId, form.get("target") === "cancel" ? "cancel" : "overview");
  } catch (error) {
    console.error("[billing]", error);
    redirect("/account?billing=error");
  }
  redirect(url);
}

// ---------------------------------------------------------------- MCP API keys (SEC-31)

export type ApiKeyState =
  | { status: "idle" }
  | { status: "created"; key: string; name: string }
  | { status: "error"; message: string };

/**
 * A new key for the MCP server. The key is in the answer once and never again.
 * Any plan may make one: on Free the key connects and lists the filter values,
 * and the library tools answer with how to upgrade (server/mcp/tools.ts).
 */
export async function createApiKeyAction(_prev: ApiKeyState, form: FormData): Promise<ApiKeyState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  let created: Awaited<ReturnType<typeof createApiKey>>;
  try {
    await hit([{ key: `api-key:u:${user.id}`, max: 10, windowSeconds: 60 * MINUTE }], "Too many new keys for now. Wait a while, then try again.");
    created = await createApiKey(user.id, String(form.get("name") ?? ""));
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  revalidatePath("/account");
  return { status: "created", key: created.key, name: created.info.name };
}

export async function revokeApiKeyAction(form: FormData) {
  const user = await currentUser();
  const id = String(form.get("id") ?? "");
  if (user && /^[0-9a-f-]{36}$/i.test(id)) await revokeApiKey(user.id, id);
  revalidatePath("/account");
}

// ---------------------------------------------------------------- after the first sign-in

/**
 * The answers to "What do you do?" and "What do you want to see?", or none
 * (Skip). Either way the questions are not asked again. Values outside the
 * lists are dropped, not refused: nothing reads them for access.
 */
export async function saveOnboardingAction(answers: { role: string | null; pages: string[]; industries: string[] }): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false };
  const pick = (values: unknown, allowed: Set<string>) =>
    [...new Set(Array.isArray(values) ? values.filter((v): v is string => typeof v === "string" && allowed.has(v)) : [])];
  const role = typeof answers?.role === "string" && ROLE_VALUES.has(answers.role) ? answers.role : null;
  try {
    await saveOnboarding(user.id, { role, pages: pick(answers?.pages, PAGE_VALUES), industries: pick(answers?.industries, INDUSTRY_VALUES) });
    return { ok: true };
  } catch (error) {
    console.error("[onboarding]", error);
    return { ok: false };
  }
}
