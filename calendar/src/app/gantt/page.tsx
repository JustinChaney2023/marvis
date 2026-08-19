import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const DAY_MS = 86_400_000;
const DAY_WIDTH_PX = 32;
const ROW_HEIGHT_PX = 32;
// Bars with no real duration (a bare due date, or a due date in the
// past relative to the task's creation) still need to render as
// something visible rather than a zero-width sliver.
const MIN_BAR_DAYS = 1;

const PROJECT_BAR_COLOR: Record<string, string> = {
  zinc: "bg-zinc-400",
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

export default async function GanttPage() {
  const user = await requireUser();
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: {
      tasks: {
        where: { status: { not: "DONE" }, parentId: null },
        include: { event: true },
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
          // Prefer the actual scheduled slot; otherwise a span from the
          // task's start date (or creation date, if it has none) to due
          // date.
          if (t.event) return { taskId: t.id, title: t.title, start: t.event.start, end: t.event.end };
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Gantt</h1>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Open tasks by project, scheduled slot if placed, otherwise created
        date → due date.
      </p>

      {allBars.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No open tasks with a due date or scheduled slot yet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="relative" style={{ width: `${8 * 16 + totalDays * DAY_WIDTH_PX}px` }}>
            <div className="flex border-b border-zinc-200 dark:border-zinc-700">
              <div className="w-32 flex-shrink-0" />
              <div className="relative flex-1" style={{ height: "1.75rem" }}>
                {months.map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-0 border-l border-zinc-200 pl-1 text-xs text-zinc-500 dark:border-zinc-700"
                    style={{ left: `${m.startDay * DAY_WIDTH_PX}px`, width: `${m.days * DAY_WIDTH_PX}px` }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </div>

            {projectBars.map((project) => (
              <div key={project.id}>
                <div className="flex border-b border-zinc-100 bg-zinc-50 dark:border-zinc-700/60 dark:bg-zinc-700/30">
                  <div className="w-32 flex-shrink-0 truncate px-2 py-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    {project.name}
                  </div>
                  <div className="relative flex-1" style={{ width: `${totalDays * DAY_WIDTH_PX}px` }} />
                </div>
                {project.bars.map((bar) => {
                  const offset = Math.max(0, dayDiff(bar.start, rangeStart));
                  const span = Math.max(MIN_BAR_DAYS, dayDiff(bar.end, bar.start));
                  return (
                    <div key={bar.taskId} className="flex border-b border-zinc-100 dark:border-zinc-700/60">
                      <div className="w-32 flex-shrink-0 truncate px-2 py-1.5 text-xs text-zinc-600 dark:text-zinc-400">
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
                className="pointer-events-none absolute top-7 bottom-0 w-px bg-red-500"
                style={{ left: `${8 * 16 + todayOffset * DAY_WIDTH_PX}px` }}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
