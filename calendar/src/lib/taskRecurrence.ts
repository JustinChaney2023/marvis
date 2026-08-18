import { buildLocalRRule, fromFakeUTC, toFakeUTC } from "@/lib/recurrence";

/**
 * The next occurrence's due date after `currentDueAt`, per `recurrenceRule`
 * (same RRULE format as Event.recurrenceRule, no DTSTART line — dueAt IS
 * the anchor). Returns null if the rule is empty or genuinely produces no
 * further occurrence (e.g. it has an UNTIL that's already passed). Uses
 * buildLocalRRule so this stays correct across a DST transition, same as
 * event recurrence — see the comment on toFakeUTC in recurrence.ts.
 */
export function nextTaskOccurrence(
  recurrenceRule: string,
  currentDueAt: Date,
): Date | null {
  const rule = buildLocalRRule(recurrenceRule, currentDueAt);
  // .after(dt, inclusive) with inclusive=false to skip the occurrence we
  // just completed, not return the same date again.
  const next = rule.after(toFakeUTC(currentDueAt), false);
  return next ? fromFakeUTC(next) : null;
}
