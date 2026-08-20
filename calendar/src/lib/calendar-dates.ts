export type CalendarView = "day" | "week" | "month";

// The hour-grid's visible window (day/week views in CalendarClient.tsx)
// and the default new-event time (below) share these bounds — an event
// created outside this range would exist in the DB but render nowhere on
// the grid, which is exactly the bug that motivated sharing them here
// instead of each place hardcoding its own 6/22.
export const HOUR_START = 0;
export const HOUR_END = 24;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date): Date {
  const sunday = startOfDay(d);
  sunday.setDate(sunday.getDate() - d.getDay());
  return sunday;
}

// Work-week Monday (independent of startOfWeek's display convention
// above) — only used by fridayOfWeek below, whose "This week"/"Next
// week" quick-picks mean "by end of the Mon-Fri work week" regardless of
// which day the calendar itself starts its columns on.
function mondayOfWorkWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  const monday = startOfDay(d);
  monday.setDate(monday.getDate() - offset);
  return monday;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYMD(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// True if an event overlaps the 24h span containing `day` at all — used
// for all-day/multi-day events, which should show on every day they
// span, not just the one isSameDay(event.start, day) matches.
export function overlapsDay(event: { start: Date; end: Date }, day: Date): boolean {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return event.start < dayEnd && event.end > dayStart;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export const WEEKDAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Cells for a month grid: null for the leading blanks before day 1. */
export function buildMonthGrid(monthDate: Date): (Date | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0=Sun
  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

export type QuickPickOption = { label: string; date: Date };

function fridayOfWeek(d: Date): Date {
  return addDays(mondayOfWorkWeek(d), 4);
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/**
 * Deadline quick-picks for DatePicker's popup (Motion's date-picker
 * shortcuts: Today/Tomorrow/This week/etc). The weekly/monthly ones land
 * on the work-week's last day (Friday) or a month's last day rather than
 * "+7 days" — a deadline quick-pick means "by the end of that period,"
 * and this mirrors the same Mon-Fri work week the scheduler itself
 * assumes (scheduler.ts's isWorkDay).
 */
export function getQuickPickOptions(today: Date): QuickPickOption[] {
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "This week", date: fridayOfWeek(today) },
    { label: "7 days from now", date: addDays(today, 7) },
    { label: "Next week", date: fridayOfWeek(addDays(today, 7)) },
    { label: "In 2 weeks", date: fridayOfWeek(addDays(today, 14)) },
    { label: "This month", date: lastDayOfMonth(today) },
    { label: "Next month", date: lastDayOfMonth(addMonths(today, 1)) },
  ];
}

// "Aug 31, 5:00 PM" — a due date/time is always shown together (unlike
// a plain calendar date), so this pairs formatTime with a short month +
// day. `toLocaleString()`'s default includes the year and seconds
// ("8/31/2026, 5:00:00 PM"), which is noisier than a task row needs.
export function formatDueDateTime(d: Date): string {
  const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${datePart}, ${formatTime(d)}`;
}

export function formatHourLabel(hour24: number): string {
  const period = hour24 >= 12 ? "PM" : "AM";
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h12} ${period}`;
}

/**
 * Renders `hour24` on `day` (this app's implicit local timezone) as a
 * time-of-day string in `timeZone` instead — the world-clock second
 * gutter column (#37). Uses `day` as the reference date for the
 * conversion, so it's correctly DST-aware for that specific date even
 * though the hour grid's ticks themselves are date-independent.
 */
export function formatHourLabelInZone(day: Date, hour24: number, timeZone: string): string {
  const reference = new Date(day);
  reference.setHours(hour24, 0, 0, 0);
  // Always includes minutes (not just on the hour) since some zones sit
  // at a half/quarter-hour offset (e.g. India, +5:30) from this app's
  // local time.
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(reference);
}

export function formatDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function formatWeekRangeLabel(start: Date, end: Date): string {
  const startStr = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const endStr = sameMonth
    ? end.getDate().toString()
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(end);
  return `${startStr} – ${endStr}, ${start.getFullYear()}`;
}

export function formatMonthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(d);
}

export function toLocalInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function defaultNewEventTimes(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const totalMin = start.getHours() * 60 + start.getMinutes();
  const rounded = Math.ceil(totalMin / 30) * 30;
  if (rounded >= 1440) {
    // Rounding up crossed midnight (e.g. 23:45 -> 24:00) — advance the
    // date first, then set 00:00, rather than `% 24`ing the hour back
    // down to 0 on the SAME day, which silently created an event ~24h in
    // the past (00:00 today instead of 00:00 tomorrow) for anything in
    // the last 29 minutes before midnight.
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setHours(Math.floor(rounded / 60), rounded % 60, 0, 0);
  }

  // Clamp into the grid's visible window — otherwise "+ New event" at,
  // say, 4am creates a real event that simply never renders anywhere on
  // the hour grid (outside HOUR_START-HOUR_END), which looked exactly
  // like a broken create when caught by an end-to-end test run overnight.
  if (start.getHours() < HOUR_START) {
    start.setHours(HOUR_START, 0, 0, 0);
  } else if (start.getHours() >= HOUR_END) {
    start.setDate(start.getDate() + 1);
    start.setHours(HOUR_START, 0, 0, 0);
  }

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);
  return { start, end };
}

export function parseViewParam(v: string | string[] | undefined): CalendarView {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "day" || s === "month") return s;
  return "week";
}

export function parseStartParam(v: string | string[] | undefined): Date {
  const s = Array.isArray(v) ? v[0] : v;
  if (s) {
    const d = parseYMD(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function computeRange(view: CalendarView, start: Date): {
  from: Date;
  to: Date;
  days: Date[];
} {
  if (view === "day") {
    const from = startOfDay(start);
    const to = addDays(from, 1);
    return { from, to, days: [from] };
  }
  if (view === "week") {
    const from = startOfWeek(start);
    const to = addDays(from, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to, days };
  }
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const monthEnd = addDays(new Date(start.getFullYear(), start.getMonth() + 1, 1), -1);
  const from = startOfWeek(monthStart);
  const to = addDays(startOfWeek(monthEnd), 7);
  const days: Date[] = [];
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  return { from, to, days };
}

export const WEEKDAY_LABELS_SUN_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayWeekdayLabel(d: Date): string {
  return WEEKDAY_LABELS_SUN_FIRST[d.getDay()];
}
