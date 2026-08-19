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

export function startOfWeekMonday(d: Date): Date {
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

export function formatHourLabel(hour24: number): string {
  const period = hour24 >= 12 ? "PM" : "AM";
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h12} ${period}`;
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
    const from = startOfWeekMonday(start);
    const to = addDays(from, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to, days };
  }
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const monthEnd = addDays(new Date(start.getFullYear(), start.getMonth() + 1, 1), -1);
  const from = startOfWeekMonday(monthStart);
  const to = addDays(startOfWeekMonday(monthEnd), 7);
  const days: Date[] = [];
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  return { from, to, days };
}

export const WEEKDAY_LABELS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dayWeekdayLabel(d: Date): string {
  return WEEKDAY_LABELS_MON_FIRST[(d.getDay() + 6) % 7];
}
