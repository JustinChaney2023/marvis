export type CalendarView = "day" | "week" | "month";

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

export function defaultNewEventTimes(): { start: Date; end: Date } {
  const start = new Date();
  start.setSeconds(0, 0);
  const totalMin = start.getHours() * 60 + start.getMinutes();
  const rounded = Math.ceil(totalMin / 30) * 30;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  start.setHours(h, m, 0, 0);
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
