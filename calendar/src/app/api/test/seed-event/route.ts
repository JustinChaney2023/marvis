import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testRoutesAllowed } from "@/lib/testRouteGuard";
import { getCurrentUser } from "@/lib/auth";

/** Test-only: create an Event with an arbitrary recurrenceRule, for
 * reproducing behavior around rules this app's UI can't fully represent
 * (e.g. Google-synced rules with UNTIL/WKST). Same production guard as
 * the other /api/test/* routes. */
export async function POST(request: NextRequest) {
  if (!testRoutesAllowed()) {
    return NextResponse.json({ error: "test routes disabled" }, { status: 403 });
  }

  // The Playwright request fixture carries the suite's session cookie —
  // seed for that user (the one whose calendar the test then opens),
  // falling back to the first account for cookie-less callers.
  const user = (await getCurrentUser()) ?? (await prisma.user.findFirst());
  const body = await request.json();
  const event = await prisma.event.create({
    data: {
      userId: user?.id,
      title: body.title,
      start: new Date(body.start),
      end: new Date(body.end),
      recurrenceRule: body.recurrenceRule ?? null,
    },
  });
  return NextResponse.json({ ok: true, event });
}
