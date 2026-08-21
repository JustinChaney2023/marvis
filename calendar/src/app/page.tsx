import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import MiniMonthPicker from "./MiniMonthPicker";
import CalendarSearch from "./calendar/CalendarSearch";
import {
  addDays,
  addMonths,
  computeRange,
  formatDayLabel,
  formatMonthLabel,
  formatWeekRangeLabel,
  formatYMD,
  isSameDay,
  parseStartParam,
  parseViewParam,
  startOfWeek,
  type CalendarView,
} from "@/lib/calendar-dates";
import { expandEvents } from "@/lib/recurrence";
import { getAppSettings } from "@/lib/settings";
import CalendarClient, { type CalendarEvent, type SharedEvent } from "./calendar/CalendarClient";
import { NowProvider } from "./calendar/NowContext";
import CalendarSidebarLeft from "./calendar/CalendarSidebarLeft";
import CalendarSidebarRight, {
  type AttentionTask,
  type UpcomingDay,
  type UpcomingItem,
} from "./calendar/CalendarSidebarRight";

function viewSwitchTargets(
  view: CalendarView,
  start: Date,
): Record<CalendarView, string> {
  const dayStart = formatYMD(start);
  const weekStart = formatYMD(startOfWeek(start));
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
    const ws = startOfWeek(start);
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
    ? "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 shadow-sm transition-colors dark:bg-zinc-700 dark:text-zinc-100"
    : "rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100";
}

