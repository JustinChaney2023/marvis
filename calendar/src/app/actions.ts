"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";
import {
  rescheduleAll,
  rescheduleConflictsWith,
  scheduleAllPendingTasks,
  scheduleTask,
  unscheduleTask,
} from "@/lib/scheduler";
import { parseQuickCapture } from "@/lib/quickCapture";
import { expandEvents } from "@/lib/recurrence";
import { syncGoogleCalendar, deleteFromGoogle } from "@/lib/google-sync";
import { importFromApple } from "@/lib/apple-sync";
import { encryptSecret } from "@/lib/tokenCrypto";
import { getAppSettings, updateAppSettings } from "@/lib/settings";
import { createBooking, getAvailableBookingSlots } from "@/lib/booking";
import { nextTaskOccurrence } from "@/lib/taskRecurrence";
import { generateSubtasks, type GenerateSubtasksResult } from "@/lib/subtaskGenerate";
import { generateEmailDraft, type DraftEmailResult } from "@/lib/emailDraft";
import { generateTaskDoc, type DraftDocResult } from "@/lib/docDraft";
import { buildShutdownSummary, type ShutdownSummary } from "@/lib/shutdown";
import { runAutomationsForStatusChange } from "@/lib/automations";
import { askScheduleChat, type ChatMessage, type ChatResult } from "@/lib/scheduleChat";
import { scheduleHabitsForWeek, rescheduleConflictedHabits } from "@/lib/habits";

const REMINDER_WINDOW_MIN = 15;

/**
 * Occurrences (recurring included) starting within the next
 * REMINDER_WINDOW_MIN minutes, for the client-side notification watcher.
 * Read-only, no "already notified" tracking here — that's session-local
 * client state, since it only needs to matter while a tab is open.
 */
export async function getUpcomingEventReminders() {
  const user = await requireUser();
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60_000);
  const rows = await prisma.event.findMany({
    where: {
      userId: user.id,
      OR: [{ start: { gte: now, lt: soon } }, { recurrenceRule: { not: null } }],
    },
  });
  return expandEvents(rows, now, soon).map((o) => ({
    id: o.id,
    title: o.title,
    startIso: o.start.toISOString(),
  }));
}

const MEETING_BANNER_LOOKAHEAD_MIN = 15;
const MEETING_BANNER_LINGER_MIN = 10;

/**
 * Events with a meeting link starting soon (or that started within the
 * last MEETING_BANNER_LINGER_MIN minutes, so the banner doesn't vanish
 * the instant the clock hits start time) — for MeetingBanner.tsx's poll.
 */
export async function getUpcomingMeetingBannerAction() {
  const user = await requireUser();
  const now = new Date();
  const windowStart = new Date(now.getTime() - MEETING_BANNER_LINGER_MIN * 60_000);
  const windowEnd = new Date(now.getTime() + MEETING_BANNER_LOOKAHEAD_MIN * 60_000);
  const rows = await prisma.event.findMany({
    where: {
      userId: user.id,
      meetingUrl: { not: null },
      OR: [{ start: { gte: windowStart, lt: windowEnd } }, { recurrenceRule: { not: null } }],
    },
  });
  const meetingUrlByMasterId = new Map(rows.map((r) => [r.id, r.meetingUrl]));
  return expandEvents(rows, windowStart, windowEnd)
    .map((o) => ({
      id: o.id,
      title: o.title,
      startIso: o.start.toISOString(),
      meetingUrl: meetingUrlByMasterId.get(o.masterId) ?? null,
    }))
    .filter((o) => o.meetingUrl);
}

function energyFromFormData(formData: FormData): "LOW" | "MEDIUM" | "HIGH" {
  const value = String(formData.get("energy") ?? "MEDIUM");
  return value === "LOW" || value === "HIGH" ? value : "MEDIUM";
}

