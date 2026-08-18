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
import CalendarClient, { type CalendarEvent } from "./CalendarClient";

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
    ? "rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
    : "rounded px-3 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100";
}

export default async function Page(props: PageProps<"/calendar">) {
  const sp = await props.searchParams;
  const view = parseViewParam(sp?.view);
  const start = parseStartParam(sp?.start);

  const { from, to } = computeRange(view, start);

  const eventsRaw = await prisma.event.findMany({
    where: { start: { gte: from, lt: to } },
    orderBy: { start: "asc" },
  });

  const events: CalendarEvent[] = eventsRaw.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
  }));

  const today = new Date();
  const todayISO = formatYMD(today);
  const startYMD = formatYMD(start);
  const nav = navTargets(view, start);
  const switchTargets = viewSwitchTargets(view, start);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Tasks
          </Link>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <div className="w-16" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-1">
            <Link
              href={`/calendar?view=day&start=${switchTargets.day}`}
              className={linkClass(view === "day")}
            >
              Day
            </Link>
            <Link
              href={`/calendar?view=week&start=${switchTargets.week}`}
              className={linkClass(view === "week")}
            >
              Week
            </Link>
            <Link
              href={`/calendar?view=month&start=${switchTargets.month}`}
              className={linkClass(view === "month")}
            >
              Month
            </Link>
            <span className="mx-2 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
            <Link
              href={`/calendar?view=${view}&start=${nav.prev}`}
              className="rounded px-3 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ← Prev
            </Link>
            <Link
              href={`/calendar?view=${view}&start=${nav.next}`}
              className="rounded px-3 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Next →
            </Link>
          </nav>
          <p className="text-sm text-zinc-500">{nav.label}</p>
        </div>
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
