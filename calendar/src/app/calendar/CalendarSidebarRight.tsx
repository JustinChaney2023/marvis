import Link from "next/link";
import { AlertTriangleIcon } from "../icons";
import Card from "../ui/Card";

export type AttentionTask = {
  id: string;
  title: string;
  dueAt: Date;
  isOverdue: boolean;
};

export type Overcommitment = {
  plannedMinutes: number;
  capMinutes: number;
};

// Right-hand companion to the calendar — surfaces what actually needs a
// decision (overdue/due-soon and not yet on the calendar) right next to
// the view you're already looking at, instead of only on the Tasks page.
// Hidden below `lg`, same breakpoint as the left sidebar — room here for
// whatever else ends up wanting a spot next to the calendar later.
export default function CalendarSidebarRight({
  tasks,
  overcommitment,
}: {
  tasks: AttentionTask[];
  overcommitment: Overcommitment | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {overcommitment && overcommitment.plannedMinutes > overcommitment.capMinutes && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm ring-1 ring-black/5 dark:border-amber-700 dark:bg-amber-950/30">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            Overcommitted today
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {(overcommitment.plannedMinutes / 60).toFixed(1)}h planned of a{" "}
            {(overcommitment.capMinutes / 60).toFixed(1)}h day.
          </p>
        </div>
      )}

      <Card padding="sm">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        {tasks.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">Nothing overdue or due soon. 🎉</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href="/tasks"
                  className="flex items-start gap-1.5 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                  <AlertTriangleIcon
                    className={`mt-0.5 h-3 w-3 flex-shrink-0 ${t.isOverdue ? "text-red-500" : "text-amber-500"}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-700 dark:text-zinc-300">
                      {t.title}
                    </span>
                    <span className="text-zinc-400">
                      {t.isOverdue ? "Overdue · " : "Due "}
                      {t.dueAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="sm">
        <h2 className="text-sm font-semibold">Quick links</h2>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <Link href="/tasks/import" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Import syllabus
          </Link>
          <Link href="/team" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Team
          </Link>
          <Link href="/gantt" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Project timeline
          </Link>
        </div>
      </Card>
    </div>
  );
}
