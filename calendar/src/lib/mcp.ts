import { z } from "zod";
import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { expandEvents, recurringOverlapping } from "@/lib/recurrence";
import { parseQuickCapture } from "@/lib/quickCapture";
import { runAutomationsForStatusChange } from "@/lib/automations";
import { autoPlaceIfEnabled } from "@/lib/autoPlan";
import { setTaskDone, findProjectByName as findProjectByNameLoose } from "@/lib/taskOps";
import { rescheduleConflictsWith, scheduleAllPendingTasks, scheduleTask, unscheduleTask } from "@/lib/scheduler";
import { rescheduleConflictedHabits } from "@/lib/habits";
import { deleteFromGoogle } from "@/lib/google-sync";
import { resolveUploadPath } from "@/lib/uploads";
import { getZonedDateParts, zonedWallTimeToUtc } from "@/lib/timezone";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";

/**
 * Season's MCP server (Model Context Protocol, "Streamable HTTP" transport
 * in its stateless JSON-response form) — lets Claude (Claude Code, Claude
 * Desktop, claude.ai connectors) read and edit your tasks, projects, and
 * calendar. Hand-rolled rather than pulling in @modelcontextprotocol/sdk:
 * stateless JSON-RPC over one POST route is ~4 methods, and the SDK's
 * transport assumes a Node req/res pair rather than a Next route handler.
 *
 * Auth is the same personal access tokens /api/v1 uses — see
 * src/app/api/mcp/route.ts. Every tool is scoped to that token's user.
 */

export const MCP_SERVER_NAME = "season";
const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_TIMEZONE = "America/New_York";

const INSTRUCTIONS = `Season is the user's personal calendar, task list, and auto-scheduler.
- Start with get_overview to see today's agenda, overdue tasks, and what's due soon.
- Times are ISO 8601. A datetime without an offset (e.g. "2026-11-03T15:00") or a bare date ("2026-11-03") is read in the user's own timezone; a bare due date means 5pm that day.
- create_task accepts either structured fields or a natural-language "text" like "Call dentist tomorrow 3pm p2 #health 30m".
- Priority: 0 low, 1 medium, 2 high, 3 urgent.
- schedule_tasks runs Season's auto-scheduler, placing open tasks into free time on the calendar.`;

// ---------------------------------------------------------------------------
// JSON-RPC plumbing

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

class ToolError extends Error {}

type ToolContext = { userId: string; timeZone: string };

type Tool<S extends z.ZodType> = {
  name: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};

function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<z.ZodType> {
  return tool as unknown as Tool<z.ZodType>;
}

/**
 * One JSON-RPC message in, one response out (null for notifications,
 * which get no response). Never throws — protocol and tool failures both
 * come back as well-formed JSON-RPC.
 */
export async function handleMcpMessage(message: unknown, userId: string): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object" || (message as JsonRpcRequest).jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } };
  }
  const req = message as JsonRpcRequest;
  const isNotification = req.id === undefined;
  const id = req.id ?? null;

  try {
    const result = await dispatch(req, userId);
    return isNotification ? null : { jsonrpc: "2.0", id, result };
  } catch (err) {
    if (isNotification) return null;
    if (err instanceof RpcError) return { jsonrpc: "2.0", id, error: { code: err.code, message: err.message } };
    console.error("MCP internal error:", err);
    return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error." } };
  }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

async function dispatch(req: JsonRpcRequest, userId: string): Promise<unknown> {
  switch (req.method) {
    case "initialize": {
      const requested = String(req.params?.protocolVersion ?? "");
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: "Season", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(describeTool) };
    case "tools/call":
      return callTool(String(req.params?.name ?? ""), req.params?.arguments, userId);
    case "prompts/list":
      return { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) };
    case "prompts/get": {
      const prompt = PROMPTS.find((p) => p.name === req.params?.name);
      if (!prompt) throw new RpcError(-32602, `Unknown prompt: ${String(req.params?.name)}`);
      const args = (req.params?.arguments ?? {}) as Record<string, string>;
      return {
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.text(args) } }],
      };
    }
    default:
      if (req.method.startsWith("notifications/")) return {};
      throw new RpcError(-32601, `Method not found: ${req.method}`);
  }
}

function describeTool(tool: Tool<z.ZodType>) {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
    annotations: {
      readOnlyHint: tool.readOnly ?? false,
      destructiveHint: tool.destructive ?? false,
      openWorldHint: false,
    },
  };
}

