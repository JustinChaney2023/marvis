import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";

const DAY_MS = 86_400_000;
const DAY_WIDTH_PX = 32;
const ROW_HEIGHT_PX = 32;
// Bars with no real duration (a bare due date, or a due date in the
// past relative to the task's creation) still need to render as
// something visible rather than a zero-width sliver.
const MIN_BAR_DAYS = 1;

// Derived from the shared palette rather than a second literal copy —
// PROJECT_EVENT_COLORS.ts already has every color's literal class string
// written out, which is all Tailwind's scanner needs; it doesn't need to
// appear again at each usage site.
const PROJECT_BAR_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_EVENT_COLORS).map(([color, c]) => [color, c.dot]),
);

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

const WEEK_MS = 7 * DAY_MS;

export default async function GanttPage() {
  const user = await requireUser();

  const weekAgo = new Date(Date.now() - WEEK_MS);
  const recentLogs = await prisma.timeLogEntry.findMany({
    where: { userId: user.id, loggedAt: { gte: weekAgo } },
    include: { task: { include: { project: true } } },
  });
  const minutesByProjectName = new Map<string, number>();
  let untrackedMinutes = 0;
  for (const log of recentLogs) {
    const name = log.task.project?.name ?? null;
    if (name) {
      minutesByProjectName.set(name, (minutesByProjectName.get(name) ?? 0) + log.minutes);
    } else {
      untrackedMinutes += log.minutes;
    }
  }
  const trackedReport = [...minutesByProjectName.entries()].sort((a, b) => b[1] - a[1]);

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: {
      tasks: {
        where: { status: { not: "DONE" }, parentId: null },
        include: { events: true },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      },
    },
  });

  type Bar = { taskId: string; title: string; start: Date; end: Date };
  const projectBars: { id: string; name: string; color: string; bars: Bar[] }[] =
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bars: p.tasks
        .map((t) => {
          // Prefer the actual scheduled slot(s); otherwise a span from
          // the task's start date (or creation date, if it has none) to
          // due date. A chunked task's bar spans its earliest chunk's
          // start to its latest chunk's end — one bar per task, not one
          // per chunk, same as a Gantt bar always has been here.
          if (t.events.length > 0) {
            const start = t.events.reduce((min, e) => (e.start < min ? e.start : min), t.events[0].start);
            const end = t.events.reduce((max, e) => (e.end > max ? e.end : max), t.events[0].end);
            return { taskId: t.id, title: t.title, start, end };
          }
          if (!t.dueAt) return null;
          const inferredStart = t.startAt ?? t.createdAt;
          const start = inferredStart < t.dueAt ? inferredStart : new Date(t.dueAt.getTime() - DAY_MS);
          return { taskId: t.id, title: t.title, start, end: t.dueAt };
        })
        .filter((b): b is Bar => b !== null),
    }));

  const allBars = projectBars.flatMap((p) => p.bars);
  const today = startOfDay(new Date());
  const rangeStart = allBars.length
    ? startOfDay(new Date(Math.min(today.getTime(), ...allBars.map((b) => b.start.getTime()))))
    : new Date(today.getTime() - 7 * DAY_MS);
  const rangeEndCandidate = allBars.length
    ? new Date(Math.max(today.getTime() + 14 * DAY_MS, ...allBars.map((b) => b.end.getTime())))
    : new Date(today.getTime() + 30 * DAY_MS);
  // Cap the visible window — an overdue task from months ago shouldn't
  // force a timeline thousands of pixels wide.
  const rangeEnd = new Date(Math.min(rangeEndCandidate.getTime(), rangeStart.getTime() + 120 * DAY_MS));
  const totalDays = Math.max(1, dayDiff(rangeEnd, rangeStart));

  const months: { label: string; startDay: number; days: number }[] = [];
  for (let d = 0; d < totalDays; ) {
    const date = new Date(rangeStart.getTime() + d * DAY_MS);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const daysInMonth = Math.min(totalDays - d, dayDiff(monthEnd, date));
    months.push({
      label: date.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      startDay: d,
      days: daysInMonth,
    });
    d += daysInMonth;
  }

  const todayOffset = dayDiff(today, rangeStart);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <h1 className="font-serif text-4xl leading-none text-ink">Project timeline</h1>
      <p className="mt-2 text-sm text-ink-2">
        Open tasks by project, scheduled slot if placed, otherwise created
        date → due date.
      </p>

      {(trackedReport.length > 0 || untrackedMinutes > 0) && (
        <div className="mt-4 rounded-xl border border-rule bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Tracked time this week</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {trackedReport.map(([name, minutes]) => (
              <li key={name} className="flex items-center justify-between text-sm">
                <span className="text-ink-2">{name}</span>
                <span className="font-mono text-muted">{(minutes / 60).toFixed(1)}h</span>
              </li>
            ))}
            {untrackedMinutes > 0 && (
              <li className="flex items-center justify-between text-sm">
                <span className="text-muted">No project</span>
                <span className="font-mono text-muted">{(untrackedMinutes / 60).toFixed(1)}h</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {allBars.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-rule py-8 text-center text-sm text-ink-2">
          No open tasks with a due date or scheduled slot yet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-rule bg-surface">
          <div className="relative" style={{ width: `${8 * 16 + totalDays * DAY_WIDTH_PX}px` }}>
            <div className="flex border-b border-rule">
              <div className="w-32 flex-shrink-0" />
              <div className="relative flex-1" style={{ height: "1.75rem" }}>
                {months.map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-0 border-l border-rule-soft pl-1 font-mono text-xs text-muted"
                    style={{ left: `${m.startDay * DAY_WIDTH_PX}px`, width: `${m.days * DAY_WIDTH_PX}px` }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </div>

            {projectBars.map((project) => (
              <div key={project.id}>
                <div className="flex border-b border-rule-soft bg-rule-soft">
                  <div className="w-32 flex-shrink-0 truncate px-2 py-1 text-xs font-semibold text-ink-2">
                    {project.name}
                  </div>
                  <div className="relative flex-1" style={{ width: `${totalDays * DAY_WIDTH_PX}px` }} />
                </div>
                {project.bars.map((bar) => {
                  const offset = Math.max(0, dayDiff(bar.start, rangeStart));
                  const span = Math.max(MIN_BAR_DAYS, dayDiff(bar.end, bar.start));
                  return (
                    <div key={bar.taskId} className="flex border-b border-rule-soft">
                      <div className="w-32 flex-shrink-0 truncate px-2 py-1.5 text-xs text-ink-2">
                        {bar.title}
                      </div>
                      <div
                        className="relative"
                        style={{ height: `${ROW_HEIGHT_PX}px`, width: `${totalDays * DAY_WIDTH_PX}px` }}
                      >
                        <div
                          title={`${bar.start.toLocaleDateString()} – ${bar.end.toLocaleDateString()}`}
                          className={`absolute top-1 h-5 rounded ${PROJECT_BAR_COLOR[project.color] ?? PROJECT_BAR_COLOR.zinc} opacity-80`}
                          style={{ left: `${offset * DAY_WIDTH_PX}px`, width: `${span * DAY_WIDTH_PX - 2}px` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div
                className="pointer-events-none absolute top-7 bottom-0 w-px bg-accent"
                style={{ left: `${8 * 16 + todayOffset * DAY_WIDTH_PX}px` }}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
