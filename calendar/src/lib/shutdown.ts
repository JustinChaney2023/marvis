import { prisma } from "@/lib/prisma";

export type ShutdownTask = { id: string; title: string };

export type ShutdownSummary = {
  completedToday: ShutdownTask[];
  stillOpen: ShutdownTask[];
};

/**
 * "Completed today" uses Task.updatedAt as a proxy for "marked done
 * today" — not perfectly precise (any edit bumps it), but close enough
 * for an end-of-day review that's about the gist, not an audit log.
 * "Still open" is today's due-or-scheduled tasks that didn't make it —
 * exactly what a shutdown ritual needs to carry over.
 */
export async function buildShutdownSummary(userId: string): Promise<ShutdownSummary> {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const completed = await prisma.task.findMany({
    where: {
      userId,
      parentId: null,
      status: "DONE",
      updatedAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { updatedAt: "desc" },
  });

  const stillOpen = await prisma.task.findMany({
    where: {
      userId,
      parentId: null,
      status: { in: ["CREATED", "ONGOING"] },
      OR: [
        { dueAt: { gte: dayStart, lt: dayEnd } },
        { event: { start: { gte: dayStart, lt: dayEnd } } },
      ],
    },
    orderBy: { dueAt: "asc" },
  });

  return {
    completedToday: completed.map((t) => ({ id: t.id, title: t.title })),
    stillOpen: stillOpen.map((t) => ({ id: t.id, title: t.title })),
  };
}
