// Server-side timezone math for the scheduler/booking/sync code (#46) —
// none of that runs in a browser, so it can't lean on the JS engine's own
// "local timezone" the way client components do. No new dependency: native
// Intl already knows every IANA zone's offset for any instant, which is
// all a work-hours window needs.

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at the instant `date`. */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * The weekday (0=Sunday..6=Saturday) `date` falls on when viewed in
 * `timeZone` — day boundaries shift with the zone, so this can differ
 * from `date.getDay()` in the server's own zone near midnight.
 */
export function getZonedWeekday(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  // A calendar date's weekday doesn't depend on time-of-day, so building
  // it at UTC midnight for those Y/M/D fields is safe.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** The Y/M/D `date` falls on when viewed in `timeZone`. */
export function getZonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const { year, month, day } = zonedParts(date, timeZone);
  return { year, month, day };
}

/**
 * The UTC instant corresponding to a wall-clock date/time *in* `timeZone`
 * — e.g. "9:00 AM on 2026-08-21 in America/Chicago" -> that instant's UTC
 * Date. One correction pass handles the ordinary case where the initial
 * UTC-offset guess crosses a DST boundary; an instant that falls inside a
 * DST fall-back/spring-forward gap itself (a wall time that either
 * repeats or never occurs, twice a year, for a couple hours) isn't
 * specially resolved.
 * ponytail: exact-nonexistent/ambiguous DST-transition wall times aren't
 * disambiguated — add a spring-forward/fall-back rule if a real user
 * report ever traces back to one of those two hours a year.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = getTimeZoneOffsetMinutes(new Date(guessUtc), timeZone);
  const candidate = new Date(guessUtc - offset1 * 60_000);
  const offset2 = getTimeZoneOffsetMinutes(candidate, timeZone);
  return offset2 === offset1 ? candidate : new Date(guessUtc - offset2 * 60_000);
}
