import { z } from "zod";
import { formatYMD } from "@/lib/calendar-dates";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";
import { WEEKDAY_CODES } from "@/lib/recurrence";

const ExtractedItemSchema = z.object({
  title: z.string(),
  // YYYY-MM-DD, or null if the syllabus text genuinely doesn't give
  // enough to resolve a real date (e.g. "TBD", or a week number with no
  // term start date supplied to anchor it).
  dueDate: z.string().nullable(),
  notes: z.string().nullable(),
});

const CourseInfoSchema = z.object({
  courseName: z.string().nullable(),
  instructorName: z.string().nullable(),
  instructorEmail: z.string().nullable(),
  // Short weekday codes (WEEKDAY_CODES), e.g. ["MO","WE","FR"] — plugs
  // straight into buildCustomWeeklyRule for the recurring class-schedule
  // event, no separate parsing step needed downstream.
  meetingDays: z.array(z.enum(WEEKDAY_CODES)).nullable(),
  meetingStartTime: z.string().nullable(), // "HH:mm"
  meetingEndTime: z.string().nullable(),
  meetingLocation: z.string().nullable(),
  officeHoursDays: z.string().nullable(),
  officeHoursTime: z.string().nullable(),
  officeHoursLocation: z.string().nullable(),
  gradingScale: z.string().nullable(),
  gradingPolicy: z.string().nullable(),
  requiredBooks: z.array(z.string()).nullable(),
  optionalBooks: z.array(z.string()).nullable(),
});

const ExamDateSchema = z.object({
  type: z.enum(["midterm", "final"]),
  date: z.string().nullable(),
  notes: z.string().nullable(),
});

const LectureScheduleItemSchema = z.object({
  // Null when the syllabus only gives a relative reference ("Week 3")
  // and no term start date was supplied to resolve it — kept (not
  // dropped) so the review UI can show it as unresolved.
  date: z.string().nullable(),
  topic: z.string(),
});

const ExtractionResultSchema = z.object({
  items: z.array(ExtractedItemSchema),
  courseInfo: CourseInfoSchema,
  examDates: z.array(ExamDateSchema),
  lectureSchedule: z.array(LectureScheduleItemSchema),
});

export type ExtractedSyllabusItem = z.infer<typeof ExtractedItemSchema>;
export type CourseInfo = z.infer<typeof CourseInfoSchema>;
export type ExamDate = z.infer<typeof ExamDateSchema>;
export type LectureScheduleItem = z.infer<typeof LectureScheduleItemSchema>;

export type ExtractSyllabusResult =
  | {
      ok: true;
      items: ExtractedSyllabusItem[];
      courseInfo: CourseInfo;
      examDates: ExamDate[];
      lectureSchedule: LectureScheduleItem[];
    }
  | { ok: false; error: string };

export type { LocalAiConfig };

const MAX_SYLLABUS_CHARS = 20_000;

// The syllabus importer's one built-in ProjectField template — a plain
// code constant, not a user-facing template builder (explicitly out of
// scope). `key` matches a CourseInfo field name 1:1 so the import action
// can map them mechanically; `list` fields join with "\n".
export const SCHOOL_COURSE_TEMPLATE: {
  key: keyof CourseInfo;
  label: string;
  fieldType: "TEXT" | "LONG_TEXT" | "EMAIL" | "LIST";
}[] = [
  { key: "instructorName", label: "Instructor", fieldType: "TEXT" },
  { key: "instructorEmail", label: "Instructor email", fieldType: "EMAIL" },
  { key: "meetingLocation", label: "Class location", fieldType: "TEXT" },
  { key: "officeHoursDays", label: "Office hours (days)", fieldType: "TEXT" },
  { key: "officeHoursTime", label: "Office hours (time)", fieldType: "TEXT" },
  { key: "officeHoursLocation", label: "Office hours (location)", fieldType: "TEXT" },
  { key: "gradingScale", label: "Grade scale", fieldType: "LONG_TEXT" },
  { key: "gradingPolicy", label: "Grading policy", fieldType: "LONG_TEXT" },
  { key: "requiredBooks", label: "Required books", fieldType: "LIST" },
  { key: "optionalBooks", label: "Optional books", fieldType: "LIST" },
];

