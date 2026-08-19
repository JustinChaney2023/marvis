import { z } from "zod";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const DocDraftSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type DocDraft = z.infer<typeof DocDraftSchema>;
export type DraftDocResult = { ok: true; doc: DocDraft } | { ok: false; error: string };

/**
 * Drafts a short brief/doc for a task — context, objective, key points,
 * next steps — from the task's own title/notes/project/subtasks. Same
 * copy-to-clipboard-only reasoning as generateEmailDraft: this app never
 * writes it anywhere on its own, the user reviews and takes it elsewhere
 * (a real doc tool, a wiki page, whatever). Scoped to a text document,
 * not a spreadsheet — a fundamentally different output shape that would
 * need its own review/export UI, not a variant of this one.
 */
export async function generateTaskDoc(
  taskTitle: string,
  taskNotes: string | null,
  projectName: string | null,
  subtaskTitles: string[],
  localAi: LocalAiConfig | null,
): Promise<DraftDocResult> {
  const title = taskTitle.trim();
  if (!title) return { ok: false, error: "The task needs a title first." };

  const context = [
    `Task: ${title}`,
    projectName ? `Project: ${projectName}` : null,
    taskNotes ? `Notes: ${taskNotes.trim().slice(0, 4000)}` : null,
    subtaskTitles.length ? `Subtasks:\n${subtaskTitles.map((t) => `- ${t}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "Draft a short working document for this task: a one-line objective, a few sentences of context, " +
    "key points as a bullet list, and a short next-steps list. Plain text with simple '-' bullets, " +
    "no markdown headers or bold. Keep it under 300 words — a working brief, not an essay. " +
    "Give it a short title separate from the body.";

  const result = await callAiForJson({
    system,
    userContent: context,
    schema: DocDraftSchema,
    localAi,
    maxTokens: 1200,
    shapeHint: '{"title": string, "body": string}',
  });

  if (!result.ok) return result;
  return { ok: true, doc: result.data };
}
