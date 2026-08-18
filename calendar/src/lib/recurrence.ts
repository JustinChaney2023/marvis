import { RRule } from "rrule";

export type RecurringEventSource = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  recurrenceRule: string | null;
};

export type Occurrence = {
  // Non-recurring: same as masterId. Recurring: `${masterId}::${startISO}`,
  // a stable per-occurrence id for React keys and click targets — always
  // maps back to masterId for edit/delete (v1 edits/deletes the series).
  id: string;
  masterId: string;
  title: string;
  start: Date;
  end: Date;
  isRecurring: boolean;
};

// Occurrences aren't stored, so a padded lookback catches any occurrence
// that started before `rangeStart` but still overlaps it (long events).
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export function expandEventOccurrences(
  event: RecurringEventSource,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  if (!event.recurrenceRule) {
    if (event.end <= rangeStart || event.start >= rangeEnd) return [];
    return [
      {
        id: event.id,
        masterId: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        isRecurring: false,
      },
    ];
  }

  const durationMs = event.end.getTime() - event.start.getTime();
  const rule = new RRule({
    ...RRule.parseString(event.recurrenceRule),
    dtstart: event.start,
  });
  const starts = rule.between(
    new Date(rangeStart.getTime() - LOOKBACK_MS),
    rangeEnd,
    true,
  );

  return starts
    .map((s) => ({
      id: `${event.id}::${s.toISOString()}`,
      masterId: event.id,
      title: event.title,
      start: s,
      end: new Date(s.getTime() + durationMs),
      isRecurring: true,
    }))
    .filter((o) => o.end > rangeStart && o.start < rangeEnd);
}

export function expandEvents(
  events: RecurringEventSource[],
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  return events.flatMap((e) => expandEventOccurrences(e, rangeStart, rangeEnd));
}

export const RECURRENCE_PRESETS = [
  { value: "", label: "Doesn't repeat" },
  { value: "FREQ=DAILY", label: "Daily" },
  { value: "FREQ=WEEKLY", label: "Weekly" },
  { value: "FREQ=MONTHLY", label: "Monthly" },
  { value: "FREQ=YEARLY", label: "Yearly" },
] as const;
