import { NextRequest, NextResponse } from "next/server";
import { updateAppSettings } from "@/lib/settings";

/**
 * Test-only helper: sets booking-related AppSettings fields directly, so
 * Playwright specs can configure/reset the (single, real) booking config
 * around a test run without going through the Settings UI form. Same
 * production guard as /api/test/cleanup.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 403 });
  }

  const body = await request.json();
  const updated = await updateAppSettings({
    bookingEnabled: body.bookingEnabled,
    bookingSlug: body.bookingSlug,
    bookingTitle: body.bookingTitle,
    bookingDurationMin: body.bookingDurationMin,
  });

  return NextResponse.json({ ok: true, settings: updated });
}
