import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  addMonths,
  computeRange,
  formatDayLabel,
  formatMonthLabel,
  formatWeekRangeLabel,
  formatYMD,
  parseStartParam,
  parseViewParam,
  startOfWeekMonday,
  type CalendarView,
} from "@/lib/calendar-dates";
import { expandEvents } from "@/lib/recurrence";
import CalendarClient, { type CalendarEvent } from "./calendar/CalendarClient";

function viewSwitchTargets(
  view: CalendarView,
  start: Date,
): Record<CalendarView, string> {
  const dayStart = formatYMD(start);
  const weekStart = formatYMD(startOfWeekMonday(start));
  const monthStart = formatYMD(new Date(start.getFullYear(), start.getMonth(), 1));
  return {
    day: dayStart,
    week: weekStart,
    month: monthStart,
  };
}

function navTargets(view: CalendarView, start: Date): {
  prev: string;
  next: string;
  label: string;
} {
  if (view === "day") {
    return {
      prev: formatYMD(addDays(start, -1)),
      next: formatYMD(addDays(start, 1)),
      label: formatDayLabel(start),
    };
  }
  if (view === "week") {
    const ws = startOfWeekMonday(start);
    const we = addDays(ws, 6);
    return {
      prev: formatYMD(addDays(ws, -7)),
      next: formatYMD(addDays(ws, 7)),
      label: formatWeekRangeLabel(ws, we),
    };
  }
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  return {
    prev: formatYMD(addMonths(monthStart, -1)),
    next: formatYMD(addMonths(monthStart, 1)),
    label: formatMonthLabel(monthStart),
  };
}

function linkClass(active: boolean): string {
  return active
    ? "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 shadow-sm transition-colors dark:bg-zinc-800 dark:text-zinc-100"
    : "rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100";
}

export default async function Page(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const view = parseViewParam(sp?.view);
  const start = parseStartParam(sp?.start);

  const { from, to } = computeRange(view, start);

  const rows = await prisma.event.findMany({
    where: {
      OR: [
        // Proper interval overlap, not just "starts in range" — a
        // multi-day event (e.g. a synced all-day trip) that started
        // before this range but still overlaps it would otherwise be
        // missed entirely at the query level, before rendering even
        // gets a chance to draw it.
        { start: { lt: to }, end: { gt: from } },
        { recurrenceRule: { not: null } },
      ],
    },
    orderBy: { start: "asc" },
  });

  const ruleByMasterId = new Map(rows.map((r) => [r.id, r.recurrenceRule]));
  const lockedByMasterId = new Map(rows.map((r) => [r.id, r.locked]));
  const allDayByMasterId = new Map(rows.map((r) => [r.id, r.allDay]));
  const events: CalendarEvent[] = expandEvents(rows, from, to)
    .map((o) => ({
      id: o.id,
      masterId: o.masterId,
      title: o.title,
      start: o.start,
      end: o.end,
      isRecurring: o.isRecurring,
      recurrenceRule: ruleByMasterId.get(o.masterId) ?? null,
      locked: lockedByMasterId.get(o.masterId) ?? false,
      allDay: allDayByMasterId.get(o.masterId) ?? false,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const today = new Date();
  const todayISO = formatYMD(today);
  const startYMD = formatYMD(start);
  const nav = navTargets(view, start);
  const switchTargets = viewSwitchTargets(view, start);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/tasks"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Tasks
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <div className="w-16" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap items-center gap-1">
            <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
              <Link
                href={`/?view=day&start=${switchTargets.day}`}
                className={linkClass(view === "day")}
              >
                Day
              </Link>
              <Link
                href={`/?view=week&start=${switchTargets.week}`}
                className={linkClass(view === "week")}
              >
                Week
              </Link>
              <Link
                href={`/?view=month&start=${switchTargets.month}`}
                className={linkClass(view === "month")}
              >
                Month
              </Link>
            </div>
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
            <Link
              href={`/?view=${view}&start=${nav.prev}`}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              ← Prev
            </Link>
            <Link
              href={`/?view=${view}&start=${nav.next}`}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Next →
            </Link>
          </nav>
          <p className="text-sm text-zinc-500">{nav.label}</p>
        </div>
        <p className="text-xs text-zinc-400">
          Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> prev/next, <kbd>d</kbd>/
          <kbd>w</kbd>/<kbd>m</kbd> view, <kbd>t</kbd> today
        </p>
      </header>

      <CalendarClient
        view={view}
        startYMD={startYMD}
        todayISO={todayISO}
        events={events}
      />
    </main>
  );
}