function taskFieldsFromFormData(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 0);
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const startAtRaw = String(formData.get("startAt") ?? "");
  const startAt = startAtRaw ? new Date(startAtRaw) : null;
  const dueAtDateRaw = String(formData.get("dueAtDate") ?? "");
  const dueAtTimeRaw = String(formData.get("dueAtTime") ?? "") || "17:00";
  const dueAt = dueAtDateRaw ? new Date(`${dueAtDateRaw}T${dueAtTimeRaw}`) : null;
  const projectId = String(formData.get("projectId") ?? "").trim() || null;
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  const timeSlotId = String(formData.get("timeSlotId") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  // A recurrence rule with no due date has nothing to anchor to (no
  // DTSTART equivalent) — silently drop it rather than create a task
  // that can never compute a next occurrence.
  const recurrenceRule = dueAt
    ? String(formData.get("recurrenceRule") ?? "").trim() || null
    : null;
  return {
    title,
    priority,
    durationMin,
    energy: energyFromFormData(formData),
    startAt,
    dueAt,
    projectId,
    assigneeId,
    timeSlotId,
    color,
    recurrenceRule,
  };
}

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const fields = taskFieldsFromFormData(formData);
  if (!fields.title) return;

  await prisma.task.create({
    data: { userId: user.id, ...fields },
  });

  // Remembered so the add-task form defaults to your last-used project
  // instead of "No project" every time — re-picking the same course/
  // client/project on every single task was a specifically-named
  // friction point in Motion user feedback.
  const cookieStore = await cookies();
  if (fields.projectId) {
    cookieStore.set("lastProjectId", fields.projectId, { maxAge: 60 * 60 * 24 * 365 });
  } else {
    cookieStore.delete("lastProjectId");
  }

  revalidatePath("/tasks");
}

export async function updateTask(taskId: string, formData: FormData) {
  const user = await requireUser();
  const fields = taskFieldsFromFormData(formData);
  if (!fields.title) return;

  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId: user.id },
    data: fields,
  });
  if (count === 0) return;

  // A scheduled task's placement (energy/due date/duration/project) may
  // no longer fit wherever it currently sits — the next "Schedule all" or
  // "Reschedule all" pass will fix it, same as any other stale slot. Not
  // forcing a reschedule inline here since that's a heavier, separate
  // action the user can already trigger themselves.
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function createSubtaskAction(parentId: string, title: string) {
  const user = await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return;

  // Ownership check on the parent, not just the new row — otherwise
  // anyone signed in could attach a subtask to someone else's task by id.
  const parent = await prisma.task.findFirst({ where: { id: parentId, userId: user.id } });
  if (!parent) return;

  await prisma.task.create({
    data: { userId: user.id, parentId, title: trimmed },
  });
  revalidatePath("/tasks");
}

/** Bulk version of createSubtaskAction, for the AI-suggested review list. */
export async function createSubtasksBulkAction(parentId: string, titles: string[]) {
  const user = await requireUser();
  const parent = await prisma.task.findFirst({ where: { id: parentId, userId: user.id } });
  if (!parent) return;

  const rows = titles.map((t) => t.trim()).filter(Boolean);
  if (rows.length === 0) return;

  await prisma.task.createMany({
    data: rows.map((title) => ({ userId: user.id, parentId, title })),
  });
  revalidatePath("/tasks");
}

export async function generateSubtasksAction(taskId: string): Promise<GenerateSubtasksResult> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    include: { project: true },
  });
  if (!task) return { ok: false, error: "Task not found." };

  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  return generateSubtasks(task.title, task.notes, task.project?.name ?? null, localAi);
}

export async function draftTaskEmailAction(taskId: string): Promise<DraftEmailResult> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    include: { project: true },
  });
  if (!task) return { ok: false, error: "Task not found." };

  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  return generateEmailDraft(task.title, task.notes, task.project?.name ?? null, task.dueAt, localAi);
}

export async function draftTaskDocAction(taskId: string): Promise<DraftDocResult> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    include: { project: true, subtasks: true },
  });
  if (!task) return { ok: false, error: "Task not found." };

  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  return generateTaskDoc(
    task.title,
    task.notes,
    task.project?.name ?? null,
    task.subtasks.map((s) => s.title),
    localAi,
  );
}

export async function getShutdownSummaryAction(): Promise<ShutdownSummary> {
  const user = await requireUser();
  return buildShutdownSummary(user.id);
}

/**
 * The shutdown ritual's one bulk action: push every still-open task
 * left at end of day to tomorrow, same due-time-of-day, unscheduling
 * any calendar slot it had (same semantics as the single-task delay
 * button — a deliberate push-off, not a scheduler decision).
 */