async function callTool(name: string, rawArgs: unknown, userId: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);

  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return errorResult(`Invalid arguments: ${z.prettifyError(parsed.error)}`);
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    const result = await tool.run(parsed.data, { userId, timeZone: user?.timezone ?? DEFAULT_TIMEZONE });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof ToolError) return errorResult(err.message);
    console.error(`MCP tool ${name} failed:`, err);
    return errorResult("Something went wrong running that tool.");
  }
}

function errorResult(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Date handling

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Interprets an input time string. Offsets/Z are honored as-is; a naive
 * datetime is the user's own wall time; a bare date gets `defaultHour`
 * (5pm for due dates — same default the task form uses — or midnight for
 * range starts).
 */
export function parseUserTime(input: string, timeZone: string, defaultHour = 17): Date {
  const s = input.trim();
  const parts = s.match(DATE_ONLY) ?? s.match(NAIVE_DATETIME);
  if (parts) {
    // Date.UTC silently rolls Feb 30 into March — refuse instead.
    const [y, mo, d] = [+parts[1], +parts[2], +parts[3]];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || (parts[4] !== undefined && (+parts[4] > 23 || +parts[5] > 59))) {
      throw new ToolError(`"${input}" isn't a real date/time.`);
    }
  }
  const dateOnly = s.match(DATE_ONLY);
  if (dateOnly) {
    return zonedWallTimeToUtc(+dateOnly[1], +dateOnly[2], +dateOnly[3], defaultHour, 0, timeZone);
  }
  const naive = s.match(NAIVE_DATETIME);
  if (naive) {
    return zonedWallTimeToUtc(+naive[1], +naive[2], +naive[3], +naive[4], +naive[5], timeZone);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ToolError(`Couldn't understand the time "${input}" — use ISO 8601.`);
  return d;
}

function startOfZonedDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return zonedWallTimeToUtc(year, month, day, 0, 0, timeZone);
}

function formatLocal(date: Date | null, timeZone: string): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// ---------------------------------------------------------------------------
// Serializers

const PRIORITY_NAMES = ["low", "medium", "high", "urgent"];

type TaskForOutput = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  durationMin: number;
  dueAt: Date | null;
  startAt: Date | null;
  hardDeadline: boolean;
  recurrenceRule: string | null;
  project?: { id: string; name: string } | null;
  events?: { start: Date; end: Date }[];
  subtasks?: { id: string; title: string; status: string }[];
};

function serializeTask(t: TaskForOutput, timeZone: string) {
  const firstSlot = t.events?.length
    ? t.events.reduce((min, e) => (e.start < min.start ? e : min))
    : null;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: PRIORITY_NAMES[t.priority] ?? t.priority,
    durationMin: t.durationMin,
    dueAt: t.dueAt?.toISOString() ?? null,
    dueLocal: formatLocal(t.dueAt, timeZone),
    ...(t.startAt ? { startAt: t.startAt.toISOString() } : {}),
    ...(t.dueAt && !t.hardDeadline ? { softDeadline: true } : {}),
    ...(t.recurrenceRule ? { recurrenceRule: t.recurrenceRule } : {}),
    project: t.project ? { id: t.project.id, name: t.project.name } : null,
    scheduledFor: firstSlot ? formatLocal(firstSlot.start, timeZone) : null,
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.subtasks?.length
      ? { subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.status === "DONE" })) }
      : {}),
  };
}

