import { RRule } from "rrule";

// rrule computes entirely in UTC calendar fields — it has no concept of
// "local wall-clock time," so feeding it a real local Date means every
// occurrence is a fixed UTC instant, not a fixed local time. That's wrong
// for "every Monday at 9am local": across a DST transition, the UTC
// offset changes but rrule doesn't know to compensate, so the local wall-
// clock time of each occurrence drifts by exactly the DST delta (an hour
// in the US). The standard workaround: relabel the local calendar fields
// as if they were UTC before handing them to rrule, do all rrule math in
// that fake-UTC space (pure calendar arithmetic, immune to DST since
// there's no real timezone involved anymore), then relabel the result's
// UTC fields back as local. Applied consistently to dtstart, until, and
// the between()/after() range bounds, this keeps every rrule comparison
// internally consistent and yields occurrences at the correct local wall-
// clock time regardless of DST.
export function toFakeUTC(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ),
  );
}

export function fromFakeUTC(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/**
 * Builds an RRule anchored to a local `dtstart`, correct across DST (see
 * toFakeUTC/fromFakeUTC above). Use this everywhere instead of
 * `new RRule({...RRule.parseString(rule), dtstart})` directly.
 */
export function buildLocalRRule(recurrenceRule: string, dtstart: Date): RRule {
  const options = RRule.parseString(recurrenceRule);
  return new RRule({
    ...options,
    dtstart: toFakeUTC(dtstart),
    until: options.until ? toFakeUTC(options.until) : null,
  });
}

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
  const rule = buildLocalRRule(event.recurrenceRule, event.start);
  // The lookback must cover at least the occurrence's own duration —
  // otherwise an occurrence longer than the fixed lookback window can
  // start before it and still be missed, the same "vanishes mid-span" bug
  // fixed for non-recurring events, one layer down for recurring ones.
  const lookbackMs = Math.max(LOOKBACK_MS, durationMs);
  const fakeStarts = rule.between(
    toFakeUTC(new Date(rangeStart.getTime() - lookbackMs)),
    toFakeUTC(rangeEnd),
    true,
  );
  const starts = fakeStarts.map(fromFakeUTC);

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