export default async function Page(props: PageProps<"/">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const view = parseViewParam(sp?.view);
  const start = parseStartParam(sp?.start);

  const { from, to } = computeRange(view, start);

  const rows = await prisma.event.findMany({
    where: {
      userId: user.id,
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
    include: { task: { include: { project: true } } },
    orderBy: { start: "asc" },
  });

  const ruleByMasterId = new Map(rows.map((r) => [r.id, r.recurrenceRule]));
  const lockedByMasterId = new Map(rows.map((r) => [r.id, r.locked]));
  const allDayByMasterId = new Map(rows.map((r) => [r.id, r.allDay]));
  const colorByMasterId = new Map(
    rows.map((r) => [r.id, r.color ?? r.task?.color ?? r.task?.project?.color ?? null]),
  );
  const priorityByMasterId = new Map(rows.map((r) => [r.id, r.task?.priority ?? null]));
  const meetingUrlByMasterId = new Map(rows.map((r) => [r.id, r.meetingUrl]));
  const eventTypeByMasterId = new Map(rows.map((r) => [r.id, r.eventType]));
  const reminderMinutesByMasterId = new Map(rows.map((r) => [r.id, r.reminderMinutes]));
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
      projectColor: colorByMasterId.get(o.masterId) ?? null,
      taskPriority: priorityByMasterId.get(o.masterId) ?? null,
      meetingUrl: meetingUrlByMasterId.get(o.masterId) ?? null,
      eventType: eventTypeByMasterId.get(o.masterId) ?? "DEFAULT",
      reminderMinutes: reminderMinutesByMasterId.get(o.masterId) ?? null,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Calendars shared with me (view-only overlay) — same visible range as
  // my own events above. BUSY_ONLY drops the title/notes entirely rather
  // than filtering client-side, so a real title never even reaches the
  // browser for a calendar that's only supposed to show as "Busy".
  const shares = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
  const sharedEvents: SharedEvent[] = shares.length
    ? (
        await Promise.all(
          shares.map(async (share) => {
            const ownerRows = await prisma.event.findMany({
              where: {
                userId: share.ownerId,
                OR: [
                  { start: { lt: to }, end: { gt: from } },
                  { recurrenceRule: { not: null } },
                ],
              },
            });
            const ownerLabel = share.owner.name ?? share.owner.email;
            return expandEvents(ownerRows, from, to).map((o) => ({
              id: `${share.ownerId}:${o.id}`,
              start: o.start,
              end: o.end,
              allDay: ownerRows.find((r) => r.id === o.masterId)?.allDay ?? false,
              title: share.permission === "FULL_DETAILS" ? o.title : "Busy",
              ownerLabel,
            }));
          }),
        )
      ).flat()
    : [];

  const today = new Date();
  const todayISO = formatYMD(today);
  const startYMD = formatYMD(start);
  const nav = navTargets(view, start);
  const switchTargets = viewSwitchTargets(view, start);

  // Right sidebar's "needs attention" list — same overdue/due-soon-and-
  // unscheduled definition TaskRow uses, computed here instead since this
  // is a server component with no client-side "now" to react to.
  const soonThreshold = new Date(today.getTime() + 48 * 60 * 60 * 1000);
  const attentionRows = await prisma.task.findMany({
    where: {
      userId: user.id,
      parentId: null,
      status: { in: ["CREATED", "ONGOING"] },
      events: { none: {} },
      dueAt: { lt: soonThreshold },
    },
    orderBy: { dueAt: "asc" },
    take: 6,
    select: { id: true, title: true, dueAt: true },
  });
  const attentionTasks: AttentionTask[] = attentionRows.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt!,
    isOverdue: t.dueAt! < today,
  }));

  // Overcommitment warning — a visible nudge (Sunsama-style) distinct
  // from dailyCapMin's existing job of silently gating the auto-
  // scheduler. Same threshold, different purpose: this fires the moment
  // *manually* planned time for today crosses it, whatever view you're
  // actually browsing.
  // Right sidebar's day-grouped agenda — independent of whatever range
  // the main grid is currently showing (day/week/month), always "the
  // next UPCOMING_AGENDA_DAYS days" so it's a stable place to glance at
  // what's coming up regardless of which view you're browsing.
  // A full week — CalendarSidebarRight now lets each day collapse
  // (all but today start collapsed), so a longer window no longer
  // forces the sidebar taller than the calendar next to it.
  const UPCOMING_AGENDA_DAYS = 7;
  const agendaStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const agendaEnd = new Date(agendaStart.getTime() + UPCOMING_AGENDA_DAYS * 86_400_000);
  const upcomingRows = await prisma.event.findMany({
    where: {
      userId: user.id,
      OR: [
        { start: { lt: agendaEnd }, end: { gt: agendaStart } },
        { recurrenceRule: { not: null } },
      ],
    },
    include: { task: { select: { id: true } } },
    orderBy: { start: "asc" },
  });
  const taskIdByMasterId = new Map(upcomingRows.map((r) => [r.id, r.task?.id ?? null]));
  const lockedByUpcomingMasterId = new Map(upcomingRows.map((r) => [r.id, r.locked]));
  const upcomingByDay = new Map<string, UpcomingItem[]>();
  for (const o of expandEvents(upcomingRows, agendaStart, agendaEnd)) {
    const dayKey = formatYMD(o.start);
    const list = upcomingByDay.get(dayKey) ?? [];
    const taskId = taskIdByMasterId.get(o.masterId) ?? null;
    list.push({
      id: o.id,
      // The real DB event row id — o.id is synthetic for a recurring
      // occurrence (`${masterId}::${iso}`), but editing always acts on
      // the series/row itself.
      eventId: o.masterId,
      title: o.title,
      startIso: o.start.toISOString(),
      endIso: o.end.toISOString(),
      isTask: taskId !== null,
      taskId,
      locked: lockedByUpcomingMasterId.get(o.masterId) ?? false,
    });
    upcomingByDay.set(dayKey, list);
  }
  const upcomingDays: UpcomingDay[] = Array.from({ length: UPCOMING_AGENDA_DAYS }, (_, i) => {
    const day = addDays(agendaStart, i);
    const dayKey = formatYMD(day);
    return {
      dayKey,
      dayLabel: isSameDay(day, today) ? "Today" : formatDayLabel(day),
      items: (upcomingByDay.get(dayKey) ?? []).sort(
        (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime(),
      ),
    };
  }).filter((d) => d.items.length > 0);

  const settings = await getAppSettings(user.id);
  let todayPlannedMinutes: number | null = null;
  if (settings.dailyCapMin) {
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const todayRows = await prisma.event.findMany({
      where: {
        userId: user.id,
        OR: [{ start: { lt: dayEnd }, end: { gt: dayStart } }, { recurrenceRule: { not: null } }],
      },
    });
    todayPlannedMinutes = expandEvents(todayRows, dayStart, dayEnd).reduce(
      (sum, o) => sum + (o.end.getTime() - o.start.getTime()) / 60_000,
      0,
    );
  }

  return (
    <main className="mx-auto w-full max-w-[96rem] flex-1 px-6 pb-12 pt-4">
      <header className="flex flex-col gap-3">
        <p className="hidden text-lg font-semibold print:block">{nav.label}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <nav className="flex flex-wrap items-center gap-1">
            <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-800">
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
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <Link
              href={`/?view=${view}&start=${nav.prev}`}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            >
              ← Prev
            </Link>
            <Link
              href={`/?view=${view}&start=${nav.next}`}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            >
              Next →
            </Link>
          </nav>
          <div className="flex items-center gap-1">
            <CalendarSearch view={view} />
            <p className="text-sm text-zinc-500">{nav.label}</p>
            <MiniMonthPicker view={view} startYMD={startYMD} />
          </div>
        </div>
        <p className="text-xs text-zinc-400 print:hidden">
          Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> prev/next, <kbd>d</kbd>/
          <kbd>w</kbd>/<kbd>m</kbd> view, <kbd>t</kbd> today, <kbd>?</kbd> all
          shortcuts
        </p>
      </header>

      <NowProvider>
        <div className="mt-3 grid grid-cols-1 gap-6 print:block lg:grid-cols-[13rem_1fr_15rem]">
          <aside className="hidden print:hidden lg:block">
            <CalendarSidebarLeft view={view} startYMD={startYMD} />
          </aside>

          <div className="min-w-0">
            <CalendarClient
              view={view}
              startYMD={startYMD}
              todayISO={todayISO}
              events={events}
              sharedEvents={sharedEvents}
              secondaryTimezone={settings.secondaryTimezone}
            />
          </div>

          <aside className="hidden print:hidden lg:block">
            <CalendarSidebarRight
              tasks={attentionTasks}
              upcomingDays={upcomingDays}
              overcommitment={
                settings.dailyCapMin && todayPlannedMinutes !== null
                  ? { plannedMinutes: todayPlannedMinutes, capMinutes: settings.dailyCapMin }
                  : null
              }
            />
          </aside>
        </div>
      </NowProvider>
    </main>
  );
}
