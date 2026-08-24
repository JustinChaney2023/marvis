/**
 * Rough work-time estimate for an imported syllabus item, from its title.
 *
 * The importer previously set nothing, so every task took Prisma's
 * default 30 minutes. That isn't a neutral default — it's an input to the
 * auto-scheduler, so a 2-hour lab booked as a 30-minute block produces a
 * calendar that's quietly wrong all semester, and a whole course of them
 * under-reserves study time by hours a week.
 *
 * ponytail: keyword match on the title, not a model call. It's wrong
 * sometimes and every task stays editable afterward; the win is that
 * "Lab 3" and "Knowledge Check" stop being indistinguishable to the
 * scheduler. Upgrade to per-item AI estimates only if the keywords prove
 * genuinely inadequate in practice.
 *
 * Ordered most-specific first: "Lab 2 Build a VPC" is a lab, not a
 * generic assignment, and the first match wins.
 */
const DURATION_RULES: { pattern: RegExp; minutes: number }[] = [
  // Sit-down assessments run long and are worth reserving properly.
  { pattern: /\b(final|midterm)\b.*\bexam\b|\bexam\b.*\b(final|midterm)\b/i, minutes: 120 },
  { pattern: /\bexam\b/i, minutes: 90 },
  // Hands-on work: the single biggest under-estimate at a flat 30m.
  { pattern: /\blabs?\b/i, minutes: 90 },
  // Longer written work.
  { pattern: /\b(project|paper|essay|report|presentation)\b/i, minutes: 120 },
  // Short auto-graded checks — the syllabus's own "Knowledge Check".
  { pattern: /\b(knowledge check|quiz|checkpoint)\b/i, minutes: 20 },
  // Read-and-post: real but bounded.
  { pattern: /\b(discussion|forum|post|reply)\b/i, minutes: 30 },
  { pattern: /\b(read|reading|chapter)\b/i, minutes: 45 },
  // Generic graded work sits between a quiz and a lab.
  { pattern: /\bassignment\b/i, minutes: 45 },
  // Administrative deadlines are a reminder, not work to schedule.
  { pattern: /\b(deadline|add\/drop|withdraw|registration|register)\b/i, minutes: 15 },
];

export const DEFAULT_TASK_MINUTES = 30;

export function estimateTaskMinutes(title: string): number {
  for (const rule of DURATION_RULES) {
    if (rule.pattern.test(title)) return rule.minutes;
  }
  return DEFAULT_TASK_MINUTES;
}
