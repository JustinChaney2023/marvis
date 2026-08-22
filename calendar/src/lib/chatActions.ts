import { z } from "zod";

// A proposed action never executes itself — see executeChatActionAction
// in actions.ts, which only ever runs when the user clicks Confirm on
// the exact card built from these same fields. Kept as one flat object
// (not a discriminated union) since Anthropic's structured-output JSON
// Schema conversion and the local-model JSON-mode path both handle a
// flat optional-fields shape more reliably than a tagged union.
//
// No server-only imports here (unlike scheduleChat.ts, which needs
// prisma for context-building) — ChatClient.tsx (a client component)
// imports describeChatAction below, so this file has to stay
// browser-safe.
export const ChatActionSchema = z.object({
  kind: z.enum([
    "createTask",
    "updateTask",
    "deleteTask",
    "scheduleTask",
    "createEvent",
    "moveEvent",
    "updateEvent",
    "deleteEvent",
  ]),
  taskId: z.string().optional(),
  eventId: z.string().optional(),
  title: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  dueAt: z.string().optional(), // ISO — for createTask/updateTask
  durationMin: z.number().optional(),
  startIso: z.string().optional(), // for createEvent/moveEvent
  endIso: z.string().optional(),
  location: z.string().optional(),
});
export type ChatAction = z.infer<typeof ChatActionSchema>;

const CHAT_FMT = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// Pure and side-effect-free on purpose — the confirm card renders exactly
// this string, so what the user reads before clicking Confirm and what
// executeChatActionAction (actions.ts) actually does can never drift
// apart by going through two different code paths for "describe" vs "do."
export function describeChatAction(action: ChatAction): string {
  switch (action.kind) {
    case "createTask":
      return `Create task: "${action.title ?? "(untitled)"}"${action.priority ? `, ${action.priority}` : ""}${action.dueAt ? `, due ${CHAT_FMT(action.dueAt)}` : ""}`;
    case "updateTask":
      return `Update task "${action.title ?? action.taskId}"${action.priority ? ` → ${action.priority}` : ""}${action.dueAt ? `, due ${CHAT_FMT(action.dueAt)}` : ""}${action.durationMin ? `, ${action.durationMin} min` : ""}`;
    case "deleteTask":
      return `Delete task "${action.title ?? action.taskId}"`;
    case "scheduleTask":
      return `Auto-schedule "${action.title ?? action.taskId}"`;
    case "createEvent":
      return `Create event: "${action.title ?? "(untitled)"}"${action.startIso ? `, ${CHAT_FMT(action.startIso)}` : ""}${action.location ? ` at ${action.location}` : ""}`;
    case "moveEvent":
      return `Move "${action.title ?? action.eventId}" to ${action.startIso ? CHAT_FMT(action.startIso) : "?"}`;
    case "updateEvent":
      return `Update "${action.title ?? action.eventId}"${action.location ? `, location: ${action.location}` : ""}`;
    case "deleteEvent":
      return `Delete event "${action.title ?? action.eventId}"`;
  }
}