export async function pushLeftoversToTomorrowAction(taskIds: string[]) {
  const user = await requireUser();
  for (const taskId of taskIds) {
    const existing = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
    if (!existing) continue;
    const base = existing.dueAt ?? new Date();
    const tomorrow = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    await delayTaskAction(taskId, tomorrow.toISOString());
  }
  revalidatePath("/focus");
}

export async function askScheduleChatAction(messages: ChatMessage[]): Promise<ChatResult> {
  const user = await requireUser();
  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  return askScheduleChat(user.id, messages, localAi);
}

export async function deleteTaskAction(taskId: string) {
  const user = await requireUser();
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!task) return;

  // Event.taskId has no onDelete clause (no cascade/set-null), so the
  // linked scheduled Event has to go before the Task row itself, or the
  // delete below hits a foreign-key violation. Task.parentId does
  // cascade (schema.prisma), so subtasks clean themselves up.
  await prisma.event.deleteMany({ where: { taskId } });
  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function quickCaptureTask(text: string) {
  const user = await requireUser();
  const parsed = parseQuickCapture(text);
  if (!parsed.title) return;

  await prisma.task.create({
    data: {
      userId: user.id,
      title: parsed.title,
      priority: parsed.priority,
      dueAt: parsed.dueAt,
    },
  });
  revalidatePath("/tasks");
}

export async function createProject(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const color = String(formData.get("color") ?? "zinc").trim() || "zinc";

  await prisma.project.create({ data: { userId: user.id, name, color } });
  revalidatePath("/tasks");
}

export async function deleteProject(projectId: string) {
  const user = await requireUser();
  await prisma.project.deleteMany({ where: { id: projectId, userId: user.id } });
  revalidatePath("/tasks");
}

export async function createAssignee(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const role = String(formData.get("role") ?? "").trim() || null;
  const type = formData.get("type") === "AI" ? "AI" : "HUMAN";

  await prisma.assignee.create({ data: { userId: user.id, name, role, type } });
  revalidatePath("/team");
  revalidatePath("/tasks");
}

export async function deleteAssignee(assigneeId: string) {
  const user = await requireUser();
  await prisma.assignee.deleteMany({ where: { id: assigneeId, userId: user.id } });
  revalidatePath("/team");
  revalidatePath("/tasks");
}

// Folds elapsed time since `timerStartedAt` into `trackedMinutes` and
// clears it — called by every action that moves a task away from
// ONGOING, so time is never silently lost (only ever added once, since
// timerStartedAt is cleared in the same write).
function stoppedTimerFields(task: { timerStartedAt: Date | null; trackedMinutes: number }) {
  if (!task.timerStartedAt) return { patch: {}, elapsedMin: 0 };
  const elapsedMin = Math.max(0, Math.round((Date.now() - task.timerStartedAt.getTime()) / 60_000));
  return {
    patch: {
      trackedMinutes: task.trackedMinutes + elapsedMin,
      timerStartedAt: null,
    },
    elapsedMin,
  };
}

// One row per timer stop, for the time-tracking report — the plain
// cumulative Task.trackedMinutes total can't be bucketed by week on its
// own. Fire-and-forget-adjacent (awaited, but never blocks/fails the
// status change it's attached to since a broken report is much lower
// stakes than a task update failing).
async function logTrackedTime(userId: string, taskId: string, elapsedMin: number) {
  if (elapsedMin <= 0) return;
  try {
    await prisma.timeLogEntry.create({ data: { userId, taskId, minutes: elapsedMin } });
  } catch (err) {
    console.error("logTrackedTime failed:", err);
  }
}

