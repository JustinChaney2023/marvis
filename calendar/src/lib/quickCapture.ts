const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export type ParsedQuickCapture = {
  title: string;
  dueAt: Date | null;
  priority: number;
  durationMin: number | null;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * A small heuristic parser for quick-capture input, e.g.
 * "Call dentist tomorrow 3pm p2" -> { title: "Call dentist", dueAt: <tomorrow 3pm>, priority: 2 }.
 * Deliberately narrow (no library): today/tomorrow, "next <weekday>", "in N
 * days", and a trailing clock time, plus a "p0".."p3" priority shorthand.
 * Anything it doesn't recognize is left alone in the title.
 */
export function parseQuickCapture(
  input: string,
  now: Date = new Date(),
): ParsedQuickCapture {
  let text = input.trim();
  let dueAt: Date | null = null;
  let priority = 0;

  const priorityMatch = text.match(/\bp([0-3])\b/i);
  if (priorityMatch) {
    priority = Number(priorityMatch[1]);
    text = removeMatch(text, priorityMatch);
  }

  // "for 30 min" / "for 1h" — an explicit duration, used by the
  // quick-add-event mode (#38). Unambiguous "for ..." phrasing so it
  // doesn't collide with the date/time matches below.
  let durationMin: number | null = null;
  const durationMatch = text.match(/\bfor (\d+)\s*(min|m|hour|hr|h)\b/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    durationMin = unit.startsWith("h") ? amount * 60 : amount;
    text = removeMatch(text, durationMatch);
  }

  let dateBase: Date | null = null;

  const inDaysMatch = text.match(/\bin (\d+) days?\b/i);
  const nextWeekdayMatch = text.match(
    new RegExp(`\\bnext (${WEEKDAYS.join("|")})\\b`, "i"),
  );
  const tomorrowMatch = text.match(/\btomorrow\b/i);
  const todayMatch = text.match(/\btoday\b/i);

  if (inDaysMatch) {
    dateBase = addDays(startOfDay(now), Number(inDaysMatch[1]));
    text = removeMatch(text, inDaysMatch);
  } else if (nextWeekdayMatch) {
    const targetDay = WEEKDAYS.indexOf(nextWeekdayMatch[1].toLowerCase());
    const currentDay = now.getDay();
    let delta = targetDay - currentDay;
    if (delta <= 0) delta += 7;
    dateBase = addDays(startOfDay(now), delta);
    text = removeMatch(text, nextWeekdayMatch);
  } else if (tomorrowMatch) {
    dateBase = addDays(startOfDay(now), 1);
    text = removeMatch(text, tomorrowMatch);
  } else if (todayMatch) {
    dateBase = startOfDay(now);
    text = removeMatch(text, todayMatch);
  }

  const timeMatch = text.match(/(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const base = dateBase ?? startOfDay(now);
    dueAt = new Date(base);
    dueAt.setHours(hour, minute, 0, 0);
    text = removeMatch(text, timeMatch);
  } else if (dateBase) {
    dueAt = dateBase;
  }

  const title = text.replace(/\s{2,}/g, " ").trim();
  return { title, dueAt, priority, durationMin };
}

function removeMatch(text: string, match: RegExpMatchArray): string {
  const index = match.index ?? -1;
  if (index < 0) return text;
  return text.slice(0, index) + text.slice(index + match[0].length);
}
