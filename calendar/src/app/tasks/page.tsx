import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { RECURRENCE_PRESETS } from "@/lib/recurrence";
import {
  createProject,
  createTask,
  deleteProject,
  scheduleAllAction,
  scheduleTaskAction,
  toggleTaskDone,
  unscheduleTaskAction,
} from "../actions";

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];
const DURATION_PRESETS_MIN = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

const PRIORITY_BADGE: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  1: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  2: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  3: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

// Tailwind's JIT scanner needs full literal class strings in source, so
// this can't be built as `bg-${color}-100` — every option users can pick
// from PROJECT_COLOR_OPTIONS below needs its own entry here.
const PROJECT_COLOR_BADGE: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
};

const PROJECT_COLOR_DOT: Record<string, string> = {
  zinc: "bg-zinc-400",
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

const PROJECT_COLOR_OPTIONS = Object.keys(PROJECT_COLOR_BADGE);

export default async function Home(props: PageProps<"/tasks">) {
  const sp = await props.searchParams;
  const rawProject = sp?.project;
  const projectFilter = Array.isArray(rawProject) ? rawProject[0] : rawProject;

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
  });
  const cookieStore = await cookies();
  const lastProjectId = cookieStore.get("lastProjectId")?.value ?? "";
  const defaultProjectId = projects.some((p) => p.id === lastProjectId)
    ? lastProjectId
    : "";

  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      ...(projectFilter ? { projectId: projectFilter } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    include: { event: true, project: true },
  });
  const done = await prisma.task.findMany({
    where: { status: "DONE" },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/focus"
            className="text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Focus
          </Link>
          <Link
            href="/"
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href="/tasks"
          className={
            !projectFilter
              ? "rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "rounded-full px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          }
        >
          All
        </Link>
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/tasks?project=${project.id}`}
            className={
              projectFilter === project.id
                ? "inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`}
            />
            {project.name}
          </Link>
        ))}
        <details className="ml-auto">
          <summary className="cursor-pointer list-none rounded-full px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
            + Project
          </summary>
          <form
            action={createProject}
            className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <input
              name="name"
              placeholder="Project name"
              required
              className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <select
              name="color"
              defaultValue="indigo"
              className="rounded border border-zinc-200 bg-white px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {PROJECT_COLOR_OPTIONS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500"
            >
              Add
            </button>
          </form>
        </details>
      </div>

      <form
        action={createTask}
        className="mt-4 flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900"
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
        {projects.length > 0 && (
          <select
            name="projectId"
            defaultValue={defaultProjectId}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900">
          <input
            type="number"
            name="durationMin"
            defaultValue={30}
            min={5}
            step={5}
            list="duration-presets"
            aria-label="Duration in minutes"
            className="w-14 bg-transparent focus:outline-none"
          />
          <span className="text-zinc-400">min</span>
        </label>
        <datalist id="duration-presets">
          {DURATION_PRESETS_MIN.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <input
          type="datetime-local"
          name="dueAt"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          name="recurrenceRule"
          defaultValue=""
          title="Repeat — requires a due date to anchor to"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        >
          {RECURRENCE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
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
                {task.project && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_COLOR_BADGE[task.project.color] ?? PROJECT_COLOR_BADGE.zinc}`}
                  >
                    {task.project.name}
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}
                >
                  {PRIORITY_LABEL[task.priority]}
                </span>
                <span>{task.durationMin}m</span>
                {task.dueAt && (
                  <span>· due {task.dueAt.toLocaleString()}</span>
                )}
                {task.recurrenceRule && (
                  <span title="Repeats — completing it creates the next occurrence">
                    ↻ repeats
                  </span>
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

      {projects.length > 0 && (
        <details className="mt-4 text-xs text-zinc-500">
          <summary className="cursor-pointer transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
            Manage projects
          </summary>
          <ul className="mt-2 space-y-1">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`}
                />
                <span className="flex-1">{project.name}</span>
                <form action={deleteProject.bind(null, project.id)}>
                  <button
                    type="submit"
                    className="text-zinc-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {done.length > 0 && (
        <details className="mt-4 text-sm text-zinc-500">
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
