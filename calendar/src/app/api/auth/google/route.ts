import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSignInClient, GOOGLE_SIGNIN_STATE_COOKIE, googleSignInConfigured } from "@/lib/google-auth";
import { appOrigin } from "@/lib/oauth";

// Starts "Sign in with Google": a random state, echoed back by Google and
// matched against this browser's cookie in the callback (login CSRF — it
// stops someone signing you in to *their* account with their own code).
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  if (!googleSignInConfigured()) {
    return NextResponse.redirect(new URL("/login?error=Google%20sign-in%20isn%27t%20set%20up.", origin));
  }
  const state = randomBytes(24).toString("base64url");
  const url = createSignInClient(origin).generateAuthUrl({
    state,
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_SIGNIN_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/auth/google/callback",
    maxAge: 600,
  });
  return res;
}