export async function toggleTaskDone(taskId: string, done: boolean) {
  const user = await requireUser();
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!existing) return;

  const timerStop = stoppedTimerFields(existing);
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: done ? "DONE" : "CREATED",
      ...timerStop.patch,
    },
  });
  await logTrackedTime(user.id, taskId, timerStop.elapsedMin);
  runAutomationsForStatusChange(user.id, taskId, task.status).catch((err) =>
    console.error("automation error:", err),
  );

  // Recurring tasks aren't expanded like recurring events — completing one
  // materializes the next occurrence as a new row, since a task carries
  // per-instance state (status, its own scheduled event) that doesn't fit
  // the "compute on the fly" model.
  if (done && task.recurrenceRule && task.dueAt) {
    const nextDueAt = nextTaskOccurrence(task.recurrenceRule, task.dueAt);
    if (nextDueAt) {
      await prisma.task.create({
        data: {
          userId: user.id,
          title: task.title,
          notes: task.notes,
          priority: task.priority,
          energy: task.energy,
          durationMin: task.durationMin,
          dueAt: nextDueAt,
          projectId: task.projectId,
          assigneeId: task.assigneeId,
          recurrenceRule: task.recurrenceRule,
        },
      });
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/");
}

/**
 * Manual toggle between CREATED and ONGOING ("I'm working on this now")
 * — doubles as the time-tracking start/stop: going ONGOING starts the
 * timer, leaving it stops and folds the elapsed time into trackedMinutes.
 */
export async function setTaskStatusAction(taskId: string, status: "CREATED" | "ONGOING") {
  const user = await requireUser();
  const existing = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id, status: { in: ["CREATED", "ONGOING"] } },
  });
  if (!existing) return;

  const timerStop = status === "ONGOING" ? { patch: {}, elapsedMin: 0 } : stoppedTimerFields(existing);
  await prisma.task.update({
    where: { id: taskId },
    data:
      status === "ONGOING"
        ? { status, timerStartedAt: existing.timerStartedAt ?? new Date() }
        : { status, ...timerStop.patch },
  });
  await logTrackedTime(user.id, taskId, timerStop.elapsedMin);
  runAutomationsForStatusChange(user.id, taskId, status).catch((err) =>
    console.error("automation error:", err),
  );
  revalidatePath("/tasks");
}

/**
 * Pushes a task off: bumps its due date and drops its calendar slot if it
 * had one, so it doesn't sit half-scheduled at an old time while also
 * being marked as deliberately deferred. Deliberately excluded from the
 * scheduler's TODO sweep (see scheduleAllPendingTasks) until manually
 * un-delayed.
 */
export async function delayTaskAction(taskId: string, newDueAtIso: string) {
  const user = await requireUser();
  const newDueAt = new Date(newDueAtIso);
  if (Number.isNaN(newDueAt.getTime())) return;

  const existing = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!existing) return;

  const timerStop = stoppedTimerFields(existing);
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "DELAYED", dueAt: newDueAt, ...timerStop.patch },
  });
  await logTrackedTime(user.id, taskId, timerStop.elapsedMin);
  runAutomationsForStatusChange(user.id, taskId, "DELAYED").catch((err) =>
    console.error("automation error:", err),
  );
  await unscheduleTask(user.id, taskId);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function scheduleTaskAction(taskId: string) {
  const user = await requireUser();
  await scheduleTask(user.id, taskId);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function unscheduleTaskAction(taskId: string) {
  const user = await requireUser();
  await unscheduleTask(user.id, taskId);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function scheduleAllAction() {
  const user = await requireUser();
  await scheduleAllPendingTasks(user.id);
  await scheduleHabitsForWeek(user.id);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function rescheduleAllAction() {
  const user = await requireUser();
  await rescheduleAll(user.id);
  revalidatePath("/tasks");
  revalidatePath("/");
}

function recurrenceRuleFromFormData(formData: FormData): string | null {
  const value = String(formData.get("recurrenceRule") ?? "").trim();
  return value || null;
}

function lockedFromFormData(formData: FormData): boolean {
  return formData.get("locked") === "on";
}

// A brand-new/moved recurring event could conflict with a scheduled task
// on any future occurrence, not just the one instant we'd check here —
// that's a sweep problem the periodic rescheduleStaleTasks (run by
// Schedule all / Reschedule all) already handles by expanding recurrence
// over a real window. The instant, single-interval check below only
// makes sense for one-off events.
export async function createEvent(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  const recurrenceRule = recurrenceRuleFromFormData(formData);
  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;

  await prisma.event.create({
    data: {
      userId: user.id,
      title,
      start,
      end,
      recurrenceRule,
      meetingUrl,
      color,
      locked: lockedFromFormData(formData),
      localDirty: true,
    },
  });
  if (!recurrenceRule) {
    await rescheduleConflictsWith(user.id, start, end);
    await rescheduleConflictedHabits(user.id, start, end);
  }
  revalidatePath("/");
}

export async function updateEvent(eventId: string, formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  const recurrenceRule = recurrenceRuleFromFormData(formData);
  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;

  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId: user.id },
    data: {
      title,
      start,
      end,
      recurrenceRule,
      meetingUrl,
      color,
      locked: lockedFromFormData(formData),
      localDirty: true,
    },
  });
  if (count > 0 && !recurrenceRule) {
    await rescheduleConflictsWith(user.id, start, end, eventId);
    await rescheduleConflictedHabits(user.id, start, end, eventId);
  }
  revalidatePath("/");
}

