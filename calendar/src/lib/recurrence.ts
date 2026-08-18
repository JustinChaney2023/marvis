import { RRule } from "rrule";

export type RecurringEventSource = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  recurrenceRule: string | null;
  allDay: boolean;
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
  allDay: boolean;
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
        allDay: event.allDay,
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
      allDay: event.allDay,
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

export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export function buildCustomWeeklyRule(days: WeekdayCode[]): string {
  if (days.length === 0) return "FREQ=WEEKLY";
  // Keep BYDAY in canonical Sun-Sat order regardless of selection order,
  // so the same day set always produces the same string (matters for
  // recognizing it as "custom" again when re-editing, and for the
  // export-to-Google diff in google-sync.ts, which compares strings).
  const ordered = WEEKDAY_CODES.filter((d) => days.includes(d));
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

/**
 * Recognizes a rule as "custom weekly with specific days" (what the
 * Custom repeat UI produces) and returns the selected days, or null if
 * the rule doesn't match that exact shape (a plain preset, or something
 * else entirely — e.g. an imported Google rule with COUNT/UNTIL/INTERVAL,
 * which this app's UI doesn't have controls for yet and just shows as an
 * unrecognized custom rule rather than trying to reverse-engineer it).
 */
export function parseCustomWeeklyDays(
  rule: string | null,
): WeekdayCode[] | null {
  if (!rule) return null;
  const match = rule.match(/^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/);
  if (!match) return null;
  const days = match[1].split(",");
  if (!days.every((d): d is WeekdayCode => WEEKDAY_CODES.includes(d as WeekdayCode))) {
    return null;
  }
  return days as WeekdayCode[];
}
