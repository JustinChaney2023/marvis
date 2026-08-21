"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";
import {
  findGroupSlot,
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
import { aiConfigFromSettings, getAppSettings, updateAppSettings } from "@/lib/settings";
import { createBooking, getAvailableBookingSlots } from "@/lib/booking";
import { nextTaskOccurrence } from "@/lib/taskRecurrence";
import { generateSubtasks, type GenerateSubtasksResult } from "@/lib/subtaskGenerate";
import { generateEmailDraft, type DraftEmailResult } from "@/lib/emailDraft";
import { generateTaskDoc, type DraftDocResult } from "@/lib/docDraft";
import { buildShutdownSummary, type ShutdownSummary } from "@/lib/shutdown";
import { runAutomationsForStatusChange } from "@/lib/automations";
import { askScheduleChat, type ChatMessage, type ChatResult } from "@/lib/scheduleChat";
import { scheduleHabitsForWeek, rescheduleConflictedHabits } from "@/lib/habits";
import { formatYMD } from "@/lib/calendar-dates";
import { syncCalendarSubscription } from "@/lib/calendarSubscriptions";
import { randomBytes } from "node:crypto";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { unlink } from "node:fs/promises";
import path from "node:path";

// Widest of REMINDER_MINUTES_PRESETS (EventModal.tsx) plus a little
// slack, so the window is never narrower than the longest custom
// reminder a user can pick.
const REMINDER_WINDOW_MIN = 24 * 60 + 15;

/**
 * Occurrences (recurring included) whose own per-event `reminderMinutes`
 * has now come due, for the client-side notification watcher. Read-only,
 * no "already notified" tracking here — that's session-local client
 * state, since it only needs to matter while a tab is open.
 */
export async function getUpcomingEventReminders() {
  const user = await requireUser();
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60_000);
  const rows = await prisma.event.findMany({
    where: {
      userId: user.id,
      reminderMinutes: { not: null },
      OR: [{ start: { gte: now, lt: soon } }, { recurrenceRule: { not: null } }],
    },
  });
  const reminderMinutesByMasterId = new Map(rows.map((r) => [r.id, r.reminderMinutes]));
  return expandEvents(rows, now, soon)
    .filter((o) => {
      const reminderMinutes = reminderMinutesByMasterId.get(o.masterId);
      if (reminderMinutes == null) return false;
      const minutesAway = (o.start.getTime() - now.getTime()) / 60_000;
      return minutesAway <= reminderMinutes;
    })
    .map((o) => ({
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

// projectId/assigneeId/timeSlotId come straight from client-submitted
// FormData — without this, a task could be attached to another user's
// Project/Assignee/TimeSlot row by id (they're not secret, just cuids),
// and that row's name/color would then leak to the attacker via their
// own task's `include: { project: true }` etc. Same bug class the prior
// audit found in unscheduleTask; unverified ids just silently drop.
async function verifyOwnedId(
  model: "project" | "assignee" | "timeSlot",
  id: string | null,
  userId: string,
): Promise<string | null> {
  if (!id) return null;
  const where = { id, userId };
  const row =
    model === "project"
      ? await prisma.project.findFirst({ where, select: { id: true } })
      : model === "assignee"
        ? await prisma.assignee.findFirst({ where, select: { id: true } })
        : await prisma.timeSlot.findFirst({ where, select: { id: true } });
  return row ? id : null;
}

async function taskFieldsFromFormData(formData: FormData, userId: string) {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const priority = Number(formData.get("priority") ?? 0);
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const startAtRaw = String(formData.get("startAt") ?? "");
  const startAt = startAtRaw ? new Date(startAtRaw) : null;
  const dueAtDateRaw = String(formData.get("dueAtDate") ?? "");
  const dueAtTimeRaw = String(formData.get("dueAtTime") ?? "") || "17:00";
  const dueAt = dueAtDateRaw ? new Date(`${dueAtDateRaw}T${dueAtTimeRaw}`) : null;
  const [projectId, assigneeId, timeSlotId] = await Promise.all([
    verifyOwnedId("project", String(formData.get("projectId") ?? "").trim() || null, userId),
    verifyOwnedId("assignee", String(formData.get("assigneeId") ?? "").trim() || null, userId),
    verifyOwnedId("timeSlot", String(formData.get("timeSlotId") ?? "").trim() || null, userId),
  ]);
  const color = String(formData.get("color") ?? "").trim() || null;
  const chunkMinRaw = String(formData.get("chunkMin") ?? "").trim();
  const chunkMin = chunkMinRaw ? Math.max(1, Number(chunkMinRaw)) : null;
  // A recurrence rule with no due date has nothing to anchor to (no
  // DTSTART equivalent) — silently drop it rather than create a task
  // that can never compute a next occurrence.
  const recurrenceRule = dueAt
    ? String(formData.get("recurrenceRule") ?? "").trim() || null
    : null;
  // Only meaningful with a due date — the checkbox itself is hidden
  // without one, but guard here too since a checkbox's absence from
  // FormData when unchecked is indistinguishable from "no due date set".
  const hardDeadline = dueAt ? formData.get("hardDeadline") === "on" : true;
  return {
    title,
    notes,
    priority,
    durationMin,
    energy: energyFromFormData(formData),
    startAt,
    dueAt,
    projectId,
    assigneeId,
    timeSlotId,
    color,
    chunkMin,
    recurrenceRule,
    hardDeadline,
  };
}

// Parsed out of taskFieldsFromFormData's plain-scalar `fields` object since
// prisma.task.updateMany (used by updateTask, since it's also an ownership
// filter) can't write relations at all — both callers apply this
// separately via a second prisma.task.update once they know the row exists
// and is actually owned by this user.
function labelIdsFromFormData(formData: FormData): string[] {
  return String(formData.get("labelIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function setTaskLabels(userId: string, taskId: string, labelIds: string[]) {
  if (labelIds.length === 0) {
    await prisma.task.update({ where: { id: taskId }, data: { labels: { set: [] } } });
    return;
  }
  const labels = await prisma.label.findMany({ where: { id: { in: labelIds }, userId } });
  await prisma.task.update({
    where: { id: taskId },
    data: { labels: { set: labels.map((l) => ({ id: l.id })) } },
  });
}

function blockedByIdsFromFormData(formData: FormData): string[] {
  return String(formData.get("blockedByIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A task can't depend on itself — filtered out here rather than in the UI,
// since the UI's own task list already includes the task being edited.
async function setTaskBlockedBy(userId: string, taskId: string, blockedByIds: string[]) {
  const ids = blockedByIds.filter((id) => id !== taskId);
  if (ids.length === 0) {
    await prisma.task.update({ where: { id: taskId }, data: { blockedBy: { set: [] } } });
    return;
  }
  const blockers = await prisma.task.findMany({ where: { id: { in: ids }, userId } });
  await prisma.task.update({
    where: { id: taskId },
    data: { blockedBy: { set: blockers.map((t) => ({ id: t.id })) } },
  });
}

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const fields = await taskFieldsFromFormData(formData, user.id);
  if (!fields.title) return;

  const task = await prisma.task.create({
    data: { userId: user.id, ...fields },
  });
  await setTaskLabels(user.id, task.id, labelIdsFromFormData(formData));
  await setTaskBlockedBy(user.id, task.id, blockedByIdsFromFormData(formData));

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

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];

// Auto-logged TaskActivity entries for whatever updateTask actually
// changed — generated server-side from the real before/after values so
// a client can't spoof what "changed."
async function logTaskFieldChanges(
  taskId: string,
  before: { priority: number; dueAt: Date | null; assigneeId: string | null },
  after: { priority: number; dueAt: Date | null; assigneeId: string | null },
) {
  const entries: string[] = [];
  if (before.priority !== after.priority) {
    entries.push(`Priority changed to ${PRIORITY_LABEL[after.priority] ?? after.priority}`);
  }
  if ((before.dueAt?.getTime() ?? null) !== (after.dueAt?.getTime() ?? null)) {
    entries.push(
      after.dueAt ? `Due date changed to ${formatYMD(after.dueAt)}` : "Due date removed",
    );
  }
  if (before.assigneeId !== after.assigneeId) {
    const assignee = after.assigneeId
      ? await prisma.assignee.findUnique({ where: { id: after.assigneeId }, select: { name: true } })
      : null;
    entries.push(assignee ? `Assigned to ${assignee.name}` : "Unassigned");
  }
  if (entries.length === 0) return;
  await prisma.taskActivity.createMany({
    data: entries.map((detail) => ({ taskId, kind: "field", detail })),
  });
}

export async function updateTask(taskId: string, formData: FormData) {
  const user = await requireUser();
  const fields = await taskFieldsFromFormData(formData, user.id);
  if (!fields.title) return;

  const existing = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    select: { priority: true, dueAt: true, assigneeId: true },
  });
  if (!existing) return;

  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId: user.id },
    data: fields,
  });
  if (count === 0) return;
  await logTaskFieldChanges(taskId, existing, fields);
  await setTaskLabels(user.id, taskId, labelIdsFromFormData(formData));
  await setTaskBlockedBy(user.id, taskId, blockedByIdsFromFormData(formData));

  // A scheduled task's placement (energy/due date/duration/project) may
  // no longer fit wherever it currently sits — the next "Schedule all" or
  // "Reschedule all" pass will fix it, same as any other stale slot. Not
  // forcing a reschedule inline here since that's a heavier, separate
  // action the user can already trigger themselves.
  revalidatePath("/tasks");
  revalidatePath("/");
}

export type TaskActivityEntry = {
  id: string;
  kind: "field" | "comment" | "attachment";
  detail: string;
  createdAt: Date;
  // Only set for kind "attachment" — id/filename to render a download
  // link and a delete button.
  attachment?: { id: string; filename: string; url: string; sizeBytes: number };
};

/** Attachments + activity/comments for one task, merged into one timeline. */
export async function getTaskActivityAction(taskId: string): Promise<TaskActivityEntry[]> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!task) return [];

  const [activity, attachments] = await Promise.all([
    prisma.taskActivity.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } }),
    prisma.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } }),
  ]);

  const entries: TaskActivityEntry[] = activity.map((a) => ({
    id: a.id,
    kind: a.kind === "comment" ? "comment" : "field",
    detail: a.detail,
    createdAt: a.createdAt,
  }));
  for (const att of attachments) {
    entries.push({
      id: att.id,
      kind: "attachment",
      detail: `Attached ${att.filename}`,
      createdAt: att.createdAt,
      attachment: {
        id: att.id,
        filename: att.filename,
        url: `/uploads/${att.storedPath}`,
        sizeBytes: att.sizeBytes,
      },
    });
  }
  entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return entries;
}

