import { prisma } from "@/lib/prisma";
import { createTask, toggleTaskDone } from "./actions";

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];

export default async function Home() {
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" } },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
  });
  const done = await prisma.task.findMany({
    where: { status: "DONE" },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold">Tasks</h1>

      <form action={createTask} className="mt-6 flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <input
          name="title"
          placeholder="What needs doing?"
          required
          className="min-w-[16rem] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select name="priority" defaultValue="0" className="rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {PRIORITY_LABEL.map((label, value) => (
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
          className="w-24 rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="datetime-local"
          name="dueAt"
          className="rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add
        </button>
      </form>

      <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-3">
            <form action={toggleTaskDone.bind(null, task.id, true)}>
              <button
                type="submit"
                aria-label="mark done"
                className="h-5 w-5 shrink-0 rounded-full border border-zinc-400 dark:border-zinc-600"
              />
            </form>
            <div className="flex-1">
              <p className="text-sm font-medium">{task.title}</p>
              <p className="text-xs text-zinc-500">
                {PRIORITY_LABEL[task.priority]} · {task.durationMin}m
                {task.dueAt ? ` · due ${task.dueAt.toLocaleString()}` : ""}
              </p>
            </div>
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-500">No open tasks.</li>
        )}
      </ul>

      {done.length > 0 && (
        <details className="mt-8 text-sm text-zinc-500">
          <summary className="cursor-pointer">Recently done ({done.length})</summary>
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