/**
 * Pulls a full course scaffold out of pasted syllabus text: graded
 * deliverables (existing behavior), plus structured course info,
 * midterm/final exam dates, and a week-by-week lecture topic schedule
 * when the syllabus has one. Resolves relative references ("Week 3
 * Friday", "the Monday after spring break") into real calendar dates
 * when `termStartDate` is given as an anchor. Returns everything for
 * review, not committed rows — the caller always shows this back for
 * edit/confirm before anything is written to the database, since a
 * misread date silently landing on the calendar is worse than one that
 * needs a manual fix.
 */
export async function extractSyllabusDates(
  syllabusText: string,
  referenceDate: Date,
  termStartDate: Date | null,
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
): Promise<ExtractSyllabusResult> {
  const trimmed = syllabusText.trim().slice(0, MAX_SYLLABUS_CHARS);
  if (!trimmed) {
    return { ok: false, error: "Paste some syllabus text first." };
  }

  const termNote = termStartDate
    ? `The term/semester starts ${formatYMD(termStartDate)} — use this to resolve week numbers or relative day references (e.g. "Week 3 Friday").`
    : "No term start date was given — if the text only has relative references (week numbers, \"the Friday after X\") with nothing to anchor them, leave date fields null and explain why in notes.";

  const system =
    "You extract a full course scaffold from a pasted course syllabus: graded deliverables, structured course info, exam dates, and (if present) a week-by-week lecture topic schedule. " +
    `Today's date is ${formatYMD(referenceDate)}. ${termNote} ` +
    "Resolve every date you can to YYYY-MM-DD in the syllabus's academic year — infer the year from context (term dates, other explicit dates in the text) rather than defaulting to the current year. " +
    "If a date genuinely can't be resolved, leave it null and say why in notes.\n\n" +
    "For `items`: graded deliverables only (assignments, quizzes, exams, projects, dated readings) — skip office hours, policy text, and general course info here, those go in courseInfo.\n" +
    "For `courseInfo`: pull whatever is stated (course name, instructor name/email, meeting days as short weekday codes SU/MO/TU/WE/TH/FR/SA, meeting start/end time as HH:mm 24-hour, meeting location, office hours, grading scale, grading policy, required/optional books). Leave any field null rather than guessing if the syllabus doesn't state it.\n" +
    "For `examDates`: midterm(s) and final exam specifically, separate from the general `items` list, each as {type, date, notes}.\n" +
    "For `lectureSchedule`: only if the syllabus has an actual week-by-week or day-by-day list of lecture topics — one entry per session, {date, topic}. Return an empty array if there's no such outline, don't invent one.";

  const result = await callAiForJson({
    system,
    userContent: trimmed,
    schema: ExtractionResultSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 8000,
    shapeHint:
      '{"items": [{"title": string, "dueDate": string|null, "notes": string|null}], ' +
      '"courseInfo": {"courseName": string|null, "instructorName": string|null, "instructorEmail": string|null, "meetingDays": string[]|null, "meetingStartTime": string|null, "meetingEndTime": string|null, "meetingLocation": string|null, "officeHoursDays": string|null, "officeHoursTime": string|null, "officeHoursLocation": string|null, "gradingScale": string|null, "gradingPolicy": string|null, "requiredBooks": string[]|null, "optionalBooks": string[]|null}, ' +
      '"examDates": [{"type": "midterm"|"final", "date": string|null, "notes": string|null}], ' +
      '"lectureSchedule": [{"date": string|null, "topic": string}]}',
  });

  if (!result.ok) return result;
  return {
    ok: true,
    items: result.data.items,
    courseInfo: result.data.courseInfo,
    examDates: result.data.examDates,
    lectureSchedule: result.data.lectureSchedule,
  };
}
