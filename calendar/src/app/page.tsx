import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser, getCurrentUser } from "@/lib/auth";
import Landing from "./Landing";
import {
  userTimeZone,
  zonedAddDays,
  zonedFormatYMD,
  zonedParseYMD,
  zonedStartOfDay,
  zonedStartOfMonth,
  zonedStartOfWeek,
} from "@/lib/timezone";
import MiniMonthPicker from "./MiniMonthPicker";
import CalendarSearch from "./calendar/CalendarSearch";
import ShortcutHint from "./ShortcutHint";
import {
  formatDayLabel,
  formatMonthLabel,
  formatWeekRangeLabel,
  parseViewParam,
  type CalendarView,
} from "@/lib/calendar-dates";
import { expandEvents, recurringOverlapping } from "@/lib/recurrence";
import { getAppSettings } from "@/lib/settings";
import { scheduleHabitsForWeek } from "@/lib/habits";
import CalendarClient, { type CalendarEvent, type SharedEvent } from "./calendar/CalendarClient";
import { NowProvider } from "./calendar/NowContext";
import { CalendarVisibilityProvider } from "./calendar/CalendarVisibilityContext";
import CalendarSidebarLeft from "./calendar/CalendarSidebarLeft";
import CalendarSidebarRight, {
  AttentionStrip,
  type AttentionTask,
  type UpcomingDay,
  type UpcomingItem,
} from "./calendar/CalendarSidebarRight";

// Everything below computes calendar-day boundaries and nav targets in the
// account's own timezone (`timeZone`), not the server host's — see the
// zonedStartOfDay/zonedAddDays/etc. comment in timezone.ts. This is a
// server component, so the JS engine's own "local" zone is the server
// host's, not the viewer's; using it directly (as calendar-dates.ts's
// plain helpers do, correctly, for client-side callers) silently
// misplaces anything within the UTC-offset gap of the account's real day.
function viewSwitchTargets(
  view: CalendarView,
  start: Date,
  timeZone: string,
): Record<CalendarView, string> {
  const dayStart = zonedFormatYMD(start, timeZone);
  const weekStart = zonedFormatYMD(zonedStartOfWeek(start, timeZone), timeZone);
  const monthStart = zonedFormatYMD(zonedStartOfMonth(start, timeZone), timeZone);
  return {
    day: dayStart,
    week: weekStart,
    month: monthStart,
  };
}

function navTargets(
  view: CalendarView,
  start: Date,
  timeZone: string,
): {
  prev: string;
  next: string;
  label: string;
} {
  if (view === "day") {
    return {
      prev: zonedFormatYMD(zonedAddDays(start, -1, timeZone), timeZone),
      next: zonedFormatYMD(zonedAddDays(start, 1, timeZone), timeZone),
      label: formatDayLabel(start, timeZone),
    };
  }
  if (view === "week") {
    const ws = zonedStartOfWeek(start, timeZone);
    const we = zonedAddDays(ws, 6, timeZone);
    return {
      prev: zonedFormatYMD(zonedAddDays(ws, -7, timeZone), timeZone),
      next: zonedFormatYMD(zonedAddDays(ws, 7, timeZone), timeZone),
      label: formatWeekRangeLabel(ws, we, timeZone),
    };
  }
  const monthStart = zonedStartOfMonth(start, timeZone);
  return {
    prev: zonedFormatYMD(zonedStartOfMonth(zonedAddDays(monthStart, -1, timeZone), timeZone), timeZone),
    next: zonedFormatYMD(zonedStartOfMonth(zonedAddDays(monthStart, 32, timeZone), timeZone), timeZone),
    label: formatMonthLabel(monthStart, timeZone),
  };
}

