import { z } from "zod";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const EmailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type EmailDraft = z.infer<typeof EmailDraftSchema>;
export type DraftEmailResult = { ok: true; draft: EmailDraft } | { ok: false; error: string };

/**
 * Drafts a short status/follow-up email about a task — copy-to-clipboard
 * only (same as the booking page's "Copy available times"), never sent
 * on the user's behalf. The user picks the recipient and reviews before
 * sending, same reasoning as every other AI feature here: nothing goes
 * out without a human reading it first.
 */
export async function generateEmailDraft(
  taskTitle: string,
  taskNotes: string | null,
  projectName: string | null,
  dueAt: Date | null,
  localAi: LocalAiConfig | null,
  anthropicApiKey: string | null = null,
): Promise<DraftEmailResult> {
  const title = taskTitle.trim();
  if (!title) return { ok: false, error: "The task needs a title first." };

  const context = [
    `Task: ${title}`,
    projectName ? `Project: ${projectName}` : null,
    dueAt ? `Due: ${dueAt.toLocaleDateString()}` : null,
    taskNotes ? `Notes: ${taskNotes.trim().slice(0, 4000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "Draft a short, professional status-update or follow-up email about this task, addressed generically " +
    "(e.g. \"Hi,\" — the user will fill in the actual recipient). Keep it brief: 3-6 sentences. " +
    "Write a plain subject line and a plain-text body (no markdown, no signature block).";

  const result = await callAiForJson({
    system,
    userContent: context,
    schema: EmailDraftSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 800,
    shapeHint: '{"subject": string, "body": string}',
  });

  if (!result.ok) return result;
  return { ok: true, draft: result.data };
}