export async function addTaskCommentAction(taskId: string, comment: string) {
  const user = await requireUser();
  const trimmed = comment.trim();
  if (!trimmed) return;
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!task) return;

  await prisma.taskActivity.create({ data: { taskId, kind: "comment", detail: trimmed } });
  revalidatePath("/tasks");
}

/** Registers a file already written by POST /api/uploads/attachments as this task's attachment. */
export async function addTaskAttachmentAction(
  taskId: string,
  file: { filename: string; storedPath: string; mimeType: string; sizeBytes: number },
) {
  const user = await requireUser();
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!task) return;

  await prisma.taskAttachment.create({ data: { taskId, ...file } });
  revalidatePath("/tasks");
}

export async function deleteTaskAttachmentAction(attachmentId: string) {
  const user = await requireUser();
  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: attachmentId, task: { userId: user.id } },
  });
  if (!attachment) return;

  await prisma.taskAttachment.delete({ where: { id: attachmentId } });
  // Best-effort — a missing file on disk shouldn't block removing the
  // now-orphaned DB row the user already asked to delete.
  await unlink(path.join(process.cwd(), "public", "uploads", attachment.storedPath)).catch(() => {});
  revalidatePath("/tasks");
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

  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return generateSubtasks(task.title, task.notes, task.project?.name ?? null, localAi, anthropicApiKey);
}

