import Link from "next/link";
import { AlertTriangleIcon } from "../icons";
import Card from "../ui/Card";

export type AttentionTask = {
  id: string;
  title: string;
  dueAt: Date;
  isOverdue: boolean;
};

// Right-hand companion to the calendar — surfaces what actually needs a
// decision (overdue/due-soon and not yet on the calendar) right next to
// the view you're already looking at, instead of only on the Tasks page.
// Hidden below `lg`, same breakpoint as the left sidebar — room here for
// whatever else ends up wanting a spot next to the calendar later.
export default function CalendarSidebarRight({ tasks }: { tasks: AttentionTask[] }) {
  return (
    <div className="flex flex-col gap-4">
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