export async function moveEvent(eventId: string, startIso: string, endIso: string) {
  const user = await requireUser();
  const start = new Date(startIso);
  const end = new Date(endIso);
  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId: user.id },
    data: { start, end, localDirty: true },
  });
  if (count > 0) {
    await rescheduleConflictsWith(user.id, start, end, eventId);
    await rescheduleConflictedHabits(user.id, start, end, eventId);
  }
  revalidatePath("/");
}

export async function deleteEvent(eventId: string) {
  const user = await requireUser();
  const event = await prisma.event.findFirst({ where: { id: eventId, userId: user.id } });
  if (!event) return;
  if (event.googleEventId) {
    await deleteFromGoogle(user.id, event.googleEventId);
  }
  // Deleting the event doesn't touch the task's status — losing its slot
  // (whatever the task's status is) is enough on its own to put it back
  // in scheduleAllPendingTasks' sweep, same reasoning as unscheduleTask.
  await prisma.event.delete({ where: { id: eventId } });
  revalidatePath("/");
  revalidatePath("/tasks");
}

export async function syncGoogleCalendarAction() {
  const user = await requireUser();
  const result = await syncGoogleCalendar(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return result;
}

export async function disconnectGoogleAction() {
  const user = await requireUser();
  await prisma.googleAccount.deleteMany({ where: { userId: user.id } });
  revalidatePath("/settings");
}

/**
 * Saves the Apple ID + app-specific password and immediately runs a sync
 * to validate them — Apple has no OAuth flow to fail fast on bad
 * credentials the way Google's redirect does, so this is the only real
 * chance to catch a typo before it just sits there silently failing.
 */
export async function connectAppleAction(formData: FormData) {
  const user = await requireUser();
  const appleId = String(formData.get("appleId") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!appleId || !appPassword) {
    redirect(`/settings?apple_error=${encodeURIComponent("Apple ID and app-specific password are both required.")}`);
  }

  await prisma.appleAccount.upsert({
    where: { userId: user.id },
    create: { userId: user.id, appleId, appPassword: encryptSecret(appPassword) },
    update: { appleId, appPassword: encryptSecret(appPassword) },
  });

  const result = await importFromApple(user.id);
  if (!result.ok) {
    await prisma.appleAccount.deleteMany({ where: { userId: user.id } });
    redirect(`/settings?apple_error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function disconnectAppleAction() {
  const user = await requireUser();
  await prisma.event.deleteMany({ where: { userId: user.id, source: "APPLE" } });
  await prisma.appleAccount.deleteMany({ where: { userId: user.id } });
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function syncAppleCalendarAction() {
  const user = await requireUser();
  const result = await importFromApple(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return result;
}

export async function updateSchedulingSettingsAction(formData: FormData) {
  const user = await requireUser();
  const bufferMin = Number(formData.get("bufferMin") ?? 10);
  if (!Number.isFinite(bufferMin) || bufferMin < 0 || bufferMin > 120) return;

  const dailyCapRaw = String(formData.get("dailyCapMin") ?? "").trim();
  let dailyCapMin: number | null = null;
  if (dailyCapRaw) {
    const parsed = Number(dailyCapRaw);
    if (!Number.isFinite(parsed) || parsed < 30 || parsed > 960) return;
    dailyCapMin = parsed;
  }

  await updateAppSettings(user.id, { bufferMin, dailyCapMin });
  revalidatePath("/settings");
}

export async function updateAiSettingsAction(formData: FormData) {
  const user = await requireUser();
  const localAiUrl = String(formData.get("localAiUrl") ?? "").trim() || null;
  const localAiModel = String(formData.get("localAiModel") ?? "").trim() || null;
  await updateAppSettings(user.id, { localAiUrl, localAiModel });
  revalidatePath("/settings");
}

const SHARE_AVAILABILITY_MAX_SLOTS = 8;
const SHARE_AVAILABILITY_DURATION_MIN = 30;

/**
 * Plain-text open slots to paste into an email/DM/Slack message, instead
 * of sending the full public booking-page link — a specifically-named
 * want from solo founders/freelancers researching Motion. Reuses the
 * exact same availability computation as the public booking page, so it
 * can never offer a time the booking page (or the auto-scheduler) would
 * disagree is actually free. Duration here is a generic default (not any
 * particular booking link's own duration) since this isn't tied to one.
 */
export async function getShareAvailabilityTextAction(): Promise<string> {
  const user = await requireUser();
  const byDay = await getAvailableBookingSlots(user.id, SHARE_AVAILABILITY_DURATION_MIN);

  const lines: string[] = [];
  outer: for (const day of byDay) {
    for (const slot of day.slots) {
      lines.push(
        `- ${slot.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${slot.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
      );
      if (lines.length >= SHARE_AVAILABILITY_MAX_SLOTS) break outer;
    }
  }

  if (lines.length === 0) {
    return "I don't have any open times in the next couple weeks — let me know what works and I'll make room.";
  }
  return `Here are some times that work for me:\n${lines.join("\n")}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBookingLinkForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim() || "Book time with me";
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const rawSlug = String(formData.get("slug") ?? "").trim();
  const slug = rawSlug ? slugify(rawSlug) : "";
  return { title, durationMin, slug };
}

export async function createBookingLinkAction(formData: FormData) {
  const user = await requireUser();
  const { title, durationMin, slug } = parseBookingLinkForm(formData);
  if (!slug || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 240) return;

  try {
    await prisma.bookingLink.create({
      data: { userId: user.id, slug, title, durationMin, enabled: true },
    });
  } catch {
    // Unique constraint on slug — already taken (by this user or another).
  }
  revalidatePath("/settings");
}

export async function updateBookingLinkAction(linkId: string, formData: FormData) {
  const user = await requireUser();
  const { title, durationMin, slug } = parseBookingLinkForm(formData);
  if (!slug || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 240) return;

  try {
    await prisma.bookingLink.updateMany({
      where: { id: linkId, userId: user.id },
      data: { title, durationMin, slug },
    });
  } catch {
    // Unique constraint on slug — already taken by another link.
  }
  revalidatePath("/settings");
}

export async function toggleBookingLinkAction(linkId: string, enabled: boolean) {
  const user = await requireUser();
  await prisma.bookingLink.updateMany({
    where: { id: linkId, userId: user.id },
    data: { enabled },
  });
  revalidatePath("/settings");
}

export async function deleteBookingLinkAction(linkId: string) {
  const user = await requireUser();
  await prisma.bookingLink.deleteMany({ where: { id: linkId, userId: user.id } });
  revalidatePath("/settings");
}

const AUTOMATION_ACTIONS = ["NOTIFY", "GENERATE_SUBTASKS", "DRAFT_EMAIL", "SET_PRIORITY_URGENT"] as const;
const AUTOMATION_STATUSES = ["CREATED", "ONGOING", "DELAYED", "DONE"] as const;

export async function createAutomationRuleAction(formData: FormData) {
  const user = await requireUser();
  const triggerStatus = String(formData.get("triggerStatus") ?? "");
  const action = String(formData.get("action") ?? "");
  const projectId = String(formData.get("projectId") ?? "").trim() || null;
  if (
    !AUTOMATION_STATUSES.includes(triggerStatus as (typeof AUTOMATION_STATUSES)[number]) ||
    !AUTOMATION_ACTIONS.includes(action as (typeof AUTOMATION_ACTIONS)[number])
  ) {
    return;
  }

  await prisma.automationRule.create({
    data: {
      userId: user.id,
      triggerStatus: triggerStatus as (typeof AUTOMATION_STATUSES)[number],
      action: action as (typeof AUTOMATION_ACTIONS)[number],
      projectId,
    },
  });
  revalidatePath("/settings");
}

export async function toggleAutomationRuleAction(ruleId: string, enabled: boolean) {
  const user = await requireUser();
  await prisma.automationRule.updateMany({
    where: { id: ruleId, userId: user.id },
    data: { enabled },
  });
  revalidatePath("/settings");
}

export async function deleteAutomationRuleAction(ruleId: string) {
  const user = await requireUser();
  await prisma.automationRule.deleteMany({ where: { id: ruleId, userId: user.id } });
  revalidatePath("/settings");
}

/**
 * Unseen automation notifications for NotificationWatcher.tsx's poll —
 * marks them seen immediately (fire-once, same as event reminders' own
 * session-local notifiedIds, just server-tracked here since these are
 * generated server-side asynchronously rather than computed from a poll
 * window).
 */
export async function getPendingAutomationNotificationsAction() {
  const user = await requireUser();
  const pending = await prisma.automationNotification.findMany({
    where: { userId: user.id, seen: false },
    orderBy: { createdAt: "asc" },
  });
  if (pending.length > 0) {
    await prisma.automationNotification.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { seen: true },
    });
  }
  return pending.map((p) => ({ id: p.id, message: p.message }));
}

export async function createHabitAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const timesPerWeek = Number(formData.get("timesPerWeek") ?? 1);
  if (!title || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 480) return;
  if (!Number.isFinite(timesPerWeek) || timesPerWeek < 1 || timesPerWeek > 14) return;

  await prisma.habit.create({
    data: { userId: user.id, title, durationMin, timesPerWeek },
  });
  await scheduleHabitsForWeek(user.id);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function toggleHabitAction(habitId: string, enabled: boolean) {
  const user = await requireUser();
  await prisma.habit.updateMany({ where: { id: habitId, userId: user.id }, data: { enabled } });
  if (enabled) await scheduleHabitsForWeek(user.id);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function deleteHabitAction(habitId: string) {
  const user = await requireUser();
  // Event.habitId cascades on Habit delete (schema onDelete: Cascade), so
  // this quietly clears this week's already-placed occurrences too.
  await prisma.habit.deleteMany({ where: { id: habitId, userId: user.id } });
  revalidatePath("/settings");
}

const TIME_SLOT_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export async function createTimeSlotAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const days = TIME_SLOT_WEEKDAYS.filter((d) => formData.get(`day_${d}`) === "on");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (!name || days.length === 0 || !startTime || !endTime) return;

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return;

  await prisma.timeSlot.create({
    data: { userId: user.id, name, daysOfWeek: days.join(","), startMin, endMin },
  });
  revalidatePath("/settings");
}

export async function deleteTimeSlotAction(timeSlotId: string) {
  const user = await requireUser();
  // Task.timeSlotId is onDelete: SetNull, so tasks using this slot just
  // fall back to the default work window rather than erroring.
  await prisma.timeSlot.deleteMany({ where: { id: timeSlotId, userId: user.id } });
  revalidatePath("/settings");
  revalidatePath("/");
}

// Public, unauthenticated endpoint — cheap in-memory rate limit per IP so
// a trivial script can't spam bookings or flood the owner's synced Google
// Calendar. Doesn't survive a restart and won't stop a determined
// attacker rotating IPs, but stops the cheap case, which is the realistic
// threat for a personal app's booking link.
const isBookingRateLimited = createRateLimiter(5, 60 * 60 * 1000);

export async function createBookingAction(
  slug: string,
  startIso: string,
  formData: FormData,
) {
  if (isBookingRateLimited(await requestIp())) {
    return { ok: false as const, error: "Too many attempts — please try again later." };
  }

  // Resolved server-side from the slug in the URL, never trusted from the
  // client — this is a public, unauthenticated action.
  const link = await prisma.bookingLink.findFirst({
    where: { slug, enabled: true },
    select: { id: true, userId: true },
  });
  if (!link) {
    return { ok: false as const, error: "This booking page isn't available." };
  }

  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const result = await createBooking(link.userId, link.id, startIso, name, email, notes);
  if (result.ok) {
    revalidatePath("/");
  }
  return result;
}

export async function submitFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  if (!message) return;
  const rawCategory = String(formData.get("category") ?? "SUGGESTION");
  const category =
    rawCategory === "BUG" || rawCategory === "OTHER" ? rawCategory : "SUGGESTION";
  const page = String(formData.get("page") ?? "").slice(0, 200) || null;

  await prisma.feedback.create({
    data: { userId: user.id, message, category, page },
  });
}
