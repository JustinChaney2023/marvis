"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { scheduleAllPendingTasks, scheduleTask, unscheduleTask } from "@/lib/scheduler";

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const priority = Number(formData.get("priority") ?? 0);
  const durationMin = Number(formData.get("durationMin") ?? 30);
  const dueAtRaw = String(formData.get("dueAt") ?? "");

  await prisma.task.create({
    data: {
      title,
      priority,
      durationMin,
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
    },
  });

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

export async function createEvent(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const startRaw = String(formData.get("start") ?? "");
  const endRaw = String(formData.get("end") ?? "");
  if (!title || !startRaw || !endRaw) return;

  await prisma.event.create({
    data: { title, start: new Date(startRaw), end: new Date(endRaw) },
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