export async function draftTaskEmailAction(taskId: string): Promise<DraftEmailResult> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    include: { project: true },
  });
  if (!task) return { ok: false, error: "Task not found." };

  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return generateEmailDraft(task.title, task.notes, task.project?.name ?? null, task.dueAt, localAi, anthropicApiKey);
}

export async function draftTaskDocAction(taskId: string): Promise<DraftDocResult> {
  const user = await requireUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: user.id },
    include: { project: true, subtasks: true },
  });
  if (!task) return { ok: false, error: "Task not found." };

  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return generateTaskDoc(
    task.title,
    task.notes,
    task.project?.name ?? null,
    task.subtasks.map((s) => s.title),
    localAi,
    anthropicApiKey,
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
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return askScheduleChat(user.id, messages, localAi, anthropicApiKey);
}

export async function deleteTaskAction(taskId: string) {
  const user = await requireUser();
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id } });
  if (!task) return;

  // TaskAttachment rows cascade with the Task row (schema.prisma), but
  // that only drops the DB rows — the files on disk need their own
  // cleanup, best-effort same as deleteTaskAttachmentAction.
  const attachments = await prisma.taskAttachment.findMany({
    where: { taskId },
    select: { storedPath: true },
  });
  await Promise.all(
    attachments.map((a) =>
      unlink(path.join(process.cwd(), "public", "uploads", a.storedPath)).catch(() => {}),
    ),
  );

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

const DEFAULT_QUICK_EVENT_DURATION_MIN = 30;

/**
 * Quick-add for calendar events (#38) — same "c" quick-capture parser as
 * tasks, just materialized as an Event instead. A time with no explicit
 * duration ("for 30 min"/"for 1h") gets a 30-min default block; no
 * date/time at all falls back to starting now.
 */
