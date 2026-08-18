"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { scheduleAllPendingTasks, scheduleTask, unscheduleTask } from "@/lib/scheduler";
import { parseQuickCapture } from "@/lib/quickCapture";
import { expandEvents } from "@/lib/recurrence";

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
  const projectId = String(formData.get("projectId") ?? "").trim() || null;

  await prisma.task.create({
    data: {
      title,
      priority,
      durationMin,
      energy: energyFromFormData(formData),
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
      projectId,
    },
  });

  revalidatePath("/");
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
  revalidatePath("/");
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const color = String(formData.get("color") ?? "zinc").trim() || "zinc";

  await prisma.project.create({ data: { name, color } });
  revalidatePath("/");
}

export async function deleteProject(projectId: string) {
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/");
}

export async function toggleTaskDone(taskId: string, done: boolean) {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: done ? "DONE" : "TODO" },
  });
  revalidatePath("/");
  revalidatePath("/calendar");
}

export async function scheduleTaskAction(taskId: string) {
  await scheduleTask(taskId);
  revalidatePath("/");
  revalidatePath("/calendar");
}

export async function unscheduleTaskAction(taskId: string) {
  await unscheduleTask(taskId);
  revalidatePath("/");
  revalidatePath("/calendar");
}

export async function scheduleAllAction() {
  await scheduleAllPendingTasks();
  revalidatePath("/");
  revalidatePath("/calendar");
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
  revalidatePath("/calendar");
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
  revalidatePath("/calendar");
}

export async function moveEvent(eventId: string, startIso: string, endIso: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { start: new Date(startIso), end: new Date(endIso) },
  });
  revalidatePath("/calendar");
}

export async function deleteEvent(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  await prisma.event.delete({ where: { id: eventId } });
  if (event?.taskId) {
    await prisma.task.update({
      where: { id: event.taskId },
      data: { status: "TODO" },
    });
  }
  revalidatePath("/calendar");
  revalidatePath("/");
}
