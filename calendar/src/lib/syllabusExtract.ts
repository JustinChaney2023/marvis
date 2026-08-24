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
  // Course/section identifier ("CNT A 290 Section 75111") and term
  // ("Fall 2026") — stated on essentially every syllabus, and the only
  // way to tell two semesters of the same course apart later.
  courseCode: z.string().nullable(),
  term: z.string().nullable(),
  creditHours: z.string().nullable(),
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
  // Consequential policies students actually need to look up mid-term.
  // latePolicy is the single most-referenced fact in most syllabi;
  // aiPolicy is increasingly load-bearing and varies wildly per course.
  latePolicy: z.string().nullable(),
  aiPolicy: z.string().nullable(),
  // Accounts/software required to do the work at all — actionable in a
  // way the rest of the boilerplate isn't.
  requiredTechnology: z.array(z.string()).nullable(),
  requiredBooks: z.array(z.string()).nullable(),
  optionalBooks: z.array(z.string()).nullable(),
  // Free prose that has no structured home: course description, learning
  // outcomes, how the course is delivered. Written to Project.notes,
  // which the importer previously left empty.
  courseSummary: z.string().nullable(),
});

const ExamDateSchema = z.object({
  // The syllabus's own wording ("Midterm 2", "Unit Exam 3", "Final
  // Exam"). Carried verbatim because `type` alone can't distinguish two
  // midterms, and deriving a title from a two-value enum turned every
  // exam into an indistinguishable "Midterm exam"/"Final exam".
  title: z.string(),
  // Kept alongside `title` only because "final" drives the
  // confirm-the-real-time caveat downstream — it's a classification
  // hint, not the exam's identity. "other" covers quizzes, practicals,
  // and anything that is neither.
  type: z.enum(["midterm", "final", "other"]),
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

export { SCHOOL_COURSE_TEMPLATE } from "./courseTemplate";

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
    "For `items`: graded deliverables (assignments, labs, quizzes, knowledge checks, discussion posts, projects, dated readings) AND hard administrative deadlines the student must not miss (add/drop deadline, withdrawal deadline, \"all work submitted by\" dates). " +
    "Do NOT put exams here — every exam belongs in `examDates` instead, or it will be created twice. " +
    "Skip office hours, policy prose, and general course info here; those go in courseInfo.\n" +
    "For `courseInfo`: pull whatever is stated (course name, course code/section, term, credit hours, instructor name/email, meeting days as short weekday codes SU/MO/TU/WE/TH/FR/SA, meeting start/end time as HH:mm 24-hour, meeting location, office hours, grading scale, grading policy, late-work policy, AI-use policy, required technology/software/accounts, required/optional books). " +
    "Set `courseSummary` to a short plain-prose summary of what the course is and how it's delivered, including learning outcomes if listed. " +
    "Leave any field null rather than guessing if the syllabus doesn't state it.\n" +
    "For `examDates`: EVERY exam the syllabus lists — all midterms, unit exams, practicals, and the final — each as {title, type, date, notes}. " +
    "Set `title` to the syllabus's own wording verbatim (\"Midterm 2\", \"Unit Exam 3\", \"Final Exam\") so two exams of the same type stay distinguishable. " +
    "Set `type` to \"final\" ONLY for the actual final exam, \"midterm\" for midterm-style exams, and \"other\" for anything else. Do not label a midterm as final. " +
    "Set `date` ONLY to a date the syllabus actually states for that exam. If it names a week or a range rather than a day, or says the time is TBD, leave `date` null and explain in `notes` — never pick a plausible-looking day, because a wrong exam date on a calendar is worse than a missing one.\n" +
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
      '"courseInfo": {"courseName": string|null, "courseCode": string|null, "term": string|null, "creditHours": string|null, "instructorName": string|null, "instructorEmail": string|null, "meetingDays": string[]|null, "meetingStartTime": string|null, "meetingEndTime": string|null, "meetingLocation": string|null, "officeHoursDays": string|null, "officeHoursTime": string|null, "officeHoursLocation": string|null, "gradingScale": string|null, "gradingPolicy": string|null, "latePolicy": string|null, "aiPolicy": string|null, "requiredTechnology": string[]|null, "requiredBooks": string[]|null, "optionalBooks": string[]|null, "courseSummary": string|null}, ' +
      '"examDates": [{"title": string, "type": "midterm"|"final"|"other", "date": string|null, "notes": string|null}], ' +
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
