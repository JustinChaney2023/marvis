import { buildLocalRRule, fromFakeUTC, toFakeUTC } from "@/lib/recurrence";

// RRULE's FREQ=MONTHLY/YEARLY derives the day-of-month from dtstart and
// skips any month/year that doesn't have that day at all (Jan 31 -> next
// is Mar 31, silently skipping Feb) rather than landing on that month's
// last day — surprising for a due-date preset with no BYMONTHDAY control
// in the UI to work around it. Advance by plain calendar months instead,
// clamped to the target month's last day, for these two exact presets.
function addCalendarMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  result.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return result;
}

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
  if (recurrenceRule === "FREQ=MONTHLY") return addCalendarMonths(currentDueAt, 1);
  if (recurrenceRule === "FREQ=YEARLY") return addCalendarMonths(currentDueAt, 12);

  const rule = buildLocalRRule(recurrenceRule, currentDueAt);
  // .after(dt, inclusive) with inclusive=false to skip the occurrence we
  // just completed, not return the same date again.
  const next = rule.after(toFakeUTC(currentDueAt), false);
  return next ? fromFakeUTC(next) : null;
}
