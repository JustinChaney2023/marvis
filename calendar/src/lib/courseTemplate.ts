import type { CourseInfo } from "./syllabusExtract";

/**
 * The syllabus importer's one built-in ProjectField template — a plain
 * code constant, not a user-facing template builder (explicitly out of
 * scope). `key` matches a CourseInfo field name 1:1 so the import action
 * can map them mechanically; `list` fields join with "\n".
 *
 * Lives in its own client-safe module (same split as chatActions.ts and
 * recordingFormat.ts) for two reasons: syllabusExtract.ts pulls in
 * aiClient.ts and its node-only deps, so a client component can't import
 * from there; and re-exporting it from syllabusActions.ts is illegal —
 * a "use server" file may only export async functions, and doing so
 * fails at runtime with the whole module unloadable, which tsc and
 * next build both happily miss.
 */
export const SCHOOL_COURSE_TEMPLATE: {
  key: keyof CourseInfo;
  label: string;
  fieldType: "TEXT" | "LONG_TEXT" | "EMAIL" | "LIST";
}[] = [
  { key: "courseCode", label: "Course / section", fieldType: "TEXT" },
  { key: "term", label: "Term", fieldType: "TEXT" },
  { key: "creditHours", label: "Credits", fieldType: "TEXT" },
  { key: "instructorName", label: "Instructor", fieldType: "TEXT" },
  { key: "instructorEmail", label: "Instructor email", fieldType: "EMAIL" },
  { key: "meetingLocation", label: "Class location", fieldType: "TEXT" },
  { key: "officeHoursDays", label: "Office hours (days)", fieldType: "TEXT" },
  { key: "officeHoursTime", label: "Office hours (time)", fieldType: "TEXT" },
  { key: "officeHoursLocation", label: "Office hours (location)", fieldType: "TEXT" },
  { key: "gradingScale", label: "Grade scale", fieldType: "LONG_TEXT" },
  { key: "gradingPolicy", label: "Grading policy", fieldType: "LONG_TEXT" },
  { key: "latePolicy", label: "Late work policy", fieldType: "LONG_TEXT" },
  { key: "aiPolicy", label: "AI policy", fieldType: "LONG_TEXT" },
  { key: "requiredTechnology", label: "Required technology", fieldType: "LIST" },
  { key: "requiredBooks", label: "Required books", fieldType: "LIST" },
  { key: "optionalBooks", label: "Optional books", fieldType: "LIST" },
];
