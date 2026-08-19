import { z } from "zod";
import { formatYMD } from "@/lib/calendar-dates";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const ExtractedItemSchema = z.object({
  title: z.string(),
  // YYYY-MM-DD, or null if the syllabus text genuinely doesn't give
  // enough to resolve a real date (e.g. "TBD", or a week number with no
  // term start date supplied to anchor it).
  dueDate: z.string().nullable(),
  notes: z.string().nullable(),
});

const ExtractionResultSchema = z.object({
  items: z.array(ExtractedItemSchema),
});

export type ExtractedSyllabusItem = z.infer<typeof ExtractedItemSchema>;

export type ExtractSyllabusResult =
  | { ok: true; items: ExtractedSyllabusItem[] }
  | { ok: false; error: string };

export type { LocalAiConfig };

const MAX_SYLLABUS_CHARS = 20_000;

/**
 * Pulls assignment/exam/reading due dates out of pasted syllabus text,
 * resolving relative references ("Week 3 Friday", "the Monday after
 * spring break") into real calendar dates when `termStartDate` is given
 * as an anchor. Returns items for review, not tasks — the caller (the
 * syllabus import page) always shows these back to the user to
 * edit/confirm before anything is written to the database, since a
 * misread date silently landing on the calendar is worse than one that
 * needs a manual fix.
 */
export async function extractSyllabusDates(
  syllabusText: string,
  referenceDate: Date,
  termStartDate: Date | null,
  localAi: LocalAiConfig | null,
): Promise<ExtractSyllabusResult> {
  const trimmed = syllabusText.trim().slice(0, MAX_SYLLABUS_CHARS);
  if (!trimmed) {
    return { ok: false, error: "Paste some syllabus text first." };
  }

  const termNote = termStartDate
    ? `The term/semester starts ${formatYMD(termStartDate)} — use this to resolve week numbers or relative day references (e.g. "Week 3 Friday").`
    : "No term start date was given — if the text only has relative references (week numbers, \"the Friday after X\") with nothing to anchor them, leave dueDate null and explain why in notes.";

  const system =
    "You extract graded deliverables (assignments, quizzes, exams, projects, readings with a due date) from a pasted course syllabus. " +
    "Only include items that are actual student deliverables or dated exams — skip office hours, grading-policy text, and general course info. " +
    `Today's date is ${formatYMD(referenceDate)}. ${termNote} ` +
    "Resolve every date you can to YYYY-MM-DD in the syllabus's academic year — infer the year from context (term dates, other explicit dates in the text) rather than defaulting to the current year. " +
    "If a date genuinely can't be resolved, set dueDate to null and say why in notes.";

  const result = await callAiForJson({
    system,
    userContent: trimmed,
    schema: ExtractionResultSchema,
    localAi,
    maxTokens: 8000,
    shapeHint: '{"items": [{"title": string, "dueDate": string|null, "notes": string|null}]}',
  });

  if (!result.ok) return result;
  return { ok: true, items: result.data.items };
}
