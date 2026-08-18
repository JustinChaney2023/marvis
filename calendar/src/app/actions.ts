"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { scheduleAllPendingTasks, scheduleTask, unscheduleTask } from "@/lib/scheduler";
import { parseQuickCapture } from "@/lib/quickCapture";
import { expandEvents } from "@/lib/recurrence";
import { syncGoogleCalendar, deleteFromGoogle } from "@/lib/google-sync";
import { updateAppSettings } from "@/lib/settings";
import { createBooking } from "@/lib/booking";
import { nextTaskOccurrence } from "@/lib/taskRecurrence";

const REMINDER_WINDOW_MIN = 15;

/**
 * Occurrences (recurring included) starting within the next
 * REMINDER_WINDOW_MIN minutes, for the client-side notification watcher.
 * Read-only, no "already notified" tracking here — that's session-local
 * client state, since it only needs to matter while a tab is open.
 */
export async function getUpcomingEventReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60_000);
  const rows = await prisma.event.findMany({
    where: {
      OR: [{ start: { gte: now, lt: soon } }, { recurrenceRule: { not: null } }],
    },
  });
  return expandEvents(rows, now, soon).map((o) => ({
    id: o.id,
    title: o.title,
    startIso: o.start.toISOString(),
  }));
}

function energyFromFormData(formData: FormData): "LOW" | "MEDIUM" | "HIGH" {
  const value = String(formData.get("energy") ?? "MEDIUM");
  return value === "LOW" || value === "HIGH" ? value : "MEDIUM";
}

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const priority = Number(formData.get("priority") ?? 0);
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
  const projectId = String(formData.get("projectId") ?? "").trim() || null;
  // A recurrence rule with no due date has nothing to anchor to (no
  // DTSTART equivalent) — silently drop it rather than create a task
  // that can never compute a next occurrence.
  const recurrenceRule = dueAt
    ? String(formData.get("recurrenceRule") ?? "").trim() || null
    : null;

  await prisma.task.create({
    data: {
      title,
      priority,
      durationMin,
      energy: energyFromFormData(formData),
      dueAt,
      projectId,
      recurrenceRule,
    },
  });

  // Remembered so the add-task form defaults to your last-used project
  // instead of "No project" every time — re-picking the same course/
  // client/project on every single task was a specifically-named
  // friction point in Motion user feedback.
  const cookieStore = await cookies();
  if (projectId) {
    cookieStore.set("lastProjectId", projectId, { maxAge: 60 * 60 * 24 * 365 });
  } else {
    cookieStore.delete("lastProjectId");
  }

  revalidatePath("/tasks");
}

export async function quickCaptureTask(text: string) {
  const parsed = parseQuickCapture(text);
  if (!parsed.title) return;

  await prisma.task.create({
    data: {
      title: parsed.title,
      priority: parsed.priority,
      dueAt: parsed.dueAt,
    },
  });
  revalidatePath("/tasks");
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const color = String(formData.get("color") ?? "zinc").trim() || "zinc";

  await prisma.project.create({ data: { name, color } });
  revalidatePath("/tasks");
}

export async function deleteProject(projectId: string) {
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/tasks");
}

