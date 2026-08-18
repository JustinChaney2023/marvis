import { RRule } from "rrule";

/**
 * The next occurrence's due date after `currentDueAt`, per `recurrenceRule`
 * (same RRULE format as Event.recurrenceRule, no DTSTART line — dueAt IS
 * the anchor). Returns null if the rule is empty or genuinely produces no
 * further occurrence (e.g. it has an UNTIL that's already passed).
 */
export function nextTaskOccurrence(
  recurrenceRule: string,
  currentDueAt: Date,
): Date | null {
  const rule = new RRule({
    ...RRule.parseString(recurrenceRule),
    dtstart: currentDueAt,
  });
  // .after(dt, inclusive) with inclusive=false to skip the occurrence we
  // just completed, not return the same date again.
  return rule.after(currentDueAt, false);
}
