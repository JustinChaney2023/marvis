import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Test-only: create an Event with an arbitrary recurrenceRule, for
 * reproducing behavior around rules this app's UI can't fully represent
 * (e.g. Google-synced rules with UNTIL/WKST). Same production guard as
 * the other /api/test/* routes. */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 403 });
  }

  const body = await request.json();
  const event = await prisma.event.create({
    data: {
      title: body.title,
      start: new Date(body.start),
      end: new Date(body.end),
      recurrenceRule: body.recurrenceRule ?? null,
    },
  });
  return NextResponse.json({ ok: true, event });
}
