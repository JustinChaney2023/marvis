import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  createLabel,
  createProject,
  createProjectFromTemplateAction,
  deleteLabel,
  deleteProject,
  deleteProjectTemplateAction,
  rescheduleAllAction,
  saveProjectAsTemplateAction,
  scheduleAllAction,
} from "../actions";
import { RepeatIcon } from "../icons";
import NewTaskButton from "./NewTaskButton";
import TaskRow from "./TaskRow";
import TaskBoard from "./TaskBoard";
import TaskTable from "./TaskTable";

// Tailwind's JIT scanner needs full literal class strings in source, so
// this can't be built as `bg-${color}-100` — every option users can pick
// from PROJECT_COLOR_OPTIONS below needs its own entry here.
const PROJECT_COLOR_BADGE: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
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
  const user = await requireUser();
  const sp = await props.searchParams;
  const rawProject = sp?.project;
  const projectFilter = Array.isArray(rawProject) ? rawProject[0] : rawProject;
  const rawQuery = sp?.q;
  const searchQuery = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) ?? "";

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const assignees = await prisma.assignee.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  // Every account gets a standing "Myself" assignee, lazily created on
  // first visit — new tasks default to it (most tasks are for yourself,
  // not a specific teammate/AI) rather than "Unassigned" every time.
  // A real Assignee row, not a special-cased id, so it sorts/filters/
  // displays exactly like any other assignee everywhere else.
  let myselfAssignee = assignees.find((a) => a.name === "Myself");
  if (!myselfAssignee) {
    myselfAssignee = await prisma.assignee.create({
      data: { userId: user.id, name: "Myself", type: "HUMAN" },
    });
    assignees.unshift(myselfAssignee);
  }
  const timeSlots = await prisma.timeSlot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const labels = await prisma.label.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const projectTemplates = await prisma.projectTemplate.findMany({
    where: { userId: user.id },
    include: { _count: { select: { tasks: true } } },
    orderBy: { createdAt: "asc" },
  });
  const cookieStore = await cookies();
  const lastProjectId = cookieStore.get("lastProjectId")?.value ?? "";
  const defaultProjectId = projects.some((p) => p.id === lastProjectId)
    ? lastProjectId
    : "";

  // SQLite's Prisma provider doesn't support `mode: "insensitive"` (that's
  // Postgres/MongoDB only) — filtering client-side in JS after fetch
  // sidesteps the case-sensitivity gotcha entirely, and is plenty fast at
  // personal-task-list scale.
  // TaskRow displays one representative "is this scheduled" slot per
  // task (the earliest chunk, for a chunked one) plus how many chunks
  // there are in total — it doesn't need the full per-chunk list.
  const withPrimaryEvent = <T extends { events: { start: Date; end: Date; locked: boolean }[] }>(t: T) => ({
    ...t,
    event: t.events.length > 0 ? t.events.reduce((min, e) => (e.start < min.start ? e : min)) : null,
    eventCount: t.events.length,
  });

  const allOpenTasksRaw = await prisma.task.findMany({
    where: {
      userId: user.id,
      status: { not: "DONE" },
      parentId: null, // subtasks render nested under their parent, not as their own row
      ...(projectFilter ? { projectId: projectFilter } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    include: {
      events: true,
      project: true,
      assignee: true,
      subtasks: { orderBy: { createdAt: "asc" } },
      labels: true,
      blockedBy: { select: { id: true, title: true, status: true } },
    },
  });
  const allOpenTasks = allOpenTasksRaw.map(withPrimaryEvent);
  // Anything this task could depend on — every other open task, since a
  // done task blocking nothing is already moot and its own row is
  // filtered by TaskModal's caller (edit mode passes an otherTasks list
  // with itself excluded below).
  const taskOptions = allOpenTasksRaw.map((t) => ({ id: t.id, title: t.title }));
  const tasks = searchQuery
    ? allOpenTasks.filter((t) =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allOpenTasks;
  const rawView = sp?.view;
  const viewParam = Array.isArray(rawView) ? rawView[0] : rawView;
  const view = viewParam === "board" ? "board" : viewParam === "table" ? "table" : "list";

  const doneRaw = await prisma.task.findMany({
    where: { userId: user.id, status: "DONE" },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      events: true,
      project: true,
      assignee: true,
      subtasks: { orderBy: { createdAt: "asc" } },
      labels: true,
      blockedBy: { select: { id: true, title: true, status: true } },
    },
  });
  const done = doneRaw.map(withPrimaryEvent);

  const viewParams = (v: string) => {
    const params = new URLSearchParams();
    if (projectFilter) params.set("project", projectFilter);
    if (searchQuery) params.set("q", searchQuery);
    if (v !== "list") params.set("view", v);
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };

  return (
    <main className={`mx-auto w-full flex-1 px-6 py-12 ${view === "board" || view === "table" ? "max-w-6xl" : "max-w-2xl"}`}>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <form action={scheduleAllAction}>
            <button
              type="submit"
              title="Fix stale slots and schedule new tasks"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            >
              Schedule all
            </button>
          </form>
          <form action={rescheduleAllAction}>
            <button
              type="submit"
              title="Re-plan every unlocked scheduled task from scratch"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            >
              <RepeatIcon className="h-3.5 w-3.5" />
              Reschedule all
            </button>
          </form>
          <Link
            href="/tasks/import"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
          >
            Import
          </Link>
          <Link
            href="/tasks/generate-project"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
          >
            Generate project
          </Link>
          <NewTaskButton
            projects={projects}
            assignees={assignees}
            timeSlots={timeSlots}
            labels={labels}
            otherTasks={taskOptions}
            defaultProjectId={defaultProjectId}
            defaultAssigneeId={myselfAssignee.id}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href="/tasks"
          className={
            !projectFilter
              ? "rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
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
                ? "inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`}
            />
            {project.name}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-full bg-zinc-100 p-0.5 text-xs dark:bg-zinc-700">
          <Link
            href={viewParams("list")}
            className={
              view === "list"
                ? "rounded-full bg-white px-2.5 py-1 font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                : "rounded-full px-2.5 py-1 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          >
            List
          </Link>
          <Link
            href={viewParams("board")}
            className={
              view === "board"
                ? "rounded-full bg-white px-2.5 py-1 font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                : "rounded-full px-2.5 py-1 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          >
            Board
          </Link>
          <Link
            href={viewParams("table")}
            className={
              view === "table"
                ? "rounded-full bg-white px-2.5 py-1 font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                : "rounded-full px-2.5 py-1 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          >
            Table
          </Link>
        </div>
        <form action="/tasks" className="flex items-center">
          {projectFilter && (
            <input type="hidden" name="project" value={projectFilter} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Search tasks…"
            className="w-36 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 focus:w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          />
        </form>
        <details>
          <summary className="cursor-pointer list-none rounded-full px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
            + Project
          </summary>
          <form
            action={createProject}
            className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <input
              name="name"
              placeholder="Project name"
              required
              className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
            />
            <select
              name="color"
              defaultValue="indigo"
              className="rounded border border-zinc-200 bg-white px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
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

      {view === "board" ? (
        <TaskBoard
          tasks={tasks}
          done={done}
          projects={projects}
          assignees={assignees}
          timeSlots={timeSlots}
          labels={labels}
          otherTasks={taskOptions}
          defaultProjectId={defaultProjectId}
        />
      ) : view === "table" ? (
        <TaskTable
          tasks={tasks}
          projects={projects}
          assignees={assignees}
          timeSlots={timeSlots}
          labels={labels}
          otherTasks={taskOptions}
          defaultProjectId={defaultProjectId}
        />
      ) : (
        <ul className="mt-6 space-y-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projects={projects}
              assignees={assignees}
              timeSlots={timeSlots}
              labels={labels}
              otherTasks={taskOptions}
              defaultProjectId={defaultProjectId}
            />
          ))}
          {tasks.length === 0 && (
            <li className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No open tasks.
            </li>
          )}
        </ul>
      )}

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
                <form action={saveProjectAsTemplateAction.bind(null, project.id, `${project.name} template`)}>
                  <button
                    type="submit"
                    className="text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Save as template
                  </button>
                </form>
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

      {projectTemplates.length > 0 && (
        <details className="mt-4 text-xs text-zinc-500">
          <summary className="cursor-pointer transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
            Project templates
          </summary>
          <ul className="mt-2 space-y-2">
            {projectTemplates.map((template) => (
              <li key={template.id} className="flex items-center gap-2">
                <span className="flex-1">
                  {template.name}{" "}
                  <span className="text-zinc-400">
                    ({template._count.tasks} task{template._count.tasks === 1 ? "" : "s"})
                  </span>
                </span>
                <form action={createProjectFromTemplateAction.bind(null, template.id, template.name.replace(/ template$/, ""))}>
                  <button
                    type="submit"
                    className="text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    New project from this
                  </button>
                </form>
                <form action={deleteProjectTemplateAction.bind(null, template.id)}>
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

      <details className="mt-4 text-xs text-zinc-500">
        <summary className="cursor-pointer transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
          Manage labels
        </summary>
        <ul className="mt-2 space-y-1">
          {labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[label.color] ?? PROJECT_COLOR_DOT.zinc}`}
              />
              <span className="flex-1">{label.name}</span>
              <form action={deleteLabel.bind(null, label.id)}>
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
        <form
          action={createLabel}
          className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <input
            name="name"
            placeholder="Label name"
            required
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
          />
          <select
            name="color"
            defaultValue="indigo"
            className="rounded border border-zinc-200 bg-white px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
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
