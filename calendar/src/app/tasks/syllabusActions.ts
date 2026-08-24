"use server";

import mammoth from "mammoth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatYMD, parseYMD, toLocalInputValue } from "@/lib/calendar-dates";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { buildCustomWeeklyRule, WEEKDAY_CODES, type WeekdayCode } from "@/lib/recurrence";
import { estimateTaskMinutes } from "@/lib/taskDuration";
import { convertToMarkdown } from "@/lib/markitdown";
import { MAX_CONVERT_BYTES, isWithinSizeLimit, pickConverter } from "@/lib/documentConvert";
import {
  extractSyllabusDates,
  SCHOOL_COURSE_TEMPLATE,
  type ExtractSyllabusResult,
} from "@/lib/syllabusExtract";
import { createEvent, updateEventOccurrence } from "../actions";

/**
 * Turns an uploaded file into plain text for the AI extraction step.
 *
 * .txt/.md never reach here — the client reads those itself. .docx stays on
 * mammoth in-process rather than going through the converter service: it
 * already works with nothing configured, and regressing a working offline
 * path into a service dependency would be a straight downgrade. Everything
 * else (PDF and friends) needs the markitdown service.
 */
export async function extractFileTextAction(
  formData: FormData,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (!isWithinSizeLimit(file.size)) {
    return { ok: false, error: `File must be non-empty and under ${MAX_CONVERT_BYTES / (1024 * 1024)}MB.` };
  }

  const converter = pickConverter(file.name);
  if (converter === null || converter === "text") {
    return { ok: false, error: "That file type isn't supported — paste the text instead." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (converter === "docx") {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      if (!value.trim()) return { ok: false, error: "Couldn't find any text in that file." };
      return { ok: true, text: value };
    } catch {
      return { ok: false, error: "Couldn't read that .docx file — it may be corrupted." };
    }
  }

  const { markitdownUrl } = await getAppSettings(user.id);
  if (!markitdownUrl) {
    return {
      ok: false,
      error:
        "PDFs and other documents need the conversion service. Set it up in Settings → AI (see docs/markitdown-setup.md), or paste the text instead.",
    };
  }
  return convertToMarkdown(buffer, file.name, file.type || "application/octet-stream", markitdownUrl);
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

/** Free prose for Project.notes — course description, outcomes, delivery. */
export type SyllabusNotesInput = string | null;

export type SyllabusExamInput = {
  // The syllabus's own name for it — carries the exam's identity, since
  // `type` can't tell two midterms apart.
  title: string;
  type: "midterm" | "final" | "other";
  dateYMD: string | null;
  notes: string | null;
};

export type SyllabusCourseFieldInput = {
  key: string;
  label: string;
  fieldType: string;
  value: string;
};

export type ImportSyllabusCourseInput = {
  // Reviewed course name — used as the new Project's name, or ignored
  // if useExistingProjectId is set.
  courseName: string;
  // Set to skip creating a new Project (and skip writing course-info
  // fields, which belong to a course project, not an arbitrary existing
  // one) — deliverables/exams still get created, scoped to this project.
  useExistingProjectId: string | null;
  // Free prose -> Project.notes (course description, outcomes, delivery).
  courseSummary: SyllabusNotesInput;
  fields: SyllabusCourseFieldInput[];
  assigneeId: string | null;
  tasks: SyllabusTaskInput[];
  exams: SyllabusExamInput[];
  // Recurring term-long class-schedule event — all optional-together;
  // skipped whenever any piece needed to build it is missing.
  createClassSchedule: boolean;
  meetingDays: WeekdayCode[] | null;
  meetingStartTime: string | null; // "HH:mm"
  meetingEndTime: string | null;
  meetingLocation: string | null;
  termStartYMD: string | null;
  termEndYMD: string | null;
  lectureSchedule: { dateYMD: string | null; topic: string }[];
};

export type ImportSyllabusCourseResult = {
  projectId: string;
  taskCount: number;
  examEventCount: number;
  classScheduleCreated: boolean;
  lectureNotesCount: number;
};

function combineDateTime(ymd: string, hhmm: string): Date {
  const d = parseYMD(ymd);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function eventFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * Bulk-creates a full course scaffold from reviewed syllabus extraction:
 * a Project (new, or an existing one to add into), structured course-info
 * ProjectFields (School/Course template, new-project case only), Tasks
 * for every included assignment, Events for included exam dates (final
 * exam explicitly flagged as an estimate — see below), and, when
 * requested, one recurring term-long class-schedule Event with each
 * resolvable lecture-day's topic stamped onto that occurrence's own
 * notes via the existing per-occurrence exception mechanism (#40).
 */
export async function importSyllabusCourseAction(
  input: ImportSyllabusCourseInput,
): Promise<ImportSyllabusCourseResult> {
  const user = await requireUser();

  let projectId = input.useExistingProjectId;
  if (projectId) {
    const owned = await prisma.project.findFirst({ where: { id: projectId, userId: user.id } });
    if (!owned) projectId = null;
  }
  if (!projectId) {
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: input.courseName.trim() || "Untitled course",
        notes: input.courseSummary?.trim() || null,
      },
    });
    projectId = project.id;

    const fieldRows = input.fields
      .filter((f) => f.value.trim())
      .map((f, i) => ({
        projectId: project.id,
        key: f.key,
        label: f.label,
        value: f.value.trim(),
        fieldType: f.fieldType,
        sortOrder: i,
      }));
    if (fieldRows.length > 0) {
      await prisma.projectField.createMany({ data: fieldRows });
    }
  }

  const ownedAssignee = input.assigneeId
    ? await prisma.assignee.findFirst({ where: { id: input.assigneeId, userId: user.id }, select: { id: true } })
    : null;
  const verifiedAssigneeId = ownedAssignee ? input.assigneeId : null;

  const taskRows = input.tasks.filter((t) => t.title.trim());
  if (taskRows.length > 0) {
    await prisma.task.createMany({
      data: taskRows.map((item) => {
        const dueAt = item.dueDateYMD ? parseYMD(item.dueDateYMD) : null;
        if (dueAt) dueAt.setHours(23, 59, 0, 0);
        const title = item.title.trim();
        return {
          userId: user.id,
          title,
          dueAt,
          // Beats Prisma's flat 30m default, which fed the auto-scheduler
          // the same block size for a 2-hour lab and a 20-minute quiz.
          durationMin: estimateTaskMinutes(title),
          projectId,
          assigneeId: verifiedAssigneeId,
        };
      }),
    });
  }

  const hasClassTime = Boolean(input.meetingStartTime && input.meetingEndTime);
  let examEventCount = 0;
  for (const exam of input.exams) {
    if (!exam.dateYMD) continue;
    // The reviewed title, not a label derived from `type` — deriving it
    // collapsed "Midterm 1"/"Midterm 2" into two identical calendar
    // entries with no way to tell which was which.
    const title = exam.title.trim() || (exam.type === "final" ? "Final exam" : "Exam");
    const finalCaveat =
      exam.type === "final"
        ? "Estimated time — confirm the actual final exam schedule closer to the date; finals are often a different or longer slot than regular class time."
        : null;
    const notes = [exam.notes, finalCaveat].filter(Boolean).join("\n\n") || null;
    const start =
      hasClassTime
        ? combineDateTime(exam.dateYMD, input.meetingStartTime!)
        : (() => {
            const d = parseYMD(exam.dateYMD!);
            d.setHours(0, 0, 0, 0);
            return d;
          })();
    const end = hasClassTime
      ? combineDateTime(exam.dateYMD, input.meetingEndTime!)
      : new Date(start.getTime() + 86_400_000);

    await createEvent(
      eventFormData({
        title: `${title}${input.courseName ? ` — ${input.courseName}` : ""}`,
        start: toLocalInputValue(start),
        end: toLocalInputValue(end),
        notes: notes ?? "",
        location: input.meetingLocation ?? "",
        allDay: hasClassTime ? "" : "on",
      }),
    );
    examEventCount++;
  }

  let classScheduleCreated = false;
  let lectureNotesCount = 0;
  if (
    input.createClassSchedule &&
    input.meetingDays &&
    input.meetingDays.length > 0 &&
    input.meetingStartTime &&
    input.meetingEndTime &&
    input.termStartYMD
  ) {
    const termStart = parseYMD(input.termStartYMD);
    let firstDay = new Date(termStart);
    for (let i = 0; i < 7; i++) {
      if (input.meetingDays.includes(WEEKDAY_CODES[firstDay.getDay()])) break;
      firstDay = new Date(firstDay.getTime() + 86_400_000);
    }
    const masterStart = combineDateTime(formatYMD(firstDay), input.meetingStartTime);
    const masterEnd = combineDateTime(formatYMD(firstDay), input.meetingEndTime);
    const recurrenceEndsBefore = input.termEndYMD
      ? new Date(parseYMD(input.termEndYMD).getTime() + 86_400_000)
      : null;

    const master = await prisma.event.create({
      data: {
        userId: user.id,
        title: input.courseName.trim() || "Class",
        start: masterStart,
        end: masterEnd,
        recurrenceRule: buildCustomWeeklyRule(input.meetingDays),
        recurrenceEndsBefore,
        location: input.meetingLocation || null,
        localDirty: true,
      },
    });
    classScheduleCreated = true;

    for (const lecture of input.lectureSchedule) {
      if (!lecture.dateYMD || !lecture.topic.trim()) continue;
      const day = parseYMD(lecture.dateYMD);
      // Only a real occurrence of this rule (matching weekday, on/after
      // the series start) can be turned into a single-occurrence
      // exception — anything else would silently no-op inside
      // updateEventOccurrence (it requires a recurring master + a valid
      // excluded start), so skip rather than call it on a bad date.
      if (!input.meetingDays.includes(WEEKDAY_CODES[day.getDay()])) continue;
      if (day.getTime() < masterStart.getTime()) continue;

      const occStart = combineDateTime(lecture.dateYMD, input.meetingStartTime);
      const occEnd = combineDateTime(lecture.dateYMD, input.meetingEndTime);
      await updateEventOccurrence(
        master.id,
        occStart.toISOString(),
        eventFormData({
          title: master.title,
          start: toLocalInputValue(occStart),
          end: toLocalInputValue(occEnd),
          notes: lecture.topic.trim(),
          location: input.meetingLocation ?? "",
        }),
      );
      lectureNotesCount++;
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  return {
    projectId,
    taskCount: taskRows.length,
    examEventCount,
    classScheduleCreated,
    lectureNotesCount,
  };
}

