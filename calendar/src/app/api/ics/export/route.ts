import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { buildIcsCalendar } from "@/lib/ics";

// Wide enough to cover "everything anyone would plausibly want to
// export" for a personal calendar without dumping unbounded history.
const EXPORT_PAST_DAYS = 365;
const EXPORT_FUTURE_DAYS = 365;

/**
 * ICS export (#33) — a single event (`?eventId=`) or the whole calendar,
 * as a downloadable .ics file. A recurring series exports as one VEVENT
 * with its RRULE, same "compute occurrences on the fly" model this app
 * already uses — not one row per occurrence.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  const eventId = request.nextUrl.searchParams.get("eventId");

  const events = eventId
    ? await prisma.event.findMany({ where: { id: eventId, userId: user.id } })
    : await prisma.event.findMany({
        where: {
          userId: user.id,
          OR: [
            {
              start: { gte: new Date(Date.now() - EXPORT_PAST_DAYS * 86_400_000) },
              end: { lte: new Date(Date.now() + EXPORT_FUTURE_DAYS * 86_400_000) },
            },
            { recurrenceRule: { not: null } },
          ],
        },
      });

  if (eventId && events.length === 0) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const ics = buildIcsCalendar(events);
  const filename = eventId ? `${events[0].title.replace(/[^\w -]/g, "")}.ics` : "calendar.ics";
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
