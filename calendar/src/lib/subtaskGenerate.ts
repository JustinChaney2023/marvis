import { z } from "zod";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const SubtaskSuggestionSchema = z.object({
  subtasks: z.array(z.string()),
});

export type GenerateSubtasksResult =
  | { ok: true; subtasks: string[] }
  | { ok: false; error: string };

const MAX_CONTEXT_CHARS = 4000;

/** Trims each suggestion and drops any that are empty/whitespace-only. */
export function cleanSubtasks(subtasks: string[]): string[] {
  return subtasks.map((s) => s.trim()).filter(Boolean);
}

/**
 * Proposes a short checklist of subtasks for a task, from its own
 * title/notes/project (plus, when provided, text extracted from the
 * task's own attached files — e.g. a pasted-in assignment sheet — which
 * is what actually makes the suggestions concrete instead of generic) —
 * not the user's whole task list or other context, which keeps the
 * privacy/scope story simple ("this task's own text, nothing else")
 * until there's a real reason to widen it. Returns suggestions for
 * review, same pattern as syllabus import: nothing gets created until
 * the user confirms which ones to keep.
 */
export async function generateSubtasks(
  taskTitle: string,
  taskNotes: string | null,
  projectName: string | null,
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
  attachmentsText: string | null = null,
): Promise<GenerateSubtasksResult> {
  const title = taskTitle.trim();
  if (!title) return { ok: false, error: "The task needs a title first." };

  const context = [
    `Task: ${title}`,
    projectName ? `Project: ${projectName}` : null,
    taskNotes ? `Notes: ${taskNotes.trim().slice(0, MAX_CONTEXT_CHARS)}` : null,
    attachmentsText ? `Attached file contents:\n${attachmentsText.trim().slice(0, MAX_CONTEXT_CHARS)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You break a single task down into a short, concrete checklist of subtasks. " +
    "Propose 3-7 subtasks, each a specific, actionable step (not vague restatements of the task). " +
    "Order them the way you'd actually do them. Don't add a subtask for \"plan\" or \"review\" unless the task genuinely needs a distinct planning/review step.";

  const result = await callAiForJson({
    system,
    userContent: context,
    schema: SubtaskSuggestionSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 1500,
    shapeHint: '{"subtasks": [string, ...]}',
  });

  if (!result.ok) return result;
  return { ok: true, subtasks: cleanSubtasks(result.data.subtasks) };
}
