import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandEvents, recurringOverlapping } from "@/lib/recurrence";
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
export async function buildTodayFacts(userId: string, timeZone: string): Promise<DailyAgendaFacts> {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        { start: { lt: dayEnd }, end: { gt: dayStart } },
        recurringOverlapping(dayStart, dayEnd),
      ],
    },
    include: { task: true },
    orderBy: { start: "asc" },
  });

  const taskIdByMasterId = new Map(rows.map((r) => [r.id, r.taskId]));
  const occurrences = expandEvents(rows, dayStart, dayEnd, timeZone);

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
        events: { none: {} },
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

// The always-correct, no-AI readout — what Focus renders instantly while
// the AI phrasing (generateDailyAgendaText) loads in behind it. Times use
// the user's timezone, not the server's.
export function agendaTemplate(facts: DailyAgendaFacts, timeZone?: string): string {
  if (facts.meetingCount === 0 && facts.deepWorkCount === 0 && facts.overdueCount === 0) {
    return "Nothing on the calendar today — a clean slate.";
  }
  const parts: string[] = [];
  parts.push(`${facts.meetingCount} meeting${facts.meetingCount === 1 ? "" : "s"}`);
  parts.push(`${facts.deepWorkCount} deep-work block${facts.deepWorkCount === 1 ? "" : "s"}`);
  if (facts.overdueCount > 0) {
    parts.push(`${facts.overdueCount} overdue task${facts.overdueCount === 1 ? "" : "s"}`);
  }
  let text = `Today: ${parts.join(", ")}.`;
  if (facts.nextTitle) {
    text += ` Next up: ${facts.nextTitle} at ${facts.nextStart!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })}.`;
  }
  return text;
}

const AgendaTextSchema = z.object({ summary: z.string() });

// AI phrasing is a nice-to-have on top of the always-correct template
// below — any failure (no API key, local AI unreachable, bad JSON) just
// falls back to the template rather than surfacing an error on a page
// load nobody explicitly triggered.
// ponytail: per-process memo, so reopening Focus doesn't re-call the model;
// swap for a DB/Redis cache if this ever runs on more than one process.
const agendaCache = new Map<string, { text: string; at: number }>();
const AGENDA_CACHE_MS = 30 * 60_000;

export async function generateDailyAgendaText(
  facts: DailyAgendaFacts,
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
  timeZone?: string,
): Promise<string> {
  const template = agendaTemplate(facts, timeZone);
  if (template.startsWith("Nothing on the calendar")) return template;

  const key = JSON.stringify([template, Boolean(localAi), Boolean(anthropicApiKey)]);
  const hit = agendaCache.get(key);
  if (hit && Date.now() - hit.at < AGENDA_CACHE_MS) return hit.text;

  const result = await callAiForJson({
    system:
      "Rewrite this daily-schedule readout as one short, natural sentence (or two at most). " +
      "Keep every number accurate. No greeting, no sign-off, no markdown.",
    userContent: template,
    schema: AgendaTextSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 200,
    shapeHint: '{"summary": string}',
  });

  const text = result.ok ? result.data.summary : template;
  agendaCache.set(key, { text, at: Date.now() });
  return text;
}