export async function quickCaptureEvent(text: string) {
  const user = await requireUser();
  const parsed = parseQuickCapture(text);
  if (!parsed.title) return;

  const start = parsed.dueAt ?? new Date();
  const durationMin = parsed.durationMin ?? DEFAULT_QUICK_EVENT_DURATION_MIN;
  const end = new Date(start.getTime() + durationMin * 60_000);

  await prisma.event.create({
    data: { userId: user.id, title: parsed.title, start, end },
  });
  revalidatePath("/");
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

export async function createLabel(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const color = String(formData.get("color") ?? "zinc").trim() || "zinc";

  try {
    await prisma.label.create({ data: { userId: user.id, name, color } });
  } catch {
    // Unique constraint on (userId, name) — already have one by this name.
  }
  revalidatePath("/tasks");
}

export async function deleteLabel(labelId: string) {
  const user = await requireUser();
  await prisma.label.deleteMany({ where: { id: labelId, userId: user.id } });
  revalidatePath("/tasks");
}

export async function createCalendarShareAction(formData: FormData) {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const permission = formData.get("permission") === "FULL_DETAILS" ? "FULL_DETAILS" : "BUSY_ONLY";
  if (!email) return;

  const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  // Silently no-ops on a nonexistent email or sharing with yourself — no
  // error message either way, so this can't be used to enumerate which
  // emails have accounts on this instance.
  if (!target || target.id === user.id) return;

  await prisma.calendarShare.upsert({
    where: { ownerId_sharedWithId: { ownerId: user.id, sharedWithId: target.id } },
    create: { ownerId: user.id, sharedWithId: target.id, permission },
    update: { permission },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function deleteCalendarShareAction(shareId: string) {
  const user = await requireUser();
  // Scoped to ownerId — only the person who granted a share can revoke
  // it, not the recipient.
  await prisma.calendarShare.deleteMany({ where: { id: shareId, ownerId: user.id } });
  revalidatePath("/settings");
  revalidatePath("/");
}

// Recipient-only "show on my calendar" toggle — scoped to sharedWithId,
// not ownerId, since this doesn't touch the share grant itself, only
// whether *this* recipient currently wants it overlaid on their view.
export async function setCalendarShareHiddenAction(shareId: string, hidden: boolean) {
  const user = await requireUser();
  await prisma.calendarShare.updateMany({
    where: { id: shareId, sharedWithId: user.id },
    data: { hiddenByRecipient: hidden },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

const GROUP_MEETING_HORIZON_DAYS = 14;

export type GroupSlotResult =
  | { ok: true; startIso: string; endIso: string }
  | { ok: false; error: string };

/**
 * Only people who've shared their calendar with the requester can be
 * included — that single check both authorizes the request (can you see
 * this person's calendar at all) and guarantees busy-time actually
 * exists to intersect against, since sharing requires a real User
 * account (an Assignee that isn't also a User has no Events of its own).
 */
export async function findGroupMeetingSlotAction(
  participantUserIds: string[],
  durationMin: number,
): Promise<GroupSlotResult> {
  const user = await requireUser();
  const visibleShares = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id, ownerId: { in: participantUserIds } },
    select: { ownerId: true },
  });
  const visibleIds = new Set(visibleShares.map((s) => s.ownerId));
  const participants = participantUserIds.filter((id) => visibleIds.has(id));
  if (participants.length === 0) {
    return { ok: false, error: "Pick at least one person who's shared their calendar with you." };
  }

  const settings = await getAppSettings(user.id);
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + GROUP_MEETING_HORIZON_DAYS * 86_400_000);
  const slot = await findGroupSlot(
    [user.id, ...participants],
    durationMin,
    now,
    horizonEnd,
    settings.bufferMin,
  );
  if (!slot) {
    return { ok: false, error: "No open slot found for everyone in the next two weeks." };
  }
  return { ok: true, startIso: slot.start.toISOString(), endIso: slot.end.toISOString() };
}

/**
 * Creates the meeting as a locked event on the requester's own calendar
 * only (v1 scope — Event.userId is singular today, participants don't
 * get their own copy). Re-verifies visibility the same way
 * findGroupMeetingSlotAction did, since this is a separate call a client
 * could otherwise pass arbitrary ids to.
 */
export async function createGroupMeetingAction(
  participantUserIds: string[],
  title: string,
  startIso: string,
  endIso: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const trimmed = title.trim() || "Group meeting";
  const visibleShares = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id, ownerId: { in: participantUserIds } },
    include: { owner: { select: { name: true, email: true } } },
  });
  if (visibleShares.length === 0) return { ok: false };

  const names = visibleShares.map((s) => s.owner.name ?? s.owner.email).join(", ");
  await prisma.event.create({
    data: {
      userId: user.id,
      title: trimmed,
      start: new Date(startIso),
      end: new Date(endIso),
      locked: true,
      notes: `With: ${names}`,
      localDirty: true,
    },
  });
  revalidatePath("/");
  return { ok: true };
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
          hardDeadline: task.hardDeadline,
          color: task.color,
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

function allDayFromFormData(formData: FormData): boolean {
  return formData.get("allDay") === "on";
}

// "" (the EventModal <select>'s "None" option) -> no reminder at all.
function reminderMinutesFromFormData(formData: FormData): number | null {
  const raw = String(formData.get("reminderMinutes") ?? "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function notesFromFormData(formData: FormData): string | null {
  const raw = String(formData.get("notes") ?? "").trim();
  return raw || null;
}

// meetingUrl is rendered as a plain <a href> on the public /rsvp/[token]
// page (and MeetingBanner) — a "javascript:" value would execute on
// click for a guest who never signed in. <input type="url"> only
// enforces this client-side; the server action is the real boundary.
function meetingUrlFromFormData(formData: FormData): string | null {
  const raw = String(formData.get("meetingUrl") ?? "").trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

const EVENT_TYPES = ["DEFAULT", "OUT_OF_OFFICE", "FOCUS_TIME"] as const;

function eventTypeFromFormData(formData: FormData): (typeof EVENT_TYPES)[number] {
  const raw = String(formData.get("eventType") ?? "DEFAULT");
  return (EVENT_TYPES as readonly string[]).includes(raw)
    ? (raw as (typeof EVENT_TYPES)[number])
    : "DEFAULT";
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
  const meetingUrl = meetingUrlFromFormData(formData);
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
      notes: notesFromFormData(formData),
      locked: lockedFromFormData(formData),
      eventType: eventTypeFromFormData(formData),
      allDay: allDayFromFormData(formData),
      reminderMinutes: reminderMinutesFromFormData(formData),
      localDirty: true,
    },
  });
  if (!recurrenceRule) {
    await rescheduleConflictsWith(user.id, start, end);
    await rescheduleConflictedHabits(user.id, start, end);
  }
  revalidatePath("/");
}

