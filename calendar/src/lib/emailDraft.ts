import { z } from "zod";
import { callAiForJson, type LocalAiConfig } from "@/lib/aiClient";

const EmailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

// `to` is added deterministically after the AI call (see below), not
// part of what the model returns — kept off EmailDraftSchema so
// callAiForJson's shape validation doesn't require the model produce it.

export type EmailDraft = z.infer<typeof EmailDraftSchema> & { to?: string };
export type DraftEmailResult = { ok: true; draft: EmailDraft } | { ok: false; error: string };

const HONORIFIC_PREFIX = /^(dr|mr|mrs|ms|mx|prof|professor)\.?\s+/i;

/** First name to open a greeting with — strips a leading honorific/title and stray whitespace. */
export function firstNameForGreeting(fullName: string): string {
  const trimmed = fullName.trim();
  const stripped = trimmed.replace(HONORIFIC_PREFIX, "").trim();
  // A name that's nothing but an honorific (degenerate input) would
  // otherwise strip to an empty greeting — fall back to the untouched
  // original rather than open with "Hi ,".
  const name = stripped || trimmed;
  return name.split(/\s+/)[0];
}

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
  // From the task's project, when it's a syllabus-imported course — lets
  // the draft actually address the instructor by name instead of a
  // generic "Hi," even though the app already has this on file.
  instructorName: string | null = null,
  instructorEmail: string | null = null,
): Promise<DraftEmailResult> {
  const title = taskTitle.trim();
  if (!title) return { ok: false, error: "The task needs a title first." };

  const context = [
    `Task: ${title}`,
    projectName ? `Project: ${projectName}` : null,
    dueAt ? `Due: ${dueAt.toLocaleDateString()}` : null,
    instructorName ? `Recipient: ${instructorName}${instructorEmail ? ` <${instructorEmail}>` : ""}` : null,
    taskNotes ? `Notes: ${taskNotes.trim().slice(0, 4000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = instructorName
    ? `Draft a short, professional email about this task addressed to ${instructorName} (open with "Hi ${firstNameForGreeting(instructorName)},"). ` +
      "Keep it brief: 3-6 sentences. Write a plain subject line and a plain-text body (no markdown, no signature block)."
    : "Draft a short, professional status-update or follow-up email about this task, addressed generically " +
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
  return {
    ok: true,
    // The recipient is known deterministically from the project's own
    // stored field — no reason to have the model guess or omit it.
    draft: instructorEmail ? { ...result.data, to: instructorEmail } : result.data,
  };
}
