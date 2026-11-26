import { NextResponse, type NextRequest } from "next/server";
import { rememberNext, safeNext } from "@/server/auth";
import { configuredOrigin } from "@/server/site-url";
import { googleSignIn } from "@/lib/sign-in";

// "Continue with Google": off to Supabase, which sends the person to Google
// and back to /auth/callback#access_token=..., the same landing as Supabase's
// default email link (components/callback-sign-in.tsx). From there it is the
// usual sign-in: Supabase says whose token it is, we start our own session.
//
// Needs the Google provider turned on in Supabase (docs/AUTH-AND-BILLING.md);
// until then NEXT_PUBLIC_AUTH_GOOGLE stays unset and no button links here.

export async function GET(request: NextRequest) {
  const supabase = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const origin = configuredOrigin() ?? request.nextUrl.origin;
  if (!googleSignIn || !supabase) return NextResponse.redirect(new URL("/account", origin));

  await rememberNext(safeNext(request.nextUrl.searchParams.get("next"), "/"));
  const authorize = new URL(`${supabase}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", `${origin}/auth/callback`);
  return NextResponse.redirect(authorize);
}
