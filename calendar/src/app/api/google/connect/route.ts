import { NextRequest, NextResponse } from "next/server";
import { createOAuthClient } from "@/lib/google-auth";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  await requireUser();
  try {
    const client = createOAuthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // forces a refresh_token even on repeat connects
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    return NextResponse.redirect(url);
  } catch (err) {
    const settingsUrl = new URL("/settings", request.nextUrl.origin);
    settingsUrl.searchParams.set(
      "google_error",
      err instanceof Error ? err.message : "unknown_error",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