/**
 * `originalOccurrenceStartIso`, when given, is the *displayed occurrence's*
 * pre-edit start (not necessarily the master row's own `start` — could be
 * any later occurrence someone opened and picked "All events" on). Without
 * it, saving whatever occurrence happened to be open would silently drag
 * the whole series' anchor date to that occurrence's date even if the user
 * only retitled it — every earlier occurrence vanishes, since rrule
 * expands forward from `start`. Passing it lets the series shift by the
 * same delta the user actually made (0 if they didn't touch the time),
 * preserving the series' real anchor otherwise.
 */
export async function updateEvent(
  eventId: string,
  formData: FormData,
  originalOccurrenceStartIso?: string,
) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  const formStart = new Date(startRaw);
  const formEnd = new Date(endRaw);
  const recurrenceRule = recurrenceRuleFromFormData(formData);
  const meetingUrl = meetingUrlFromFormData(formData);
  const color = String(formData.get("color") ?? "").trim() || null;

  let start = formStart;
  let end = formEnd;
  const originalOccurrenceStart = originalOccurrenceStartIso
    ? new Date(originalOccurrenceStartIso)
    : null;
  if (originalOccurrenceStart && !Number.isNaN(originalOccurrenceStart.getTime())) {
    const existing = await prisma.event.findFirst({
      where: { id: eventId, userId: user.id, recurrenceRule: { not: null } },
      select: { start: true },
    });
    if (existing) {
      const deltaMs = formStart.getTime() - originalOccurrenceStart.getTime();
      const durationMs = formEnd.getTime() - formStart.getTime();
      start = new Date(existing.start.getTime() + deltaMs);
      end = new Date(start.getTime() + durationMs);
    }
  }

  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId: user.id },
    data: {
      title,
      start,
      end,
      recurrenceRule,
      meetingUrl,
      color,
      notes: notesFromFormData(formData),
      locked: lockedFromFormData(formData),
      eventType: eventTypeFromFormData(formData),
      allDay: allDayFromFormData(formData),
      reminderMinutes: reminderMinutesFromFormData(formData),
      localDirty: true,
    },
  });
  if (count > 0 && !recurrenceRule) {
    await rescheduleConflictsWith(user.id, start, end, eventId);
    await rescheduleConflictedHabits(user.id, start, end, eventId);
  }
  revalidatePath("/");
}