export async function toggleTaskDone(taskId: string, done: boolean) {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: done ? "DONE" : "TODO" },
  });

  // Recurring tasks aren't expanded like recurring events — completing one
  // materializes the next occurrence as a new row, since a task carries
  // per-instance state (status, its own scheduled event) that doesn't fit
  // the "compute on the fly" model.
  if (done && task.recurrenceRule && task.dueAt) {
    const nextDueAt = nextTaskOccurrence(task.recurrenceRule, task.dueAt);
    if (nextDueAt) {
      await prisma.task.create({
        data: {
          title: task.title,
          notes: task.notes,
          priority: task.priority,
          energy: task.energy,
          durationMin: task.durationMin,
          dueAt: nextDueAt,
          projectId: task.projectId,
          recurrenceRule: task.recurrenceRule,
        },
      });
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function scheduleTaskAction(taskId: string) {
  await scheduleTask(taskId);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function unscheduleTaskAction(taskId: string) {
  await unscheduleTask(taskId);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function scheduleAllAction() {
  await scheduleAllPendingTasks();
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

export async function createEvent(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  await prisma.event.create({
    data: {
      title,
      start: new Date(startRaw),
      end: new Date(endRaw),
      recurrenceRule: recurrenceRuleFromFormData(formData),
      locked: lockedFromFormData(formData),
    },
  });
  revalidatePath("/");
}

export async function updateEvent(eventId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  await prisma.event.update({
    where: { id: eventId },
    data: {
      title,
      start: new Date(startRaw),
      end: new Date(endRaw),
      recurrenceRule: recurrenceRuleFromFormData(formData),
      locked: lockedFromFormData(formData),
    },
  });
  revalidatePath("/");
}

export async function moveEvent(eventId: string, startIso: string, endIso: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { start: new Date(startIso), end: new Date(endIso) },
  });
  revalidatePath("/");
}

export async function deleteEvent(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (event?.googleEventId) {
    await deleteFromGoogle(event.googleEventId);
  }
  await prisma.event.delete({ where: { id: eventId } });
  if (event?.taskId) {
    await prisma.task.update({
      where: { id: event.taskId },
      data: { status: "TODO" },
    });
  }
  revalidatePath("/");
  revalidatePath("/tasks");
}

export async function syncGoogleCalendarAction() {
  const result = await syncGoogleCalendar();
  revalidatePath("/");
  revalidatePath("/settings");
  return result;
}

export async function disconnectGoogleAction() {
  await prisma.googleAccount.deleteMany({});
  revalidatePath("/settings");
}

export async function updateSchedulingSettingsAction(formData: FormData) {
  const bufferMin = Number(formData.get("bufferMin") ?? 10);
  if (!Number.isFinite(bufferMin) || bufferMin < 0 || bufferMin > 120) return;
  await updateAppSettings({ bufferMin });
  revalidatePath("/settings");
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function updateBookingSettingsAction(formData: FormData) {
  const bookingEnabled = formData.get("bookingEnabled") === "on";
  const bookingTitle = String(formData.get("bookingTitle") ?? "").trim() || "Book time with me";
  const bookingDurationMin = Number(formData.get("bookingDurationMin") ?? 30);
  const rawSlug = String(formData.get("bookingSlug") ?? "").trim();
  const bookingSlug = rawSlug ? slugify(rawSlug) : null;

  if (!Number.isFinite(bookingDurationMin) || bookingDurationMin < 5 || bookingDurationMin > 240) {
    return;
  }
  if (bookingEnabled && !bookingSlug) return;

  try {
    await updateAppSettings({
      bookingEnabled,
      bookingTitle,
      bookingDurationMin,
      bookingSlug,
    });
  } catch {
    // Unique constraint on bookingSlug — since it's a single row this can
    // only happen if the exact same slug is already set, which is a no-op
    // anyway, but guard rather than let a raw Prisma error surface.
  }
  revalidatePath("/settings");
}

// Public, unauthenticated endpoint — cheap in-memory rate limit per IP so
// a trivial script can't spam bookings or flood the owner's synced Google
// Calendar. Doesn't survive a restart and won't stop a determined
// attacker rotating IPs, but stops the cheap case, which is the realistic
// threat for a personal app's booking link.
const BOOKING_RATE_LIMIT = 5;
const BOOKING_RATE_WINDOW_MS = 60 * 60 * 1000;
const bookingAttempts = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = (bookingAttempts.get(ip) ?? []).filter(
    (t) => now - t < BOOKING_RATE_WINDOW_MS,
  );
  if (attempts.length >= BOOKING_RATE_LIMIT) {
    bookingAttempts.set(ip, attempts);
    return true;
  }
  attempts.push(now);
  bookingAttempts.set(ip, attempts);
  return false;
}

export async function createBookingAction(startIso: string, formData: FormData) {
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0].trim() ??
    headerStore.get("x-real-ip") ??
    "unknown";
  if (isRateLimited(ip)) {
    return { ok: false as const, error: "Too many attempts — please try again later." };
  }

  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const result = await createBooking(startIso, name, email, notes);
  if (result.ok) {
    revalidatePath("/");
  }
  return result;
}

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword || password !== appPassword) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=1`);
  }

  const cookieStore = await cookies();
  cookieStore.set("marvis_auth", appPassword, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next || "/");
}
