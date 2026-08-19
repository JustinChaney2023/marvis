"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { parseYMD } from "@/lib/calendar-dates";
import { getAppSettings } from "@/lib/settings";
import { extractSyllabusDates, type ExtractSyllabusResult } from "@/lib/syllabusExtract";

export async function extractSyllabusDatesAction(
  text: string,
  termStartDateYMD: string | null,
): Promise<ExtractSyllabusResult> {
  const user = await requireUser();
  const termStartDate = termStartDateYMD ? parseYMD(termStartDateYMD) : null;
  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  return extractSyllabusDates(text, new Date(), termStartDate, localAi);
}

export type SyllabusTaskInput = {
  title: string;
  dueDateYMD: string | null;
};

/**
 * Bulk-creates tasks from reviewed/edited syllabus extraction rows. Due
 * dates are set to end-of-day (23:59) local time — a syllabus date is a
 * day, not a specific clock time, and the task list/scheduler both
 * already handle a dueAt with any time-of-day fine.
 */
export async function importSyllabusTasksAction(
  items: SyllabusTaskInput[],
  projectId: string | null,
  assigneeId: string | null,
): Promise<{ created: number }> {
  const user = await requireUser();
  const rows = items.filter((i) => i.title.trim());
  if (rows.length === 0) return { created: 0 };

  await prisma.task.createMany({
    data: rows.map((item) => {
      const dueAt = item.dueDateYMD ? parseYMD(item.dueDateYMD) : null;
      if (dueAt) dueAt.setHours(23, 59, 0, 0);
      return {
        userId: user.id,
        title: item.title.trim(),
        dueAt,
        projectId,
        assigneeId,
      };
    }),
  });

  revalidatePath("/tasks");
  return { created: rows.length };
}
