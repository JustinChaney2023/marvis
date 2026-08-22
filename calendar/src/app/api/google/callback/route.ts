import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { createOAuthClient } from "@/lib/google-auth";
import { requireUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/tokenCrypto";

export async function GET(request: NextRequest) {
  // Not `state` from Google's redirect (an attacker could tamper that to
  // link their own Google grant to someone else's account) — the same
  // browser session that started /api/google/connect completes this
  // top-level redirect, so its cookie is the trustworthy source of "which
  // user is this for".
  const user = await requireUser();
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

    const email = userinfo.email ?? "unknown";
    const existingCount = await prisma.googleAccount.count({ where: { userId: user.id } });
    // Reconnecting an already-known account (e.g. after a revoked/expired
    // grant) updates its tokens in place instead of creating a duplicate
    // row for the same underlying Google account.
    await prisma.googleAccount.upsert({
      where: { userId_email: { userId: user.id, email } },
      create: {
        userId: user.id,
        email,
        label: email,
        isDefault: existingCount === 0,
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
      },
      update: {
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
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
