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

/** The full Y/M/D H:m:s `date` falls on when viewed in `timeZone`. */
export function getZonedWallTime(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  return zonedParts(date, timeZone);
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
  second = 0,
  millisecond = 0,
): Date {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset1 = getTimeZoneOffsetMinutes(new Date(guessUtc), timeZone);
  const candidate = new Date(guessUtc - offset1 * 60_000);
  const offset2 = getTimeZoneOffsetMinutes(candidate, timeZone);
  return offset2 === offset1 ? candidate : new Date(guessUtc - offset2 * 60_000);
}

/**
 * Parses a "YYYY-MM-DDTHH:mm" (optionally with :ss) wall-clock string —
 * the naive local format EventModal's date+time inputs produce — as a
 * wall time *in `timeZone`*, not the server process's own zone. Without
 * this, `new Date(raw)` on the server interprets the string in whatever
 * timezone the server host happens to be running in, which silently
 * drifts from the account's real timezone the moment the two differ
 * (e.g. a prod host set to UTC serving a user elsewhere).
 */
export function parseZonedWallTime(raw: string, timeZone: string): Date | null {
  // Forms that compute the exact instant in the browser (localWallTimeToIso)
  // send it with a Z/offset — it already names its zone, so use it as-is.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return zonedWallTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}

/** An account's real IANA zone, falling back to the server's own when unset (e.g. before TimezoneSync's first run). */
export function userTimeZone(user: { timezone: string | null }): string {
  return user.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Zone-aware day-boundary math for server-side calendar/agenda range
// computation (page.tsx and friends) — calendar-dates.ts's plain
// startOfDay/addDays/formatYMD etc. read via the JS engine's own local
// timezone, which is correct when they run in the browser (the engine's
// zone IS the account's zone there) but silently reads the *server
// process's* zone when the same code runs in a server component. That
// mismatch is exactly what made an evening event/task (in a zone behind
// UTC) land in the wrong day's query range and get displayed a day off —
// the "scheduling for yesterday" bug. These mirror the same operations but
// via `timeZone` explicitly, for server-side range/day-bucket use only.

/** Midnight of the calendar day `d` falls on, in `timeZone`. */
export function zonedStartOfDay(d: Date, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  return zonedWallTimeToUtc(year, month, day, 0, 0, timeZone);
}

/** `d` shifted by `n` calendar days, in `timeZone`, landing on that day's midnight. */
export function zonedAddDays(d: Date, n: number, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  return zonedWallTimeToUtc(year, month, day + n, 0, 0, timeZone);
}

/** Midnight of the Sunday starting the calendar week `d` falls in, in `timeZone`. */
export function zonedStartOfWeek(d: Date, timeZone: string): Date {
  const weekday = getZonedWeekday(d, timeZone);
  return zonedAddDays(zonedStartOfDay(d, timeZone), -weekday, timeZone);
}

/** Midnight of the 1st of the calendar month `d` falls in, in `timeZone`. */
export function zonedStartOfMonth(d: Date, timeZone: string): Date {
  const { year, month } = getZonedDateParts(d, timeZone);
  return zonedWallTimeToUtc(year, month, 1, 0, 0, timeZone);
}

/** "YYYY-MM-DD" for the calendar day `d` falls on, in `timeZone` — the zoned counterpart of calendar-dates.ts's formatYMD. */
export function zonedFormatYMD(d: Date, timeZone: string): string {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses a "YYYY-MM-DD" string as that calendar day's midnight *in `timeZone`* — the zoned counterpart of calendar-dates.ts's parseYMD. */
export function zonedParseYMD(s: string, timeZone: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(NaN);
  const [, y, mo, d] = m;
  return zonedWallTimeToUtc(Number(y), Number(mo), Number(d), 0, 0, timeZone);
}
