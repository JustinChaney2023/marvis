import { getZonedDateParts, zonedWallTimeToUtc } from "./timezone";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
// "jan", "feb", ... "sept" — May has no short form distinct from its name.
const MONTH_PATTERN = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

export type ParsedQuickCapture = {
  title: string;
  dueAt: Date | null;
  // False when only a day was given ("tomorrow") — dueAt is then that
  // day at `dateOnlyHour`.
  hasTime: boolean;
  priority: number;
  durationMin: number | null;
  // Raw "#tag" text (hyphens/underscores read as spaces) — resolving it
  // to an actual Project row is the caller's job, since this stays pure.
  projectName: string | null;
};

type YMD = { year: number; month: number; day: number };

function addDays({ year, month, day }: YMD, n: number): YMD {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf({ year, month, day }: YMD): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * A small heuristic parser for quick-capture input, e.g.
 * "Call dentist tomorrow 3pm p2 #health 30m" ->
 *   { title: "Call dentist", dueAt: <tomorrow 3pm>, priority: 2, projectName: "health", durationMin: 30 }.
 * Deliberately narrow (no library). Understands:
 * - dates: today, tonight, tomorrow/tmrw, a weekday ("friday", "next friday"),
 *   "next week", "this weekend", "in N days/weeks", "nov 3"/"3 nov", "11/3"
 * - times: "3pm", "3:30pm", "at 15:00", "noon"
 * - priority: "p0".."p3" or "!" / "!!" / "!!!"
 * - duration: "for 30 min", "30m", "1h", "1.5h", "1h30m"
 * - project: "#name"
 * Anything it doesn't recognize is left alone in the title.
 *
 * With `timeZone`, "today"/"3pm" are that zone's wall clock (for server
 * callers acting on a user's behalf); without it, the JS runtime's own.
 * `dateOnlyHour` is the time a bare day ("friday") lands on — tasks pass
 * 17 (end of the working day, same as the task form's default) so
 * "due today" doesn't read as overdue from midnight.
 */
export function parseQuickCapture(
  input: string,
  now: Date = new Date(),
  timeZone?: string,
  dateOnlyHour = 0,
): ParsedQuickCapture {
  let text = ` ${input.trim()} `;
  const today: YMD = timeZone
    ? getZonedDateParts(now, timeZone)
    : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const toInstant = (d: YMD, hour: number, minute: number) =>
    timeZone
      ? zonedWallTimeToUtc(d.year, d.month, d.day, hour, minute, timeZone)
      : new Date(d.year, d.month - 1, d.day, hour, minute, 0, 0);

  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = text.match(re);
    if (m) text = removeMatch(text, m);
    return m;
  };

  let priority = 0;
  const priorityMatch = take(/\sp([0-3])(?=\s)/i);
  if (priorityMatch) {
    priority = Number(priorityMatch[1]);
  } else {
    const bangs = take(/\s(!{1,3})(?=\s)/);
    if (bangs) priority = bangs[1].length;
  }

  let projectName: string | null = null;
  const projectMatch = take(/\s#([\p{L}\p{N}][\p{L}\p{N}_-]*)(?=\s)/u);
  if (projectMatch) projectName = projectMatch[1].replace(/[-_]+/g, " ");

  // "for 30 min" / "for 1h" spelled out, or a bare "30m" / "1.5h" /
  // "1h30m" token. Bare tokens require the unit glued to the number so
  // "2 hour exam" in a title stays put.
  let durationMin: number | null = null;
  const forMatch = take(/\sfor (\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)(?=\s)/i);
  if (forMatch) {
    durationMin = toMinutes(Number(forMatch[1]), forMatch[2]);
  } else {
    const combo = take(/\s(\d+)h\s?(\d+)m(?:in)?(?=\s)/i);
    if (combo) {
      durationMin = Number(combo[1]) * 60 + Number(combo[2]);
    } else {
      const bare = take(/\s~?(\d+(?:\.\d+)?)(mins?|m|hrs?|h)(?=\s)/i);
      if (bare) durationMin = toMinutes(Number(bare[1]), bare[2]);
    }
  }

  let date: YMD | null = null;
  let defaultHour: number | null = null;

  const weekdayRe = WEEKDAYS.join("|");
  const inMatch = take(/\sin (\d+) (days?|weeks?)(?=\s)/i);
  if (inMatch) {
    const n = Number(inMatch[1]) * (inMatch[2].toLowerCase().startsWith("w") ? 7 : 1);
    date = addDays(today, n);
  }
  if (!date) {
    const m = take(new RegExp(`\\s(?:(?:on|by|due)\\s+)?next (${weekdayRe})(?=\\s)`, "i"));
    if (m) {
      // "next monday" from a Monday is a week out, never today.
      let delta = WEEKDAYS.indexOf(m[1].toLowerCase()) - weekdayOf(today);
      if (delta <= 0) delta += 7;
      date = addDays(today, delta);
    }
  }
  if (!date) {
    const m = take(new RegExp(`\\s(?:(?:on|by|due|this)\\s+)?(${weekdayRe})(?=\\s)`, "i"));
    if (m) {
      // A bare weekday is its next occurrence — today counts.
      let delta = WEEKDAYS.indexOf(m[1].toLowerCase()) - weekdayOf(today);
      if (delta < 0) delta += 7;
      date = addDays(today, delta);
    }
  }
  if (!date && take(/\snext week(?=\s)/i)) {
    let delta = 1 - weekdayOf(today);
    if (delta <= 0) delta += 7;
    date = addDays(today, delta);
  }
  if (!date && take(/\s(?:this )?weekend(?=\s)/i)) {
    const delta = (6 - weekdayOf(today) + 7) % 7;
    date = addDays(today, delta);
  }
  if (!date) {
    const monthFirst = take(new RegExp(`\\s(?:(?:on|by|due)\\s+)?(${MONTH_PATTERN})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, "i"));
    const dayFirst = monthFirst ? null : take(new RegExp(`\\s(?:(?:on|by|due)\\s+)?(\\d{1,2})(?:st|nd|rd|th)? (${MONTH_PATTERN})(?=\\s)`, "i"));
    const slash = monthFirst || dayFirst ? null : take(/\s(?:(?:on|by|due)\s+)?(\d{1,2})\/(\d{1,2})(?=\s)/);
    let month: number | null = null;
    let day: number | null = null;
    if (monthFirst) {
      month = monthIndex(monthFirst[1]);
      day = Number(monthFirst[2]);
    } else if (dayFirst) {
      month = monthIndex(dayFirst[2]);
      day = Number(dayFirst[1]);
    } else if (slash) {
      month = Number(slash[1]);
      day = Number(slash[2]);
    }
    if (month && day && month <= 12 && day <= 31) {
      // A date already past this year means next year's.
      const thisYear = { year: today.year, month, day };
      const isPast = month < today.month || (month === today.month && day < today.day);
      date = isPast ? { ...thisYear, year: today.year + 1 } : thisYear;
    }
  }
  if (!date && take(/\s(?:tomorrow|tmrw|tmr)(?=\s)/i)) {
    date = addDays(today, 1);
  }
  if (!date && take(/\stoday(?=\s)/i)) {
    date = today;
  }
  if (!date && take(/\stonight(?=\s)/i)) {
    date = today;
    defaultHour = 20;
  }

  let time: { hour: number; minute: number } | null = null;
  const meridiem = take(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const ampm = meridiem[3].toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    time = { hour, minute: meridiem[2] ? Number(meridiem[2]) : 0 };
  } else {
    const clock = take(/\s(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/);
    if (clock) {
      time = { hour: Number(clock[1]), minute: Number(clock[2]) };
    } else if (take(/\s(?:at\s+)?noon(?=\s)/i)) {
      time = { hour: 12, minute: 0 };
    }
  }
  if (!time && defaultHour !== null) time = { hour: defaultHour, minute: 0 };

  let dueAt: Date | null = null;
  if (time) {
    dueAt = toInstant(date ?? today, time.hour, time.minute);
  } else if (date) {
    dueAt = toInstant(date, dateOnlyHour, 0);
  }

  const title = text.replace(/\s{2,}/g, " ").trim();
  return { title, dueAt, hasTime: time !== null, priority, durationMin, projectName };
}

function toMinutes(amount: number, unit: string): number {
  return Math.round(unit.toLowerCase().startsWith("h") ? amount * 60 : amount);
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  return MONTHS.findIndex((m) => m.startsWith(lower.slice(0, 3))) + 1;
}

// Replaces with a single space (not "") — every pattern above anchors on
// the surrounding whitespace, so the neighbor tokens keep theirs.
function removeMatch(text: string, match: RegExpMatchArray): string {
  const index = match.index ?? -1;
  if (index < 0) return text;
  return text.slice(0, index) + " " + text.slice(index + match[0].length);
}
