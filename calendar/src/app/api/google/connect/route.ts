import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createOAuthClient, GOOGLE_STATE_COOKIE } from "@/lib/google-auth";
import { appOrigin } from "@/lib/oauth";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  await requireUser();
  try {
    const client = createOAuthClient();
    // CSRF: a random state the callback must see echoed back AND find in
    // this browser's cookie — otherwise anyone could send you to
    // /api/google/callback?code=<their code> and link *their* Google
    // account to your Season (exporting your events into it).
    const state = randomBytes(24).toString("base64url");
    const url = client.generateAuthUrl({
      state,
      access_type: "offline",
      prompt: "consent", // forces a refresh_token even on repeat connects
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    const res = NextResponse.redirect(url);
    res.cookies.set(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/google/callback",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    const settingsUrl = new URL("/settings?tab=calendars", appOrigin(request));
    settingsUrl.searchParams.set(
      "google_error",
      err instanceof Error ? err.message : "unknown_error",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
