import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";
import { ChatActionSchema, type ChatAction } from "@/lib/chatActions";

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
    include: { project: true, events: true },
    take: MAX_CONTEXT_ITEMS,
  });

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // Real ids included so a proposed action can reference an exact row —
  // the model never has to be trusted to re-find "the dentist thing" by
  // title at execute time, only to have copied an id it already saw.
  // `masterId`, not `id` — a recurring occurrence's `id` is a synthetic
  // `masterId::ISO` composite (recurrence.ts), but every action this
  // chat can propose (move/update/delete) acts on the real master row,
  // same as the calendar UI's own edit/delete already does.
  const eventLines = events.map(
    (e) => `- [${e.masterId}] ${fmt(e.start)}–${e.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}: ${e.title}`,
  );
  const taskLines = tasks.map((t) => {
    const parts = [t.title];
    if (t.project) parts.push(`[${t.project.name}]`);
    parts.push(`(${t.status.toLowerCase()}${t.events.length > 0 ? ", scheduled" : ", unscheduled"}${t.dueAt ? `, due ${fmt(t.dueAt)}` : ""})`);
    return `- [${t.id}] ${parts.join(" ")}`;
  });

  return [
    `Today is ${fmt(now)}.`,
    "",
    `Upcoming events (next ${CONTEXT_HORIZON_DAYS} days) — [id] is the real event id:`,
    eventLines.length ? eventLines.join("\n") : "(none)",
    "",
    "Open tasks — [id] is the real task id:",
    taskLines.length ? taskLines.join("\n") : "(none)",
  ].join("\n");
}

const ChatReplySchema = z.object({ reply: z.string(), actions: z.array(ChatActionSchema).default([]) });

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResult =
  | { ok: true; reply: string; actions: ChatAction[] }
  | { ok: false; error: string };

export async function askScheduleChat(
  userId: string,
  messages: ChatMessage[],
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
): Promise<ChatResult> {
  const context = await buildScheduleContext(userId);
  const transcript = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");

  const system =
    "You answer questions about the user's own calendar and task list, and can propose changes, using only " +
    "the context provided below.\n\n" +
    "You cannot change anything directly — you can only PROPOSE an action via the `actions` array in your " +
    "response. Every proposed action is shown to the user as a card they must explicitly confirm before it " +
    "runs; nothing you propose ever executes just because you said it. Because of that, err toward proposing " +
    "a reasonable action rather than refusing outright — the user has a final say either way.\n\n" +
    "Rules for proposing actions:\n" +
    "- Reference an existing task/event ONLY by the exact [id] shown in the context below — never invent one, " +
    "never guess one from memory of an earlier turn.\n" +
    "- If a request is ambiguous (e.g. two tasks could match \"the dentist thing\", or a time/date is unclear), " +
    "ask a clarifying question in `reply` and propose NO action — a wrong guess here is a real (if cancelable) " +
    "mistake, not just a wrong answer.\n" +
    "- One user message can propose multiple actions (e.g. \"reschedule these three\") — each becomes its own " +
    "array entry, since the user can confirm some and cancel others independently.\n" +
    "- `kind` is one of: createTask, updateTask, deleteTask, scheduleTask (auto-find a slot for an existing " +
    "task), createEvent, moveEvent (reschedule an existing event), updateEvent (change an existing event's " +
    "title/location, not its time — use moveEvent for time changes), deleteEvent.\n" +
    "- Dates go in `dueAt`/`startIso`/`endIso` as full ISO 8601 instants, computed from \"today\" below — never " +
    "a bare date/weekday name.\n" +
    "- Always fill in `title` on every action (even updateTask/deleteTask/etc. where it's not what's changing) " +
    "so the confirmation card can show a clear label without a second lookup.\n\n" +
    context;

  const result = await callAiForJson({
    system,
    userContent: transcript,
    schema: ChatReplySchema,
    localAi,
    anthropicApiKey,
    maxTokens: 1500,
    shapeHint: '{"reply": string, "actions": [{"kind": string, "title": string, ...}]}',
  });

  if (!result.ok) return result;
  return { ok: true, reply: result.data.reply, actions: result.data.actions };
}
