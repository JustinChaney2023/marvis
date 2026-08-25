import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { createAssignee, deleteAssignee } from "../actions";
import { PersonIcon, RobotIcon } from "../icons";
import Button from "../ui/Button";
import { addDays, startOfWeek } from "@/lib/calendar-dates";

export default async function TeamPage() {
  const user = await requireUser();
  const assignees = await prisma.assignee.findMany({
    where: { userId: user.id },
    include: { _count: { select: { tasks: true } } },
    orderBy: { createdAt: "asc" },
  });

  // "Team workload" — this week's scheduled hours per assignee, so you
  // can see everyone's load side-by-side instead of only your own
  // calendar. Uses the event's real duration (end - start), not the
  // task's estimate, since that's what's actually on the calendar.
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const weekTasks = await prisma.task.findMany({
    where: {
      userId: user.id,
      assigneeId: { not: null },
      events: { some: { start: { gte: weekStart, lt: weekEnd } } },
    },
    include: { events: true },
  });
  const minutesByAssignee = new Map<string, number>();
  for (const t of weekTasks) {
    if (!t.assigneeId) continue;
    // Sum every chunk that falls in this week, not just one — a chunked
    // task's workload is the total of its chunks, same as any other.
    const minutes = t.events
      .filter((e) => e.start >= weekStart && e.start < weekEnd)
      .reduce((sum, e) => sum + (e.end.getTime() - e.start.getTime()) / 60_000, 0);
    minutesByAssignee.set(t.assigneeId, (minutesByAssignee.get(t.assigneeId) ?? 0) + minutes);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <p className="text-sm text-ink-2">
        People and AI employees you can assign tasks to. An AI employee is
        just a label for now — assigning it a task shows it as theirs, but
        nothing runs automatically yet.
      </p>

      <form
        action={createAssignee}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-rule bg-surface p-5"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Name</span>
          <input
            name="name"
            required
            placeholder="e.g. Alex, or Research Bot"
            className="min-w-[12rem] rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Role (optional)</span>
          <input
            name="role"
            placeholder="e.g. Content, Ops"
            className="min-w-[10rem] rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Type</span>
          <select
            name="type"
            defaultValue="HUMAN"
            className="rounded-lg border border-rule bg-surface px-2 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
          >
            <option value="HUMAN">Human</option>
            <option value="AI">AI employee</option>
          </select>
        </label>
        <Button type="submit">Add</Button>
      </form>

      <ul className="mt-6 space-y-2">
        {assignees.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-3 rounded-xl border border-rule bg-surface p-3"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-rule-soft text-ink-2">
              {a.type === "AI" ? <RobotIcon /> : <PersonIcon />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{a.name}</p>
              <p className="text-xs text-ink-2">
                {a.role ? `${a.role} · ` : ""}
                {a._count.tasks} assigned task{a._count.tasks === 1 ? "" : "s"}
              </p>
              {(() => {
                const hours = (minutesByAssignee.get(a.id) ?? 0) / 60;
                // 40h = a full-time reference week, just for the bar's
                // proportions — not a claim about anyone's actual hours.
                const pct = Math.min(100, (hours / 40) * 100);
                return (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-rule-soft">
                      <div
                        className="h-full rounded-full bg-ink-2"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-muted">
                      {hours.toFixed(1)}h this week
                    </span>
                  </div>
                );
              })()}
            </div>
            <form action={deleteAssignee.bind(null, a.id)}>
              <button
                type="submit"
                className="text-xs text-muted transition-colors hover:text-accent"
              >
                Remove
              </button>
            </form>
          </li>
        ))}
        {assignees.length === 0 && (
          <li className="rounded-xl border border-dashed border-rule py-8 text-center text-sm text-muted">
            No one yet — add yourself, a friend, or an AI employee above.
          </li>
        )}
      </ul>
    </main>
  );
}
