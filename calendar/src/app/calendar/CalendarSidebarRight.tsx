import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "../icons";
import { formatTime, formatYMD } from "@/lib/calendar-dates";
import Card from "../ui/Card";

export type AttentionTask = {
  id: string;
  title: string;
  dueAt: Date;
  isOverdue: boolean;
};

export type UpcomingItem = {
  id: string;
  // The real DB Event row id (not the synthetic per-occurrence id a
  // recurring event's `id` above can be) — what the calendar's edit-by-
  // query-param lookup matches against.
  eventId: string;
  title: string;
  startIso: string;
  endIso: string;
  // A scheduled task's block (its linked Event), vs. a plain event.
  isTask: boolean;
  taskId: string | null;
  locked: boolean;
};

export type UpcomingDay = {
  dayKey: string;
  dayLabel: string;
  items: UpcomingItem[];
};

export type Overcommitment = {
  plannedMinutes: number;
  capMinutes: number;
};

function UpcomingItemList({ items }: { items: UpcomingItem[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-1 pb-1">
      {items.map((item) => {
        // A scheduled task's block edits as the task (its full field set
        // — priority, due date, etc. — lives there, not on the Event
        // row); a plain event edits right on the calendar itself, jumped
        // to its day.
        const href = item.isTask && item.taskId
          ? `/tasks?edit=${item.taskId}`
          : `/?view=day&start=${formatYMD(new Date(item.startIso))}&edit=${item.eventId}`;
        return (
          <li key={item.id}>
            <Link
              href={href}
              className="flex items-start gap-1.5 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-rule-soft"
            >
              {item.locked && (
                <LockIcon className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-muted" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink-2">
                  {item.title}
                </span>
                <span className="font-mono text-muted">
                  {formatTime(new Date(item.startIso))} – {formatTime(new Date(item.endIso))}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Right-hand companion to the calendar — surfaces what actually needs a
// decision (overdue/due-soon and not yet on the calendar) right next to
// the view you're already looking at, instead of only on the Tasks page.
// Hidden below `lg`, same breakpoint as the left sidebar — room here for
// whatever else ends up wanting a spot next to the calendar later.
export default function CalendarSidebarRight({
  tasks,
  upcomingDays,
  overcommitment,
}: {
  tasks: AttentionTask[];
  upcomingDays: UpcomingDay[];
  overcommitment: Overcommitment | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {overcommitment && overcommitment.plannedMinutes > overcommitment.capMinutes && (
        <div className="rounded-xl border border-accent bg-accent-wash p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-accent">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            Overcommitted today
          </h2>
          <p className="mt-1 text-xs text-ink-2">
            {(overcommitment.plannedMinutes / 60).toFixed(1)}h planned of a{" "}
            {(overcommitment.capMinutes / 60).toFixed(1)}h day.
          </p>
        </div>
      )}

      <Card padding="sm">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        {tasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted">Nothing overdue or due soon.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href="/tasks"
                  className="flex items-start gap-1.5 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-rule-soft"
                >
                  <AlertTriangleIcon
                    className={`mt-0.5 h-3 w-3 flex-shrink-0 ${t.isOverdue ? "text-accent" : "text-muted"}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-2">
                      {t.title}
                    </span>
                    <span className="font-mono text-muted">
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

      {upcomingDays.length > 0 && (
        <Card padding="sm">
          <h2 className="text-sm font-semibold">Upcoming</h2>
          <div className="mt-2 flex flex-col gap-1">
            {upcomingDays.map((day, index) => {
              const isToday = day.dayLabel === "Today";
              const label = (
                <>
                  {day.dayLabel}{" "}
                  <span className="normal-case tracking-normal text-muted">
                    ({day.items.length})
                  </span>
                </>
              );
              const list = <UpcomingItemList items={day.items} />;

              // Today always shows in full — collapsing the one day
              // you're actually living in would hide what's still ahead
              // of you right now, not just "later."
              if (isToday) {
                return (
                  <div key={day.dayKey}>
                    <p className="py-1 font-mono text-[11px] font-medium uppercase tracking-wide text-muted">
                      {label}
                    </p>
                    {list}
                  </div>
                );
              }
              return (
                <details key={day.dayKey} open={index < 3}>
                  <summary className="cursor-pointer py-1 font-mono text-[11px] font-medium uppercase tracking-wide text-muted transition-colors hover:text-ink-2">
                    {label}
                  </summary>
                  {list}
                </details>
              );
            })}
          </div>
        </Card>
      )}

      <Card padding="sm">
        <h2 className="text-sm font-semibold">Quick links</h2>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <Link href="/tasks/import" className="text-accent hover:underline">
            Import
          </Link>
          <Link href="/team" className="text-accent hover:underline">
            Team
          </Link>
          <Link href="/meet" className="text-accent hover:underline">
            Find a group time
          </Link>
          <Link href="/gantt" className="text-accent hover:underline">
            Project timeline
          </Link>
        </div>
      </Card>
    </div>
  );
}
