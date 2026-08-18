import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { createOAuthClient } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const settingsUrl = new URL("/settings", request.nextUrl.origin);

  if (error || !code) {
    settingsUrl.searchParams.set("google_error", error ?? "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error(
        "Google didn't return a refresh token — disconnect any prior grant for this app in your Google Account's third-party access settings, then try connecting again.",
      );
    }
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: userinfo } = await oauth2.userinfo.get();

    // Single-user app: enforce one GoogleAccount row by replacing any
    // existing one rather than trying to "update the right one".
    await prisma.googleAccount.deleteMany({});
    await prisma.googleAccount.create({
      data: {
        email: userinfo.email ?? "unknown",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
      },
    });

    settingsUrl.searchParams.set("google_connected", "1");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    settingsUrl.searchParams.set(
      "google_error",
      err instanceof Error ? err.message : "unknown_error",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
