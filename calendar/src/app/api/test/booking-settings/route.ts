import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testRoutesAllowed } from "@/lib/testRouteGuard";

/**
 * Test-only helper: upserts a BookingLink by slug directly, so Playwright
 * specs can configure/reset a booking link around a test run without going
 * through the Settings UI form. Same production guard as /api/test/cleanup.
 * Targets the first User row (there's only one on a dev/test instance).
 */
export async function POST(request: NextRequest) {
  if (!testRoutesAllowed()) {
    return NextResponse.json({ error: "test routes disabled" }, { status: 403 });
  }

  const user = await prisma.user.findFirst();
  if (!user) {
    return NextResponse.json({ error: "no user to attach settings to" }, { status: 400 });
  }

  const body = await request.json();
  const slug = String(body.bookingSlug ?? "");
  if (!slug) {
    return NextResponse.json({ error: "bookingSlug is required" }, { status: 400 });
  }

  const link = await prisma.bookingLink.upsert({
    where: { slug },
    create: {
      userId: user.id,
      slug,
      title: body.bookingTitle ?? "Book time with me",
      durationMin: body.bookingDurationMin ?? 30,
      enabled: body.bookingEnabled ?? true,
    },
    update: {
      title: body.bookingTitle ?? "Book time with me",
      durationMin: body.bookingDurationMin ?? 30,
      enabled: body.bookingEnabled ?? true,
    },
  });

  return NextResponse.json({ ok: true, bookingLink: link });
}