// Normalizes through Date so a malformed/comma-bearing client-supplied
// value can't corrupt the stored comma-joined list (a raw "a,b" would
// otherwise inject a second, garbage exclusion entry) or fail as
// Invalid Date deeper in recurrence.ts. Returns null for input that
// isn't a real date at all — callers treat that as "nothing to exclude."
function normalizeExcludedStart(startIso: string): string | null {
  const time = new Date(startIso).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function withExcludedStart(excludeDates: string | null, startIso: string): string | null {
  const normalized = normalizeExcludedStart(startIso);
  if (!normalized) return excludeDates;
  const existing = excludeDates ? excludeDates.split(",").filter(Boolean) : [];
  if (existing.includes(normalized)) return excludeDates;
  return [...existing, normalized].join(",");
}

/**
 * Recurring event exceptions (#40) — "edit just this occurrence" of a
 * recurring series. Creates a plain one-off Event with the form's
 * values (no recurrenceRule of its own — editable/deletable afterward
 * through the normal single-event flow, same as any other event) and
 * marks `originalStartIso` excluded on the master so the raw recurring
 * occurrence at that slot stops appearing (recurrence.ts filters it
 * centrally, so every caller benefits with no other code changes).
 */
export async function updateEventOccurrence(
  masterId: string,
  originalStartIso: string,
  formData: FormData,
) {
  const user = await requireUser();
  const normalizedOriginalStart = normalizeExcludedStart(originalStartIso);
  if (!normalizedOriginalStart) return;
  const master = await prisma.event.findFirst({
    where: { id: masterId, userId: user.id, recurrenceRule: { not: null } },
  });
  if (!master) return;

  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  const meetingUrl = meetingUrlFromFormData(formData);
  const color = String(formData.get("color") ?? "").trim() || null;

  await prisma.$transaction([
    prisma.event.create({
      data: {
        userId: user.id,
        title,
        start,
        end,
        meetingUrl,
        color,
        notes: notesFromFormData(formData),
        locked: lockedFromFormData(formData),
        eventType: eventTypeFromFormData(formData),
        allDay: allDayFromFormData(formData),
        reminderMinutes: reminderMinutesFromFormData(formData),
        recurrenceExceptionOfId: masterId,
        recurrenceOriginalStart: new Date(normalizedOriginalStart),
        localDirty: true,
      },
    }),
    prisma.event.update({
      where: { id: masterId },
      data: { excludeDates: withExcludedStart(master.excludeDates, normalizedOriginalStart) },
    }),
  ]);

  revalidatePath("/");
}

/** Delete just one occurrence of a recurring series — a pure EXDATE, no override row. */
export async function deleteEventOccurrence(masterId: string, originalStartIso: string) {
  const user = await requireUser();
  const normalizedOriginalStart = normalizeExcludedStart(originalStartIso);
  if (!normalizedOriginalStart) return;
  const master = await prisma.event.findFirst({
    where: { id: masterId, userId: user.id, recurrenceRule: { not: null } },
  });
  if (!master) return;

  await prisma.event.update({
    where: { id: masterId },
    data: { excludeDates: withExcludedStart(master.excludeDates, normalizedOriginalStart) },
  });
  revalidatePath("/");
}

const MAX_GUESTS_PER_EVENT = 50;

/**
 * Event guests + RSVP (#34) — invite by email, no account required.
 * Identity is the invite email + a random respond token (checked at
 * /rsvp/[token], no auth) rather than a userId, since the whole point
 * is inviting people who don't have an account here. Re-inviting the
 * same email just re-sends without creating a second row (@@unique).
 */
export async function addEventGuestAction(eventId: string, email: string) {
  const user = await requireUser();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) return { ok: false as const, error: "Invalid email." };

  const event = await prisma.event.findFirst({ where: { id: eventId, userId: user.id } });
  if (!event) return { ok: false as const, error: "Event not found." };

  const guestCount = await prisma.eventGuest.count({ where: { eventId } });
  if (guestCount >= MAX_GUESTS_PER_EVENT) {
    return { ok: false as const, error: `Limit of ${MAX_GUESTS_PER_EVENT} guests per event.` };
  }

  const guest = await prisma.eventGuest.upsert({
    where: { eventId_email: { eventId, email: trimmedEmail } },
    create: { eventId, email: trimmedEmail, respondToken: randomBytes(24).toString("hex") },
    update: {},
  });

  if (isEmailConfigured()) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const rsvpUrl = `${appUrl}/rsvp/${guest.respondToken}`;
    const when = `${event.start.toLocaleString()} - ${event.end.toLocaleTimeString()}`;
    await sendEmail(
      trimmedEmail,
      `You're invited: ${event.title}`,
      `You've been invited to "${event.title}" (${when}).\n\nRespond: ${rsvpUrl}`,
    );
  }

  revalidatePath("/");
  return { ok: true as const, emailSent: isEmailConfigured() };
}

export async function getEventGuestsAction(eventId: string) {
  const user = await requireUser();
  const event = await prisma.event.findFirst({ where: { id: eventId, userId: user.id } });
  if (!event) return [];
  return prisma.eventGuest.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, status: true },
  });
}

export async function removeEventGuestAction(guestId: string) {
  const user = await requireUser();
  await prisma.eventGuest.deleteMany({
    where: { id: guestId, event: { userId: user.id } },
  });
  revalidatePath("/");
}

/** Public — no auth. The respond token itself is the guest's credential. */
export async function respondToInviteAction(
  token: string,
  status: "ACCEPTED" | "DECLINED" | "TENTATIVE",
) {
  const { count } = await prisma.eventGuest.updateMany({
    where: { respondToken: token },
    data: { status, respondedAt: new Date() },
  });
  return count > 0;
}

export async function getInviteAction(token: string) {
  const guest = await prisma.eventGuest.findUnique({
    where: { respondToken: token },
    include: { event: { select: { title: true, start: true, end: true, meetingUrl: true } } },
  });
  if (!guest) return null;
  return {
    email: guest.email,
    status: guest.status,
    eventTitle: guest.event.title,
    eventStart: guest.event.start,
    eventEnd: guest.event.end,
    meetingUrl: guest.event.meetingUrl,
  };
}

export async function moveEvent(eventId: string, startIso: string, endIso: string) {
  const user = await requireUser();
  const start = new Date(startIso);
  const end = new Date(endIso);
  // A manual drag or resize is the user's own explicit placement — lock
  // it so the scheduler doesn't undo it on the next pass. `locked` only
  // blocks the *scheduler*, not further manual drags (see EventBlock),
  // and the Locked toggle in the edit modal can always turn it back off.
  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId: user.id },
    data: { start, end, locked: true, localDirty: true },
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

