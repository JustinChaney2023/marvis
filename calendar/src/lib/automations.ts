import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { generateSubtasks } from "@/lib/subtaskGenerate";
import { generateEmailDraft } from "@/lib/emailDraft";
import type { TaskStatus } from "@prisma/client";

/**
 * Fires every enabled rule matching this status transition (optionally
 * scoped to the task's project). One rule failing (a bad AI call, a
 * deleted project) is logged and skipped rather than blocking the
 * status change itself — automations are a side effect of the change,
 * never a gate on whether it's allowed to happen.
 */
export async function runAutomationsForStatusChange(
  userId: string,
  taskId: string,
  newStatus: TaskStatus,
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: { project: true, subtasks: true },
  });
  if (!task) return;

  const rules = await prisma.automationRule.findMany({
    where: {
      userId,
      enabled: true,
      triggerStatus: newStatus,
      OR: [{ projectId: null }, { projectId: task.projectId }],
    },
  });
  if (rules.length === 0) return;

  const settings = await getAppSettings(userId);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;

  for (const rule of rules) {
    try {
      switch (rule.action) {
        case "NOTIFY":
          await prisma.automationNotification.create({
            data: { userId, message: `"${task.title}" is now ${newStatus.toLowerCase()}` },
          });
          break;
        case "GENERATE_SUBTASKS": {
          if (task.subtasks.length > 0) break; // don't pile on top of existing ones
          const result = await generateSubtasks(task.title, task.notes, task.project?.name ?? null, localAi);
          if (result.ok && result.subtasks.length > 0) {
            await prisma.task.createMany({
              data: result.subtasks.map((title) => ({ userId, parentId: task.id, title })),
            });
          }
          break;
        }
        case "DRAFT_EMAIL": {
          const result = await generateEmailDraft(task.title, task.notes, task.project?.name ?? null, task.dueAt, localAi);
          if (result.ok) {
            await prisma.automationNotification.create({
              data: {
                userId,
                message: `Drafted email for "${task.title}"\n\nSubject: ${result.draft.subject}\n\n${result.draft.body}`,
              },
            });
          }
          break;
        }
        case "SET_PRIORITY_URGENT":
          await prisma.task.update({ where: { id: task.id }, data: { priority: 3 } });
          break;
      }
    } catch (err) {
      console.error(`runAutomationsForStatusChange: rule ${rule.id} failed:`, err);
    }
  }
}
