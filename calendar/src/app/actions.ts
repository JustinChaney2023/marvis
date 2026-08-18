"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

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
}
