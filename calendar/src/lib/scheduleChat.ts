import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const CONTEXT_HORIZON_DAYS = 30;
const MAX_CONTEXT_ITEMS = 200; // safety cap, not a real-world limit at personal-calendar scale

/**
 * Plain-text dump of the user's own upcoming events and open tasks —
 * read-only context for the chat, not a tool-calling agent. Simpler than
 * letting the model query for specific date ranges on demand, and at
 * personal-calendar scale (dozens to low hundreds of items) there's no
 * real need for anything fancier — see MAX_CONTEXT_ITEMS if that ever
 * stops being true.
 */
async function buildScheduleContext(userId: string): Promise<string> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + CONTEXT_HORIZON_DAYS * 86_400_000);

  const eventRows = await prisma.event.findMany({
    where: {
      userId,
      OR: [{ start: { lt: horizonEnd }, end: { gt: now } }, { recurrenceRule: { not: null } }],
    },
    orderBy: { start: "asc" },
  });
  const events = expandEvents(eventRows, now, horizonEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, MAX_CONTEXT_ITEMS);

  const tasks = await prisma.task.findMany({
    where: { userId, status: { not: "DONE" }, parentId: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    include: { project: true, event: true },
    take: MAX_CONTEXT_ITEMS,
  });

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const eventLines = events.map((e) => `- ${fmt(e.start)}–${e.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}: ${e.title}`);
  const taskLines = tasks.map((t) => {
    const parts = [t.title];
    if (t.project) parts.push(`[${t.project.name}]`);
    parts.push(`(${t.status.toLowerCase()}${t.event ? ", scheduled" : ", unscheduled"}${t.dueAt ? `, due ${fmt(t.dueAt)}` : ""})`);
    return `- ${parts.join(" ")}`;
  });

  return [
    `Today is ${fmt(now)}.`,
    "",
    `Upcoming events (next ${CONTEXT_HORIZON_DAYS} days):`,
    eventLines.length ? eventLines.join("\n") : "(none)",
    "",
    "Open tasks:",
    taskLines.length ? taskLines.join("\n") : "(none)",
  ].join("\n");
}

const ChatReplySchema = z.object({ reply: z.string() });

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResult = { ok: true; reply: string } | { ok: false; error: string };

export async function askScheduleChat(
  userId: string,
  messages: ChatMessage[],
  localAi: LocalAiConfig | null,
): Promise<ChatResult> {
  const context = await buildScheduleContext(userId);
  const transcript = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");

  const system =
    "You answer questions about the user's own calendar and task list, using only the context provided below. " +
    "Read-only — you cannot create, edit, or delete anything, and should say so if asked to. " +
    "Be concise and specific (reference actual titles/times from the context, not vague generalities). " +
    "If something isn't in the context, say you don't see it rather than guessing.\n\n" +
    context;

  const result = await callAiForJson({
    system,
    userContent: transcript,
    schema: ChatReplySchema,
    localAi,
    maxTokens: 1000,
    shapeHint: '{"reply": string}',
  });

  if (!result.ok) return result;
  return { ok: true, reply: result.data.reply };
}
