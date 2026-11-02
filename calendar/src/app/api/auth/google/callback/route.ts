import { NextRequest, NextResponse } from "next/server";
import { createSignInClient, GOOGLE_SIGNIN_STATE_COOKIE } from "@/lib/google-auth";
import { appOrigin } from "@/lib/oauth";
import { createSession } from "@/lib/auth";
import { resolveGoogleSignIn } from "@/lib/googleSignIn";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";
import { safeErr } from "@/lib/safeErr";

const isRateLimited = createRateLimiter(20, 60 * 60 * 1000);

export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const fail = (message: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
    res.cookies.delete({ name: GOOGLE_SIGNIN_STATE_COOKIE, path: "/api/auth/google/callback" });
    return res;
  };

  if (isRateLimited(await requestIp())) return fail("Too many attempts — please try again later.");

  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.get("error") || !code) return fail("Google sign-in was cancelled.");
  const expectedState = request.cookies.get(GOOGLE_SIGNIN_STATE_COOKIE)?.value;
  if (!expectedState || request.nextUrl.searchParams.get("state") !== expectedState) {
    return fail("That sign-in link didn't start here — try again.");
  }

  let result;
  try {
    const client = createSignInClient(origin);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new Error("Google returned no identity token.");
    // Verifies the signature, issuer, expiry and that it was minted for our client id.
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("Google didn't share an email address.");
    result = await resolveGoogleSignIn({
      sub: p.sub,
      email: p.email,
      emailVerified: p.email_verified === true,
      name: p.name,
    });
  } catch (err) {
    console.error("Google sign-in failed:", safeErr(err));
    return fail("Google sign-in failed — try again.");
  }
  if (!result.ok) return fail(result.error);

  await createSession(result.userId);
  const res = NextResponse.redirect(new URL("/home", origin));
  res.cookies.delete({ name: GOOGLE_SIGNIN_STATE_COOKIE, path: "/api/auth/google/callback" });
  return res;
}
