import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Test-only: look up an Event's recurrenceRule by exact title, for
 * asserting it wasn't silently rewritten after an unrelated edit. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 403 });
  }

  const title = request.nextUrl.searchParams.get("title") ?? "";
  const event = await prisma.event.findFirst({ where: { title } });
  return NextResponse.json({ recurrenceRule: event?.recurrenceRule ?? null });
}