/**
 * Drag-to-create's "Event" branch (QuickCreatePopup) — a manually placed
 * block is exactly what Locked already means, so it starts locked, same
 * as a manual drag/resize of an existing event (see moveEvent). Returns
 * the new event's id so the popup can hand off straight into the full
 * EventModal for further detail.
 */
export async function createQuickEventAction(
  title: string,
  startIso: string,
  endIso: string,
): Promise<string | null> {
  const user = await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);

  const event = await prisma.event.create({
    data: { userId: user.id, title: trimmed, start, end, locked: true, localDirty: true },
  });
  await rescheduleConflictsWith(user.id, start, end, event.id);
  await rescheduleConflictedHabits(user.id, start, end, event.id);
  revalidatePath("/");
  return event.id;
}

/**
 * Drag-to-create's "Task" branch — a real Task row (shows up on /tasks
 * like any other) plus a locked Event pinning it to exactly the dragged
 * slot, same two-row shape scheduleTask() creates when the auto-
 * scheduler places a task, just skipping slot search since the user
 * already picked the slot.
 */
export async function createQuickTaskAction(
  title: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const user = await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));

  const task = await prisma.task.create({
    data: { userId: user.id, title: trimmed, durationMin },
  });
  const event = await prisma.event.create({
    data: { userId: user.id, title: trimmed, start, end, taskId: task.id, locked: true, localDirty: true },
  });
  await rescheduleConflictsWith(user.id, start, end, event.id);
  await rescheduleConflictedHabits(user.id, start, end, event.id);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function syncGoogleCalendarAction() {
  const user = await requireUser();
  const result = await syncGoogleCalendar(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return result;
}

// Google sync previously only ran when someone remembered to click
// "Sync" in Settings — a real gap (the whole point of connecting Google
// is that changes there show up here without a manual step). Polled by
// SyncWatcher.tsx from every page instead, gated by this interval
// so it isn't hammering the Google API on every poll tick.
const GOOGLE_AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export async function syncGoogleCalendarIfDueAction(): Promise<{ synced: boolean }> {
  const user = await requireUser();
  const account = await prisma.googleAccount.findUnique({ where: { userId: user.id } });
  if (!account) return { synced: false };
  const due =
    !account.lastSyncedAt ||
    Date.now() - account.lastSyncedAt.getTime() > GOOGLE_AUTO_SYNC_INTERVAL_MS;
  if (!due) return { synced: false };

  await syncGoogleCalendar(user.id);
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/settings");
  return { synced: true };
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

const MAX_SUBSCRIPTION_NAME_LEN = 100;

export async function addCalendarSubscriptionAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, MAX_SUBSCRIPTION_NAME_LEN);
  const url = String(formData.get("url") ?? "").trim();
  if (!name || !/^https?:\/\//i.test(url)) return;

  const subscription = await prisma.calendarSubscription.create({
    data: { userId: user.id, name, url },
  });
  await syncCalendarSubscription(subscription.id, user.id);
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function syncCalendarSubscriptionAction(subscriptionId: string) {
  const user = await requireUser();
  const result = await syncCalendarSubscription(subscriptionId, user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return result;
}

export async function deleteCalendarSubscriptionAction(subscriptionId: string) {
  const user = await requireUser();
  await prisma.calendarSubscription.deleteMany({
    where: { id: subscriptionId, userId: user.id },
  });
  revalidatePath("/");
  revalidatePath("/settings");
}

const SUBSCRIPTION_AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Same "poll from the client, self-throttle server-side" shape as
 * syncGoogleCalendarIfDueAction — an ICS subscription changes far less
 * often than a live Google Calendar, so a much longer interval.
 */
export async function syncCalendarSubscriptionsIfDueAction(): Promise<{ synced: boolean }> {
  const user = await requireUser();
  const due = await prisma.calendarSubscription.findMany({
    where: {
      userId: user.id,
      OR: [
        { lastFetchedAt: null },
        { lastFetchedAt: { lt: new Date(Date.now() - SUBSCRIPTION_AUTO_SYNC_INTERVAL_MS) } },
      ],
    },
  });
  if (due.length === 0) return { synced: false };

  for (const sub of due) {
    await syncCalendarSubscription(sub.id, user.id);
  }
  revalidatePath("/");
  return { synced: true };
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

  const timeInputToMinutes = (raw: FormDataEntryValue | null) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? ""));
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const workDays = formData.getAll("workDays").map(String).join(",");
  const workStartMin = timeInputToMinutes(formData.get("workStartMin"));
  const workEndMin = timeInputToMinutes(formData.get("workEndMin"));
  if (
    !workDays ||
    !Number.isFinite(workStartMin) ||
    !Number.isFinite(workEndMin) ||
    workStartMin < 0 ||
    workEndMin > 1440 ||
    workStartMin >= workEndMin
  ) {
    return;
  }

  const secondaryTimezone = String(formData.get("secondaryTimezone") ?? "").trim() || null;
  if (secondaryTimezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: secondaryTimezone });
    } catch {
      return;
    }
  }

  await updateAppSettings(user.id, {
    bufferMin,
    dailyCapMin,
    workDays,
    workStartMin,
    workEndMin,
    secondaryTimezone,
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect (#46) — called once by TimezoneSync.tsx on mount with the
 * browser's own `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 * Never overwrites an already-set value: it might be a deliberate manual
 * override from Settings, not just an earlier auto-detect run.
 */
export async function syncUserTimezoneAction(timezone: string): Promise<void> {
  const user = await requireUser();
  if (user.timezone || !isValidTimeZone(timezone)) return;
  await prisma.user.update({ where: { id: user.id }, data: { timezone } });
}

/** Manual override from Settings — always wins, even over a later auto-detect. */
export async function setUserTimezoneAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!timezone || !isValidTimeZone(timezone)) return;
  await prisma.user.update({ where: { id: user.id }, data: { timezone } });
  revalidatePath("/settings");
}

// Secret fields (localAiApiKey, anthropicApiKey) are never redisplayed
// once saved — the form just shows "a key is saved" — so a blank
// submission means "leave it as-is," not "clear it." An explicit
// "Clear ... key" checkbox is the only way to actually remove one.
function updatedSecret(
  formData: FormData,
  fieldName: string,
  clearFieldName: string,
): string | null | undefined {
  if (formData.get(clearFieldName) === "on") return null;
  const raw = String(formData.get(fieldName) ?? "").trim();
  return raw ? encryptSecret(raw) : undefined;
}

export async function updateAiSettingsAction(formData: FormData) {
  const user = await requireUser();
  const localAiUrl = String(formData.get("localAiUrl") ?? "").trim() || null;
  const localAiModel = String(formData.get("localAiModel") ?? "").trim() || null;
  await updateAppSettings(user.id, {
    localAiUrl,
    localAiModel,
    localAiApiKey: updatedSecret(formData, "localAiApiKey", "clearLocalAiApiKey"),
    anthropicApiKey: updatedSecret(formData, "anthropicApiKey", "clearAnthropicApiKey"),
  });
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
  const excludeDays = String(formData.get("excludeDays") ?? "").trim() || null;
  return { title, durationMin, slug, excludeDays };
}

export async function createBookingLinkAction(formData: FormData) {
  const user = await requireUser();
  const { title, durationMin, slug, excludeDays } = parseBookingLinkForm(formData);
  if (!slug || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 240) return;

  try {
    await prisma.bookingLink.create({
      data: { userId: user.id, slug, title, durationMin, excludeDays, enabled: true },
    });
  } catch {
    // Unique constraint on slug — already taken (by this user or another).
  }
  revalidatePath("/settings");
}

export async function updateBookingLinkAction(linkId: string, formData: FormData) {
  const user = await requireUser();
  const { title, durationMin, slug, excludeDays } = parseBookingLinkForm(formData);
  if (!slug || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 240) return;

  try {
    await prisma.bookingLink.updateMany({
      where: { id: linkId, userId: user.id },
      data: { title, durationMin, slug, excludeDays },
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

const SEARCH_RESULT_LIMIT = 10;

/**
 * Title-substring search across a user's own events, for the calendar
 * header's search box (#39) — jumps straight to a match the same way a
 * notification click already does, via CalendarClient's `?edit=<id>`
 * modal-open mechanism, so no new "jump to event" plumbing was needed.
 * Matches a recurring series' one stored row (its first occurrence), not
 * a specific future occurrence.
 */
export async function searchEventsAction(query: string) {
  const user = await requireUser();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const events = await prisma.event.findMany({
    where: { userId: user.id, title: { contains: trimmed } },
    orderBy: { start: "asc" },
    take: SEARCH_RESULT_LIMIT,
    select: { id: true, title: true, start: true },
  });

  return events.map((e) => ({ id: e.id, title: e.title, startYMD: formatYMD(e.start) }));
}

const MAX_ICS_IMPORT_EVENTS = 1000;
const MAX_ICS_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * ICS import (#33) — creates a plain one-off (or, if the file's VEVENT
 * carries an RRULE, recurring) Event per parsed entry. Not a two-way
 * sync like Google/Apple — imported rows are ordinary LOCAL events the
 * user can edit or delete like anything else.
 */
export async function importIcsAction(
  formData: FormData,
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_ICS_IMPORT_BYTES) {
    return { ok: false, error: "File is too large (5MB max)." };
  }

  let parsed;
  try {
    const { parseIcsEvents } = await import("@/lib/ics");
    parsed = parseIcsEvents(await file.text());
  } catch {
    return { ok: false, error: "Couldn't parse that file — is it a valid .ics?" };
  }
  if (parsed.length === 0) {
    return { ok: false, error: "No events found in that file." };
  }

  const toImport = parsed.slice(0, MAX_ICS_IMPORT_EVENTS);
  await prisma.event.createMany({
    data: toImport.map((e) => ({
      userId: user.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      recurrenceRule: e.recurrenceRule,
      notes: e.notes,
      excludeDates: e.excludeDates,
    })),
  });

  revalidatePath("/");
  return { ok: true, imported: toImport.length };
}
