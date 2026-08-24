"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { generateProjectPlan, type GenerateProjectResult } from "@/lib/projectGenerate";

export async function generateProjectPlanAction(prompt: string): Promise<GenerateProjectResult> {
  const user = await requireUser();
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return generateProjectPlan(prompt, localAi, anthropicApiKey);
}

export type GeneratedTaskInput = { title: string; notes: string | null };

/**
 * Creates a new Project (color defaults to indigo, same as the manual
 * "+ Project" form) plus its reviewed task breakdown in one go — the
 * reviewed rows have already had unchecked/edited items applied
 * client-side, same "review then commit" contract as syllabus import.
 */
export async function createProjectFromPlanAction(
  projectName: string,
  tasks: GeneratedTaskInput[],
  assigneeId: string | null,
): Promise<{ created: number }> {
  const user = await requireUser();
  const name = projectName.trim();
  const rows = tasks.filter((t) => t.title.trim());
  if (!name || rows.length === 0) return { created: 0 };

  // assigneeId is client-submitted — verify it's this user's own row
  // before attaching (same reasoning as taskFieldsFromFormData in
  // actions.ts). projectId isn't checked since it's the row just created
  // above, not a client-supplied id.
  const ownedAssignee = assigneeId
    ? await prisma.assignee.findFirst({ where: { id: assigneeId, userId: user.id }, select: { id: true } })
    : null;
  const verifiedAssigneeId = ownedAssignee ? assigneeId : null;

  const project = await prisma.project.create({
    data: { userId: user.id, name, color: "indigo" },
  });
  await prisma.task.createMany({
    data: rows.map((t) => ({
      userId: user.id,
      title: t.title.trim(),
      notes: t.notes?.trim() || null,
      projectId: project.id,
      assigneeId: verifiedAssigneeId,
    })),
  });

  revalidatePath("/tasks");
  return { created: rows.length };
}