const TASK_INCLUDE = {
  project: { select: { id: true, name: true } },
  events: { select: { start: true, end: true } },
  subtasks: { select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" as const } },
};

async function listOccurrences(userId: string, from: Date, to: Date, timeZone: string) {
  const rows = await prisma.event.findMany({
    where: {
      userId,
      OR: [{ start: { lt: to }, end: { gt: from } }, recurringOverlapping(from, to)],
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return expandEvents(rows, from, to, timeZone)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((o) => {
      const master = byId.get(o.masterId);
      return {
        id: o.masterId,
        title: o.title,
        start: o.start.toISOString(),
        end: o.end.toISOString(),
        when: o.allDay ? `${formatLocal(o.start, timeZone)?.split(",").slice(0, 2).join(",")} (all day)` : `${formatLocal(o.start, timeZone)} – ${formatLocal(o.end, timeZone)?.split(", ").pop()}`,
        ...(o.allDay ? { allDay: true } : {}),
        ...(o.isRecurring ? { recurring: true } : {}),
        ...(master?.taskId ? { taskId: master.taskId } : {}),
        ...(master?.location ? { location: master.location } : {}),
        ...(master?.meetingUrl ? { meetingUrl: master.meetingUrl } : {}),
      };
    });
}

async function resolveProjectId(
  userId: string,
  args: { projectId?: string | null; project?: string | null },
): Promise<string | null | undefined> {
  if (args.projectId === null || args.project === null) return null;
  if (args.projectId) {
    const p = await prisma.project.findFirst({ where: { id: args.projectId, userId }, select: { id: true } });
    if (!p) throw new ToolError(`No project with id ${args.projectId}.`);
    return p.id;
  }
  if (args.project) return findProjectByName(userId, args.project);
  return undefined;
}

async function findProjectByName(userId: string, name: string): Promise<string> {
  const match = await findProjectByNameLoose(userId, name);
  if (!match) {
    const projects = await prisma.project.findMany({ where: { userId }, select: { name: true } });
    throw new ToolError(
      `No project matching "${name}". Existing projects: ${projects.map((p) => p.name).join(", ") || "(none)"}. Use create_project first if it's new.`,
    );
  }
  return match.id;
}

async function getOwnedTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, include: TASK_INCLUDE });
  if (!task) throw new ToolError(`No task with id ${taskId}.`);
  return task;
}

// ---------------------------------------------------------------------------
// Tools

// Shown as a clickable link (meeting banner, public RSVP page) — only
// real web links, same rule as the event form.
const httpUrl = z.string().refine((u) => /^https?:\/\//i.test(u.trim()), "must start with http:// or https://");

const priority = z.number().int().min(0).max(3).describe("0 low, 1 medium, 2 high, 3 urgent");
const timeString = z.string().describe("ISO 8601 date or datetime; no offset = user's timezone");
const projectRef = {
  projectId: z.string().nullable().optional().describe("Project id (null to clear)"),
  project: z.string().nullable().optional().describe("Project name — matched case-insensitively, prefix ok"),
};

const TOOLS: Tool<z.ZodType>[] = [
  defineTool({
    name: "get_overview",
    description:
      "Today at a glance: the user's timezone and current time, today's calendar, overdue tasks, tasks due in the next 7 days, tasks whose scheduled time ends after their deadline, and how many open tasks aren't scheduled yet. Call this first.",
    input: z.object({}),
    readOnly: true,
    run: async (_args, { userId, timeZone }) => {
      const now = new Date();
      const dayStart = startOfZonedDay(now, timeZone);
      const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000);
      const tomorrowStart = startOfZonedDay(dayEnd, timeZone);
      const weekEnd = new Date(dayStart.getTime() + 8 * 86_400_000);
      const open = { userId, parentId: null, status: { not: "DONE" as const } };

      const [today, overdue, dueSoon, unscheduled] = await Promise.all([
        listOccurrences(userId, dayStart, tomorrowStart, timeZone),
        prisma.task.findMany({
          where: { ...open, dueAt: { lt: now } },
          include: TASK_INCLUDE,
          orderBy: { dueAt: "asc" },
          take: 25,
        }),
        prisma.task.findMany({
          where: { ...open, dueAt: { gte: now, lt: weekEnd } },
          include: TASK_INCLUDE,
          orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
          take: 25,
        }),
        prisma.task.count({ where: { ...open, status: { in: ["CREATED", "ONGOING"] }, events: { none: {} } } }),
      ]);
      // Scheduled, but the plan ends after the deadline (next 2 weeks).
      const scheduledWithDue = await prisma.task.findMany({
        where: { ...open, events: { some: {} }, dueAt: { gte: now, lt: new Date(now.getTime() + 14 * 86_400_000) } },
        include: TASK_INCLUDE,
      });
      const atRisk = scheduledWithDue.filter((t) => t.events.some((e) => e.end > t.dueAt!));
      return {
        timeZone,
        now: formatLocal(now, timeZone),
        today,
        overdueTasks: overdue.map((t) => serializeTask(t, timeZone)),
        dueThisWeek: dueSoon.map((t) => serializeTask(t, timeZone)),
        unscheduledOpenTaskCount: unscheduled,
        finishesAfterDeadline: atRisk.map((t) => serializeTask(t, timeZone)),
      };
    },
  }),

  defineTool({
    name: "list_tasks",
    description: "List tasks, open ones by default, soonest due first. Filter by project, status, or a search string.",
    input: z.object({
      status: z.enum(["open", "CREATED", "ONGOING", "DELAYED", "DONE", "all"]).default("open"),
      search: z.string().optional().describe("Case-insensitive substring of the title"),
      ...projectRef,
      dueBefore: timeString.optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    readOnly: true,
    run: async (args, { userId, timeZone }) => {
      const projectId = await resolveProjectId(userId, args);
      const tasks = await prisma.task.findMany({
        where: {
          userId,
          parentId: null,
          ...(args.status === "open" ? { status: { not: "DONE" } } : args.status === "all" ? {} : { status: args.status }),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(args.dueBefore ? { dueAt: { lt: parseUserTime(args.dueBefore, timeZone) } } : {}),
        },
        include: TASK_INCLUDE,
        orderBy:
          args.status === "DONE"
            ? [{ updatedAt: "desc" }]
            : [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      });
      // SQLite has no case-insensitive `contains` in Prisma — filter here.
      const needle = args.search?.toLowerCase();
      const filtered = needle ? tasks.filter((t) => t.title.toLowerCase().includes(needle)) : tasks;
      return {
        count: filtered.length,
        tasks: filtered.slice(0, args.limit).map((t) => serializeTask(t, timeZone)),
      };
    },
  }),

  defineTool({
    name: "get_task",
    description: "Full details of one task, including notes and subtasks.",
    input: z.object({ taskId: z.string() }),
    readOnly: true,
    run: async ({ taskId }, { userId, timeZone }) => serializeTask(await getOwnedTask(userId, taskId), timeZone),
  }),

  defineTool({
    name: "create_task",
    description:
      'Create a task. Either pass structured fields, or "text" in Season\'s quick-capture syntax (e.g. "Essay draft fri 5pm p2 #English 2h") — explicit fields override whatever the text parsed to. Set schedule=true to also auto-place it on the calendar.',
    input: z.object({
      title: z.string().optional(),
      text: z.string().optional().describe("Natural-language quick capture, parsed like the app's 'c' box"),
      notes: z.string().optional(),
      dueAt: timeString.optional(),
      startAt: timeString.optional().describe("Earliest time the scheduler may place it"),
      priority: priority.optional(),
      durationMin: z.number().int().min(5).max(24 * 60).optional().describe("Estimate in minutes (default 30)"),
      hardDeadline: z.boolean().optional().describe("false = soft 'aim for' date; default true"),
      ...projectRef,
      subtasks: z.array(z.string()).optional().describe("Checklist items to create under it"),
      schedule: z.boolean().default(false),
    }),
    run: async (args, { userId, timeZone }) => {
      const parsed = args.text ? parseQuickCapture(args.text, new Date(), timeZone, 17) : null;
      const title = (args.title ?? parsed?.title ?? "").trim();
      if (!title) throw new ToolError("A task needs a title (or text with one in it).");

      let projectId = await resolveProjectId(userId, args);
      if (projectId === undefined && parsed?.projectName) {
        projectId = await findProjectByName(userId, parsed.projectName).catch(() => undefined);
      }
      const task = await prisma.task.create({
        data: {
          userId,
          title,
          notes: args.notes ?? null,
          priority: args.priority ?? parsed?.priority ?? 0,
          durationMin: args.durationMin ?? parsed?.durationMin ?? 30,
          dueAt: args.dueAt ? parseUserTime(args.dueAt, timeZone) : (parsed?.dueAt ?? null),
          startAt: args.startAt ? parseUserTime(args.startAt, timeZone, 0) : null,
          hardDeadline: args.hardDeadline ?? true,
          projectId: projectId ?? null,
          ...(args.subtasks?.length
            ? { subtasks: { create: args.subtasks.filter((s) => s.trim()).map((s) => ({ userId, title: s.trim() })) } }
            : {}),
        },
      });
      runAutomationsForStatusChange(userId, task.id, "CREATED").catch((err) => console.error("automation error:", err));
      if (args.schedule) await scheduleTask(userId, task.id);
      else await autoPlaceIfEnabled(userId, task.id);
      return serializeTask(await getOwnedTask(userId, task.id), timeZone);
    },
  }),

  defineTool({
    name: "update_task",
    description: "Change a task's fields. Only the fields you pass are changed; pass null to clear dueAt/startAt/notes/project.",
    input: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      notes: z.string().nullable().optional(),
      dueAt: timeString.nullable().optional(),
      startAt: timeString.nullable().optional(),
      priority: priority.optional(),
      durationMin: z.number().int().min(5).max(24 * 60).optional(),
      hardDeadline: z.boolean().optional(),
      status: z.enum(["CREATED", "ONGOING", "DELAYED"]).optional().describe("Use complete_task for DONE"),
      ...projectRef,
    }),
    run: async (args, { userId, timeZone }) => {
      await getOwnedTask(userId, args.taskId);
      const projectId = await resolveProjectId(userId, args);
      const data: Record<string, unknown> = {};
      if (args.title !== undefined) {
        if (!args.title.trim()) throw new ToolError("title can't be empty.");
        data.title = args.title.trim();
      }
      if (args.notes !== undefined) data.notes = args.notes;
      if (args.dueAt !== undefined) data.dueAt = args.dueAt === null ? null : parseUserTime(args.dueAt, timeZone);
      if (args.startAt !== undefined) data.startAt = args.startAt === null ? null : parseUserTime(args.startAt, timeZone, 0);
      if (args.priority !== undefined) data.priority = args.priority;
      if (args.durationMin !== undefined) data.durationMin = args.durationMin;
      if (args.hardDeadline !== undefined) data.hardDeadline = args.hardDeadline;
      if (args.status !== undefined) data.status = args.status;
      // Same side effect as Delay in the app: a parked task gives up its slot.
      if (args.status === "DELAYED") await unscheduleTask(userId, args.taskId);
      if (projectId !== undefined) data.projectId = projectId;
      if (Object.keys(data).length === 0) throw new ToolError("Nothing to update.");
      await prisma.task.update({ where: { id: args.taskId }, data });
      if (data.title) {
        await prisma.event.updateMany({ where: { taskId: args.taskId }, data: { title: data.title as string, localDirty: true } });
      }
      return serializeTask(await getOwnedTask(userId, args.taskId), timeZone);
    },
  }),

  defineTool({
    name: "complete_task",
    description: "Mark a task (or subtask) done — or not done with done=false. Completing a recurring task creates its next occurrence.",
    input: z.object({ taskId: z.string(), done: z.boolean().default(true) }),
    run: async ({ taskId, done }, { userId }) => {
      if (!(await setTaskDone(userId, taskId, done))) throw new ToolError(`No task with id ${taskId}.`);
      return { ok: true, taskId, done };
    },
  }),

  defineTool({
    name: "delete_task",
    description: "Permanently delete a task, its subtasks, and its calendar slots. Prefer complete_task unless the user wants it gone.",
    input: z.object({ taskId: z.string() }),
    destructive: true,
    run: async ({ taskId }, { userId }) => {
      const task = await getOwnedTask(userId, taskId);
      const attachments = await prisma.taskAttachment.findMany({ where: { taskId }, select: { storedPath: true } });
      await Promise.all(
        attachments.map(async (a) => {
          const absolute = resolveUploadPath(a.storedPath);
          if (absolute) await unlink(absolute).catch(() => {});
        }),
      );
      await prisma.event.deleteMany({ where: { taskId } });
      await prisma.task.delete({ where: { id: taskId } });
      return { ok: true, deleted: task.title };
    },
  }),

  defineTool({
    name: "add_subtasks",
    description: "Add checklist subtasks under an existing task.",
    input: z.object({ taskId: z.string(), titles: z.array(z.string()).min(1) }),
    run: async ({ taskId, titles }, { userId, timeZone }) => {
      await getOwnedTask(userId, taskId);
      await prisma.task.createMany({
        data: titles.filter((t) => t.trim()).map((t) => ({ userId, title: t.trim(), parentId: taskId })),
      });
      return serializeTask(await getOwnedTask(userId, taskId), timeZone);
    },
  }),

  defineTool({
    name: "schedule_tasks",
    description:
      "Run Season's auto-scheduler. With taskId, places just that task; without, places every open unscheduled task in priority/deadline order. Returns where things landed.",
    input: z.object({ taskId: z.string().optional() }),
    run: async ({ taskId }, { userId, timeZone }) => {
      if (taskId) {
        await getOwnedTask(userId, taskId);
        const events = await scheduleTask(userId, taskId);
        if (!events) return { scheduled: false, reason: "No free slot fit (or it's blocked by an unfinished task)." };
        const task = await getOwnedTask(userId, taskId);
        return { scheduled: true, task: serializeTask(task, timeZone) };
      }
      const { results } = await scheduleAllPendingTasks(userId);
      const tasks = await prisma.task.findMany({
        where: { id: { in: results.map((r) => r.taskId) } },
        include: TASK_INCLUDE,
      });
      return {
        scheduled: tasks.filter((t) => t.events.length > 0).map((t) => serializeTask(t, timeZone)),
        couldNotPlace: tasks.filter((t) => t.events.length === 0).map((t) => ({ id: t.id, title: t.title })),
      };
    },
  }),

  defineTool({
    name: "list_projects",
    description: "List the user's projects with their open-task counts.",
    input: z.object({}),
    readOnly: true,
    run: async (_args, { userId }) => {
      const projects = await prisma.project.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { tasks: { where: { status: { not: "DONE" }, parentId: null } } } } },
      });
      return projects.map((p) => ({ id: p.id, name: p.name, color: p.color, openTasks: p._count.tasks }));
    },
  }),

  defineTool({
    name: "create_project",
    description: "Create a project to group tasks under.",
    input: z.object({
      name: z.string().min(1),
      color: z.enum(Object.keys(PROJECT_EVENT_COLORS) as [string, ...string[]]).optional(),
    }),
    run: async ({ name, color }, { userId }) => {
      const p = await prisma.project.create({ data: { userId, name: name.trim(), color: color ?? "zinc" } });
      return { id: p.id, name: p.name, color: p.color };
    },
  }),

  defineTool({
    name: "list_events",
    description: "Calendar events (recurring ones expanded) between two times. Defaults to the next 7 days.",
    input: z.object({ from: timeString.optional(), to: timeString.optional() }),
    readOnly: true,
    run: async (args, { userId, timeZone }) => {
      const from = args.from ? parseUserTime(args.from, timeZone, 0) : startOfZonedDay(new Date(), timeZone);
      const to = args.to ? parseUserTime(args.to, timeZone, 0) : new Date(from.getTime() + 7 * 86_400_000);
      if (to <= from) throw new ToolError("`to` must be after `from`.");
      if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new ToolError("Keep the range under ~3 months.");
      return listOccurrences(userId, from, to, timeZone);
    },
  }),

  defineTool({
    name: "create_event",
    description:
      "Put a fixed event on the calendar (a meeting, class, appointment). Auto-scheduled task blocks that overlap it get moved out of the way.",
    input: z.object({
      title: z.string().min(1),
      start: timeString,
      end: timeString.optional(),
      durationMin: z.number().int().min(5).optional().describe("Used when end is omitted (default 30)"),
      location: z.string().optional(),
      meetingUrl: httpUrl.optional(),
      notes: z.string().optional(),
    }),
    run: async (args, { userId, timeZone }) => {
      const start = parseUserTime(args.start, timeZone, 9);
      const end = args.end
        ? parseUserTime(args.end, timeZone, 9)
        : new Date(start.getTime() + (args.durationMin ?? 30) * 60_000);
      if (end <= start) throw new ToolError("end must be after start.");
      const event = await prisma.event.create({
        data: {
          userId,
          title: args.title.trim(),
          start,
          end,
          location: args.location ?? null,
          meetingUrl: args.meetingUrl ?? null,
          notes: args.notes ?? null,
          locked: true,
          localDirty: true,
        },
      });
      await rescheduleConflictsWith(userId, start, end, event.id);
      await rescheduleConflictedHabits(userId, start, end, event.id);
      return { id: event.id, title: event.title, when: `${formatLocal(start, timeZone)} – ${formatLocal(end, timeZone)}` };
    },
  }),

  defineTool({
    name: "update_event",
    description:
      "Change a one-off calendar event: rename, move (start/end), or edit its location, meeting link, or notes. Recurring series and read-only feed events can't be edited here.",
    input: z.object({
      eventId: z.string(),
      title: z.string().optional(),
      start: timeString.optional(),
      end: timeString.optional(),
      location: z.string().nullable().optional(),
      meetingUrl: httpUrl.nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
    run: async (args, { userId, timeZone }) => {
      const event = await prisma.event.findFirst({ where: { id: args.eventId, userId } });
      if (!event) throw new ToolError(`No event with id ${args.eventId}.`);
      if (event.source === "APPLE" || event.source === "SUBSCRIBED") {
        throw new ToolError("That event comes from a read-only calendar feed and can't be edited here.");
      }
      if (event.recurrenceRule) {
        throw new ToolError("That's a recurring series — edit it in Season's calendar so you can pick which occurrences change.");
      }
      // Moving the start without an end keeps the event's length.
      const start = args.start ? parseUserTime(args.start, timeZone, 9) : event.start;
      const end = args.end
        ? parseUserTime(args.end, timeZone, 9)
        : args.start
          ? new Date(start.getTime() + (event.end.getTime() - event.start.getTime()))
          : event.end;
      if (end <= start) throw new ToolError("end must be after start.");
      const updated = await prisma.event.update({
        where: { id: event.id },
        data: {
          ...(args.title?.trim() ? { title: args.title.trim() } : {}),
          start,
          end,
          ...(args.location !== undefined ? { location: args.location } : {}),
          ...(args.meetingUrl !== undefined ? { meetingUrl: args.meetingUrl } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          // A deliberately placed time — same as a manual drag in the UI.
          locked: true,
          localDirty: true,
        },
      });
      if (args.start || args.end) {
        await rescheduleConflictsWith(userId, start, end, event.id);
        await rescheduleConflictedHabits(userId, start, end, event.id);
      }
      return { id: updated.id, title: updated.title, when: `${formatLocal(start, timeZone)} – ${formatLocal(end, timeZone)}` };
    },
  }),

  defineTool({
    name: "delete_event",
    description: "Delete a calendar event (the whole series, if recurring). Also removes it from Google Calendar if synced.",
    input: z.object({ eventId: z.string() }),
    destructive: true,
    run: async ({ eventId }, { userId }) => {
      const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
      if (!event) throw new ToolError(`No event with id ${eventId}.`);
      if (event.source === "APPLE" || event.source === "SUBSCRIBED") {
        throw new ToolError("That event comes from a read-only calendar feed and can't be deleted here.");
      }
      if (event.googleEventId) {
        if (event.googleCalendarId) await deleteFromGoogle(event.googleCalendarId, event.googleEventId);
      }
      await prisma.event.delete({ where: { id: eventId } });
      return { ok: true, deleted: event.title };
    },
  }),
];

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name);

// ---------------------------------------------------------------------------
// Prompts — canned starting points that show up in the client's prompt
// menu (e.g. Claude's "+" → Season). Each is just instructions; the work
// happens through the tools above.

type Prompt = {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  text: (args: Record<string, string>) => string;
};

const PROMPTS: Prompt[] = [
  {
    name: "plan_my_day",
    title: "Plan my day",
    description: "Look at today's calendar and open tasks, then propose a realistic plan.",
    text: () =>
      `Use Season to plan my day. Call get_overview first. Then:
1. Summarize today's fixed commitments in one short list.
2. Point out anything overdue or due in the next two days that isn't scheduled.
3. Propose an order for the rest of today that fits around my events, with rough times. Be realistic — leave breathing room.
4. Ask before changing anything. Once I agree, use update_task / schedule_tasks / create_event to make it real.`,
  },
  {
    name: "weekly_review",
    title: "Weekly review",
    description: "Review the week ahead: deadlines, overload, and what to drop or move.",
    text: () =>
      `Run a weekly review with Season. Call get_overview, then list_events for the next 7 days and list_tasks (open).
- Group deadlines this week by project.
- Flag days that look overloaded and anything overdue.
- Suggest what to reschedule, delegate, or drop, and why.
Don't change anything until I confirm; then apply the changes with the tools.`,
  },
  {
    name: "brain_dump",
    title: "Brain dump to tasks",
    description: "Turn a messy list of thoughts into well-formed Season tasks.",
    arguments: [{ name: "notes", description: "Everything on your mind, in any format", required: true }],
    text: ({ notes }) =>
      `Turn this brain dump into Season tasks. For each real action item, pick a short title, a due date if one is implied, a priority, a duration estimate, and a project if one fits (call list_projects first to see what exists). Show me the list before creating anything; after I confirm, create them with create_task. Skip anything that isn't actionable and tell me what you skipped.

Brain dump:
${notes ?? ""}`,
  },
];

export const MCP_PROMPT_NAMES = PROMPTS.map((p) => p.name);
