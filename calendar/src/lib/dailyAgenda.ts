import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

export type DailyAgendaFacts = {
  meetingCount: number;
  deepWorkCount: number;
  overdueCount: number;
  nextTitle: string | null;
  nextStart: Date | null;
};

// Meetings vs. deep-work blocks mirrors how a slot got onto the calendar:
// a bare Event (nothing scheduled it) reads as an external meeting, while
// an Event with a taskId is time this app carved out for a task.
export async function buildTodayFacts(userId: string): Promise<DailyAgendaFacts> {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        { start: { lt: dayEnd }, end: { gt: dayStart } },
        { recurrenceRule: { not: null } },
      ],
    },
    include: { task: true },
    orderBy: { start: "asc" },
  });

  const taskIdByMasterId = new Map(rows.map((r) => [r.id, r.taskId]));
  const occurrences = expandEvents(rows, dayStart, dayEnd);

  let meetingCount = 0;
  let deepWorkCount = 0;
  let next: { title: string; start: Date } | null = null;
  for (const occ of occurrences) {
    if (taskIdByMasterId.get(occ.masterId)) deepWorkCount++;
    else meetingCount++;
    if (occ.start >= now && (!next || occ.start < next.start)) {
      next = { title: occ.title, start: occ.start };
    }
  }

  const overdueCount = await prisma.task.count({
    where: {
      userId,
      parentId: null,
      status: { in: ["CREATED", "ONGOING", "DELAYED"] },
      dueAt: { lt: dayStart },
    },
  });

  if (!next) {
    const nextTask = await prisma.task.findFirst({
      where: {
        userId,
        parentId: null,
        status: { in: ["CREATED", "ONGOING", "DELAYED"] },
        event: { is: null },
        dueAt: { gte: dayStart },
      },
      orderBy: { dueAt: "asc" },
    });
    if (nextTask?.dueAt) next = { title: nextTask.title, start: nextTask.dueAt };
  }

  return {
    meetingCount,
    deepWorkCount,
    overdueCount,
    nextTitle: next?.title ?? null,
    nextStart: next?.start ?? null,
  };
}

function templateText(facts: DailyAgendaFacts): string {
  const parts: string[] = [];
  parts.push(`${facts.meetingCount} meeting${facts.meetingCount === 1 ? "" : "s"}`);
  parts.push(`${facts.deepWorkCount} deep-work block${facts.deepWorkCount === 1 ? "" : "s"}`);
  if (facts.overdueCount > 0) {
    parts.push(`${facts.overdueCount} overdue task${facts.overdueCount === 1 ? "" : "s"}`);
  }
  let text = `Today: ${parts.join(", ")}.`;
  if (facts.nextTitle) {
    text += ` Next up: ${facts.nextTitle} at ${facts.nextStart!.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`;
  }
  return text;
}

const AgendaTextSchema = z.object({ summary: z.string() });

// AI phrasing is a nice-to-have on top of the always-correct template
// below — any failure (no API key, local AI unreachable, bad JSON) just
// falls back to the template rather than surfacing an error on a page
// load nobody explicitly triggered.
export async function generateDailyAgendaText(
  facts: DailyAgendaFacts,
  localAi: LocalAiConfig | null,
): Promise<string> {
  const template = templateText(facts);
  if (facts.meetingCount === 0 && facts.deepWorkCount === 0 && facts.overdueCount === 0) {
    return "Nothing on the calendar today — a clean slate.";
  }

  const result = await callAiForJson({
    system:
      "Rewrite this daily-schedule readout as one short, natural sentence (or two at most). " +
      "Keep every number accurate. No greeting, no sign-off, no markdown.",
    userContent: template,
    schema: AgendaTextSchema,
    localAi,
    maxTokens: 200,
    shapeHint: '{"summary": string}',
  });

  return result.ok ? result.data.summary : template;
}
