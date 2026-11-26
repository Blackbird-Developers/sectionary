// Shared by the sign-in popup, the /account page, the Google route and the
// questions after the first sign-in. Safe on the server and in the browser.

/**
 * "Continue with Google" shows once Google is turned on in Supabase
 * (docs/AUTH-AND-BILLING.md). Build time, like every NEXT_PUBLIC_ variable.
 */
export const googleSignIn = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "on";

/** The digits in a sign-in code. Matches Supabase's Email OTP length (docs/AUTH-AND-BILLING.md). */
export const CODE_LENGTH = 6;

/** Seconds before "Resend code" works again. Supabase refuses a second email to one address within 60 s. */
export const RESEND_SECONDS = 60;

const OPEN_EVENT = "blimp:sign-in";
export type SignInRequest = { next?: string; reason?: string };

/** Opens the sign-in popup (components/sign-in-dialog.tsx) from anywhere on the page. */
export function openSignIn(request: SignInRequest = {}) {
  window.dispatchEvent(new CustomEvent<SignInRequest>(OPEN_EVENT, { detail: request }));
}

export function onOpenSignIn(listener: (request: SignInRequest) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<SignInRequest>).detail ?? {});
  window.addEventListener(OPEN_EVENT, handle);
  return () => window.removeEventListener(OPEN_EVENT, handle);
}

// ---------------------------------------------------------------- after the first sign-in

/** "What do you do?" Stored as the value; one answer. */
export const ROLES = [
  { value: "designer", label: "Designer" },
  { value: "developer", label: "Developer" },
  { value: "agency", label: "Agency" },
  { value: "store-owner", label: "Store owner" },
  { value: "marketer", label: "Marketer" },
  { value: "freelancer", label: "Freelancer" },
  { value: "product", label: "Product manager" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other" },
] as const;

/** "What do you want to see?" The wall's page types (lib/blocks.ts PAGE_TYPE_LABEL), as the person thinks of them. */
export const PAGES = [
  { value: "home", label: "Home pages" },
  { value: "collection", label: "Collections" },
  { value: "product", label: "Product pages" },
  { value: "cart", label: "Cart" },
  { value: "checkout", label: "Checkout" },
  { value: "blog", label: "Blog & articles" },
] as const;