/** Zoned counterpart of calendar-dates.ts's computeRange — see the file-top comment. */
function zonedComputeRange(
  view: CalendarView,
  start: Date,
  timeZone: string,
): { from: Date; to: Date; days: Date[] } {
  if (view === "day") {
    const from = zonedStartOfDay(start, timeZone);
    const to = zonedAddDays(from, 1, timeZone);
    return { from, to, days: [from] };
  }
  if (view === "week") {
    const from = zonedStartOfWeek(start, timeZone);
    const to = zonedAddDays(from, 7, timeZone);
    const days = Array.from({ length: 7 }, (_, i) => zonedAddDays(from, i, timeZone));
    return { from, to, days };
  }
  const monthStart = zonedStartOfMonth(start, timeZone);
  const nextMonthStart = zonedStartOfMonth(zonedAddDays(monthStart, 32, timeZone), timeZone);
  const monthEnd = zonedAddDays(nextMonthStart, -1, timeZone);
  const from = zonedStartOfWeek(monthStart, timeZone);
  const to = zonedAddDays(zonedStartOfWeek(monthEnd, timeZone), 7, timeZone);
  const days: Date[] = [];
  for (let d = from; d < to; d = zonedAddDays(d, 1, timeZone)) {
    days.push(d);
  }
  return { from, to, days };
}

function linkClass(active: boolean): string {
  return active
    ? "rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-paper transition-colors"
    : "rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink";
}

