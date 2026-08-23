"use server";

import mammoth from "mammoth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { parseYMD } from "@/lib/calendar-dates";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { extractSyllabusDates, type ExtractSyllabusResult } from "@/lib/syllabusExtract";

const MAX_DOCX_BYTES = 10 * 1024 * 1024;

/**
 * .docx is a zip of XML, not readable via the client-side FileReader
 * path .txt/.md use — extracted server-side instead. mammoth reads only
 * the document body text (no headers/footers/embedded objects), which
 * is exactly what the AI extraction step below wants: plain prose, not
 * markup.
 */
export async function extractDocxTextAction(
  formData: FormData,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (file.size === 0 || file.size > MAX_DOCX_BYTES) {
    return { ok: false, error: "File must be under 10MB." };
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return { ok: false, error: "Only .docx files are supported here — for a legacy .doc or PDF, open it and paste the text instead." };
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    if (!value.trim()) return { ok: false, error: "Couldn't find any text in that file." };
    return { ok: true, text: value };
  } catch {
    return { ok: false, error: "Couldn't read that .docx file — it may be corrupted." };
  }
}

export async function extractSyllabusDatesAction(
  text: string,
  termStartDateYMD: string | null,
): Promise<ExtractSyllabusResult> {
  const user = await requireUser();
  const termStartDate = termStartDateYMD ? parseYMD(termStartDateYMD) : null;
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  return extractSyllabusDates(text, new Date(), termStartDate, localAi, anthropicApiKey);
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

  // projectId/assigneeId are client-submitted — verify they're actually
  // this user's own rows before attaching, same reasoning as
  // taskFieldsFromFormData in actions.ts (an unverified id would leak
  // another user's project/assignee name via this task's own display).
  const [ownedProject, ownedAssignee] = await Promise.all([
    projectId ? prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } }) : null,
    assigneeId ? prisma.assignee.findFirst({ where: { id: assigneeId, userId: user.id }, select: { id: true } }) : null,
  ]);
  const verifiedProjectId = ownedProject ? projectId : null;
  const verifiedAssigneeId = ownedAssignee ? assigneeId : null;

  await prisma.task.createMany({
    data: rows.map((item) => {
      const dueAt = item.dueDateYMD ? parseYMD(item.dueDateYMD) : null;
      if (dueAt) dueAt.setHours(23, 59, 0, 0);
      return {
        userId: user.id,
        title: item.title.trim(),
        dueAt,
        projectId: verifiedProjectId,
        assigneeId: verifiedAssigneeId,
      };
    }),
  });

  revalidatePath("/tasks");
  return { created: rows.length };
}
