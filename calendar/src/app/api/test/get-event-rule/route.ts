import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testRoutesAllowed } from "@/lib/testRouteGuard";

/** Test-only: look up an Event's recurrenceRule by exact title, for
 * asserting it wasn't silently rewritten after an unrelated edit. */
export async function GET(request: NextRequest) {
  if (!testRoutesAllowed()) {
    return NextResponse.json({ error: "test routes disabled" }, { status: 403 });
  }

  const title = request.nextUrl.searchParams.get("title") ?? "";
  const event = await prisma.event.findFirst({ where: { title } });
  return NextResponse.json({ recurrenceRule: event?.recurrenceRule ?? null });
}