export default async function Page(props: PageProps<"/">) {
  // Signed-out visitors get the public landing page (also what Google's
  // OAuth review checks as the app's home page).
  if (!(await getCurrentUser())) return <Landing />;
  const user = await requireUser();
  // Opportunistic top-up on every dashboard load, not just on habit
  // create/toggle — no-ops (cheap: a handful of counts/queries) once every
  // habit is at quota for the next few weeks, so it's safe to run on
  // every render rather than needing a dedicated cron.
  await scheduleHabitsForWeek(user.id);
  const timeZone = userTimeZone(user);
  const sp = await props.searchParams;
  const view = parseViewParam(sp?.view);
  const startParam = Array.isArray(sp?.start) ? sp.start[0] : sp?.start;
  const start = startParam ? zonedParseYMD(startParam, timeZone) : zonedStartOfDay(new Date(), timeZone);
  const resolvedStart = Number.isNaN(start.getTime()) ? zonedStartOfDay(new Date(), timeZone) : start;

  const { from, to } = zonedComputeRange(view, resolvedStart, timeZone);

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
        recurringOverlapping(from, to),
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
  const taskIdByEventMasterId = new Map(rows.map((r) => [r.id, r.task?.id ?? null]));
  const taskStatusByMasterId = new Map(rows.map((r) => [r.id, r.task?.status ?? null]));
  const meetingUrlByMasterId = new Map(rows.map((r) => [r.id, r.meetingUrl]));
  const eventTypeByMasterId = new Map(rows.map((r) => [r.id, r.eventType]));
  const reminderMinutesByMasterId = new Map(rows.map((r) => [r.id, r.reminderMinutes]));
  const notesByMasterId = new Map(rows.map((r) => [r.id, r.notes]));
  const locationByMasterId = new Map(rows.map((r) => [r.id, r.location]));
  const googleCalendarIdByMasterId = new Map(rows.map((r) => [r.id, r.googleCalendarId]));
  const calendarKeyByMasterId = new Map(
    rows.map((r) => [
      r.id,
      r.subscriptionId
        ? `sub:${r.subscriptionId}`
        : r.taskId
          ? "tasks"
          : r.habitId
            ? "habits"
            : "events",
    ]),
  );
  const events: CalendarEvent[] = expandEvents(rows, from, to, userTimeZone(user))
    .map((o) => ({
      id: o.id,
      masterId: o.masterId,
      title: o.title,
      notes: notesByMasterId.get(o.masterId) ?? null,
      location: locationByMasterId.get(o.masterId) ?? null,
      start: o.start,
      end: o.end,
      isRecurring: o.isRecurring,
      recurrenceRule: ruleByMasterId.get(o.masterId) ?? null,
      locked: lockedByMasterId.get(o.masterId) ?? false,
      allDay: allDayByMasterId.get(o.masterId) ?? false,
      projectColor: colorByMasterId.get(o.masterId) ?? null,
      taskPriority: priorityByMasterId.get(o.masterId) ?? null,
      taskId: taskIdByEventMasterId.get(o.masterId) ?? null,
      taskStatus: taskStatusByMasterId.get(o.masterId) ?? null,
      meetingUrl: meetingUrlByMasterId.get(o.masterId) ?? null,
      eventType: eventTypeByMasterId.get(o.masterId) ?? "DEFAULT",
      reminderMinutes: reminderMinutesByMasterId.get(o.masterId) ?? null,
      googleCalendarId: googleCalendarIdByMasterId.get(o.masterId) ?? null,
      calendarKey: calendarKeyByMasterId.get(o.masterId) ?? "events",
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Calendars shared with me (view-only overlay) — same visible range as
  // my own events above. BUSY_ONLY drops the title/notes entirely rather
  // than filtering client-side, so a real title never even reaches the
  // browser for a calendar that's only supposed to show as "Busy".
  // For EventModal's "Sync to" per-event override — only relevant once
  // someone's subscribed 2+ calendars (see CalendarClient/EventModal).
  const googleCalendarRows = await prisma.googleCalendar.findMany({
    where: { googleAccount: { userId: user.id } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, summary: true, googleAccount: { select: { label: true } } },
  });
  const googleCalendars = googleCalendarRows.map((c) => ({
    id: c.id,
    label: `${c.summary} (${c.googleAccount.label})`,
  }));

  // Sidebar's "My calendars" / "Other calendars" checklist (CalendarSidebarLeft)
  // — subscriptions get one row each, habits only show a row when any exist.
  const subscriptions = await prisma.calendarSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const hasHabits = (await prisma.habit.count({ where: { userId: user.id } })) > 0;

  const shares = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id, hiddenByRecipient: false },
    include: { owner: { select: { id: true, name: true, email: true, timezone: true } } },
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
                  recurringOverlapping(from, to),
                ],
              },
            });
            const ownerLabel = share.owner.name ?? share.owner.email;
            const allDayById = new Map(ownerRows.map((r) => [r.id, r.allDay]));
            return expandEvents(ownerRows, from, to, userTimeZone(share.owner)).map((o) => ({
              id: `${share.ownerId}:${o.id}`,
              start: o.start,
              end: o.end,
              allDay: allDayById.get(o.masterId) ?? false,
              title: share.permission === "FULL_DETAILS" ? o.title : "Busy",
              ownerLabel,
            }));
          }),
        )
      ).flat()
    : [];

  const today = new Date();
  const todayISO = zonedFormatYMD(today, timeZone);
  const startYMD = zonedFormatYMD(resolvedStart, timeZone);
  const nav = navTargets(view, resolvedStart, timeZone);
  const switchTargets = viewSwitchTargets(view, resolvedStart, timeZone);

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
  // Scheduled tasks whose plan finishes after their deadline (next 2 weeks).
  const scheduledWithDeadline = await prisma.task.findMany({
    where: {
      userId: user.id,
      parentId: null,
      status: { in: ["CREATED", "ONGOING"] },
      events: { some: {} },
      dueAt: { gte: today, lt: new Date(today.getTime() + 14 * 86_400_000) },
    },
    select: { id: true, title: true, dueAt: true, events: { select: { end: true } } },
  });
  const lateRows = scheduledWithDeadline.filter((t) => t.events.some((e) => e.end > t.dueAt!));
  const attentionTasks: AttentionTask[] = [
    ...lateRows.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt!, isOverdue: false, isLate: true })),
    ...attentionRows.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt!,
      isOverdue: t.dueAt! < today,
    })),
  ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

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
  const agendaStart = zonedStartOfDay(today, timeZone);
  const agendaEnd = zonedAddDays(agendaStart, UPCOMING_AGENDA_DAYS, timeZone);
  const upcomingRows = await prisma.event.findMany({
    where: {
      userId: user.id,
      OR: [
        { start: { lt: agendaEnd }, end: { gt: agendaStart } },
        recurringOverlapping(agendaStart, agendaEnd),
      ],
    },
    include: { task: { select: { id: true } } },
    orderBy: { start: "asc" },
  });
  const taskIdByMasterId = new Map(upcomingRows.map((r) => [r.id, r.task?.id ?? null]));
  const lockedByUpcomingMasterId = new Map(upcomingRows.map((r) => [r.id, r.locked]));
  const upcomingByDay = new Map<string, UpcomingItem[]>();
  for (const o of expandEvents(upcomingRows, agendaStart, agendaEnd, timeZone)) {
    const dayKey = zonedFormatYMD(o.start, timeZone);
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
    const day = zonedAddDays(agendaStart, i, timeZone);
    const dayKey = zonedFormatYMD(day, timeZone);
    return {
      dayKey,
      dayLabel: dayKey === todayISO ? "Today" : formatDayLabel(day, timeZone),
      items: (upcomingByDay.get(dayKey) ?? []).sort(
        (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime(),
      ),
    };
  }).filter((d) => d.items.length > 0);

  const settings = await getAppSettings(user.id);
  let todayPlannedMinutes: number | null = null;
  if (settings.dailyCapMin) {
    const dayStart = zonedStartOfDay(today, timeZone);
    const dayEnd = zonedAddDays(dayStart, 1, timeZone);
    const todayRows = await prisma.event.findMany({
      where: {
        userId: user.id,
        OR: [{ start: { lt: dayEnd }, end: { gt: dayStart } }, recurringOverlapping(dayStart, dayEnd)],
      },
    });
    todayPlannedMinutes = expandEvents(todayRows, dayStart, dayEnd, timeZone).reduce(
      (sum, o) => sum + (o.end.getTime() - o.start.getTime()) / 60_000,
      0,
    );
  }

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col px-3 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-4 print:h-auto">
      <header className="flex flex-col gap-3">
        <p className="hidden text-lg font-semibold print:block">{nav.label}</p>
        <div className="flex flex-wrap-reverse items-center justify-between gap-2 sm:flex-wrap sm:gap-3 print:hidden">
          <nav className="flex flex-wrap items-center gap-1">
            <div className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper p-1">
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
            <span className="mx-1 h-5 w-px bg-rule" />
            <Link
              href={`/?view=${view}&start=${nav.prev}`}
              aria-label="Previous"
              className="rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-rule-soft hover:text-ink"
            >
              ←<span className="hidden sm:inline"> Prev</span>
            </Link>
            <Link
              href={`/?view=${view}`}
              className="rounded-full px-2 py-1.5 text-sm text-ink-2 transition-colors hover:bg-rule-soft hover:text-ink"
            >
              Today
            </Link>
            <Link
              href={`/?view=${view}&start=${nav.next}`}
              aria-label="Next"
              className="rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-rule-soft hover:text-ink"
            >
              <span className="hidden sm:inline">Next </span>→
            </Link>
          </nav>
          <div className="flex items-center gap-1">
            <CalendarSearch view={view} />
            <p className="font-serif text-lg text-ink">{nav.label}</p>
            <MiniMonthPicker view={view} startYMD={startYMD} />
          </div>
        </div>
        <ShortcutHint />
      </header>

      <div className="mt-3 xl:hidden print:hidden">
        <AttentionStrip tasks={attentionTasks} />
      </div>

      <NowProvider>
      <CalendarVisibilityProvider>
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-5 print:block xl:grid-cols-[1fr_13rem] 2xl:grid-cols-[11rem_1fr_13rem]">
          {/* Every column here needs `overflow` set (not just `visible`)
              or its natural content height becomes an input to the grid
              row's own auto-sizing — one tall column would stretch the
              whole row, and with it the page, right back to the
              full-page scroll this layout exists to avoid. `no-scrollbar`
              hides the resulting scroll track everywhere except the
              calendar's own .calendar-scroll (that one's a real,
              deliberately visible/styled scroll surface — see
              CalendarClient — not just structural overflow control).
              Two breakpoints, not one: the persistent left SideRail
              (layout.tsx) permanently eats 11rem of viewport width now,
              so the old single `lg` threshold squeezed the hour grid
              into a horizontal scroll well before the page felt full —
              the "needs attention" rail earns its keep sooner than the
              mini-calendar does, so it appears first. */}
          <aside className="no-scrollbar hidden overflow-y-auto print:hidden 2xl:block">
            <CalendarSidebarLeft
              view={view}
              startYMD={startYMD}
              hasHabits={hasHabits}
              subscriptions={subscriptions}
            />
          </aside>

          <div className="no-scrollbar flex min-h-0 min-w-0 flex-col overflow-y-auto">
            <CalendarClient
              view={view}
              startYMD={startYMD}
              todayISO={todayISO}
              events={events}
              sharedEvents={sharedEvents}
              secondaryTimezone={settings.secondaryTimezone}
              googleCalendars={googleCalendars}
            />
          </div>

          <aside className="no-scrollbar hidden overflow-y-auto print:hidden xl:block">
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
      </CalendarVisibilityProvider>
      </NowProvider>
    </main>
  );
}
