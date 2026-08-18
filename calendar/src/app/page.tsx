import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  createTask,
  scheduleAllAction,
  scheduleTaskAction,
  toggleTaskDone,
  unscheduleTaskAction,
} from "./actions";

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];
const ENERGY_LABEL: Record<string, string> = {
  LOW: "Low energy",
  MEDIUM: "Any energy",
  HIGH: "Deep work",
};

const PRIORITY_BADGE: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  1: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  2: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  3: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

export default async function Home() {
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" } },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    include: { event: true },
  });
  const done = await prisma.task.findMany({
    where: { status: "DONE" },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/calendar"
            className="text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Calendar →
          </Link>
          <form action={scheduleAllAction}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
            >
              Schedule all
            </button>
          </form>
        </nav>
      </div>

      <form
        action={createTask}
        className="mt-6 flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          name="title"
          placeholder="What needs doing?"
          required
          className="min-w-[16rem] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          name="priority"
          defaultValue="0"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        >
          {PRIORITY_LABEL.map((label, value) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="energy"
          defaultValue="MEDIUM"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(ENERGY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="number"
          name="durationMin"
          defaultValue={30}
          min={5}
          step={5}
          className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="datetime-local"
          name="dueAt"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Add
        </button>
      </form>

      <ul className="mt-6 space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <form action={toggleTaskDone.bind(null, task.id, true)}>
              <button
                type="submit"
                aria-label="mark done"
                className="h-5 w-5 shrink-0 rounded-full border border-zinc-300 bg-white transition-all hover:scale-110 hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-offset-zinc-900"
              />
            </form>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{task.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}
                >
                  {PRIORITY_LABEL[task.priority]}
                </span>
                {task.energy !== "MEDIUM" && (
                  <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                    {ENERGY_LABEL[task.energy]}
                  </span>
                )}
                <span>{task.durationMin}m</span>
                {task.dueAt && (
                  <span>· due {task.dueAt.toLocaleString()}</span>
                )}
                {task.event && (
                  <span>· scheduled {task.event.start.toLocaleString()}</span>
                )}
              </div>
            </div>
            <form
              action={
                task.event
                  ? unscheduleTaskAction.bind(null, task.id)
                  : scheduleTaskAction.bind(null, task.id)
              }
            >
              <button
                type="submit"
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
              >
                {task.event ? "Unschedule" : "Schedule"}
              </button>
            </form>
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
            No open tasks.
          </li>
        )}
      </ul>

      {done.length > 0 && (
        <details className="mt-8 text-sm text-zinc-500">
          <summary className="cursor-pointer transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
            Recently done ({done.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {done.map((task) => (
              <li key={task.id} className="line-through">
                {task.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
