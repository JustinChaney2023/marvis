import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testRoutesAllowed } from "@/lib/testRouteGuard";

/**
 * Test-only helper: deletes Event/Task rows whose title starts with a
 * given prefix (Playwright tests use "[e2e]"). Never wipes by any other
 * criterion — this DB also holds real synced Google Calendar data, and a
 * blanket delete here would be catastrophic. Refuses outside development
 * as a second guard rail even though nothing routes here in normal use.
 */
export async function POST(request: NextRequest) {
  if (!testRoutesAllowed()) {
    return NextResponse.json({ error: "test routes disabled" }, { status: 403 });
  }

  const { prefix } = await request.json();
  if (typeof prefix !== "string" || prefix.length < 3) {
    return NextResponse.json({ error: "prefix required" }, { status: 400 });
  }

  const events = await prisma.event.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  const tasks = await prisma.task.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  const projects = await prisma.project.deleteMany({
    where: { name: { startsWith: prefix } },
  });

  return NextResponse.json({
    events: events.count,
    tasks: tasks.count,
    projects: projects.count,
  });
}
