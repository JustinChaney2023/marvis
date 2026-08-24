import { z } from "zod";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const GeneratedTaskSchema = z.object({
  title: z.string(),
  notes: z.string().nullable(),
});

const GeneratedProjectSchema = z.object({
  projectName: z.string(),
  tasks: z.array(GeneratedTaskSchema),
});

export type GeneratedTask = z.infer<typeof GeneratedTaskSchema>;

export type GenerateProjectResult =
  | { ok: true; projectName: string; tasks: GeneratedTask[] }
  | { ok: false; error: string };

const MAX_PROMPT_CHARS = 2000;

/**
 * Turns one freeform prompt ("work on OmneHosting's Q3 launch") into a
 * project name plus a reviewable task breakdown — the third mode on the
 * same callAiForJson pipeline syllabus import and AI subtasks already
 * use. Nothing is created until the review step (projectActions.ts)
 * confirms it, same "AI proposes, you approve" contract as those two.
 */
export async function generateProjectPlan(
  prompt: string,
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
): Promise<GenerateProjectResult> {
  const trimmed = prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!trimmed) return { ok: false, error: "Describe the project first." };

  const system =
    "You turn a one-line project description into a short project name and a concrete task breakdown. " +
    "Propose 4-12 tasks, each a specific, actionable step — not vague restatements of the project. " +
    "Order them the way you'd actually do them. Keep the project name short (2-5 words).";

  const result = await callAiForJson({
    system,
    userContent: trimmed,
    schema: GeneratedProjectSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 2000,
    shapeHint: '{"projectName": string, "tasks": [{"title": string, "notes": string|null}, ...]}',
  });

  if (!result.ok) return result;
  return { ok: true, projectName: result.data.projectName, tasks: result.data.tasks };
}
