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
import Button from "../ui/Button";
import NewTaskButton from "./NewTaskButton";
import TaskRow from "./TaskRow";
import TaskBoard from "./TaskBoard";
import TaskTable from "./TaskTable";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";

// Derived from the shared palette (@/lib/eventColors) — its literal
// class strings are all Tailwind's scanner needs; they don't need to be
// duplicated verbatim again at every usage site.
const PROJECT_COLOR_BADGE: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_EVENT_COLORS).map(([color, c]) => [color, c.badge]),
);

const PROJECT_COLOR_DOT: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_EVENT_COLORS).map(([color, c]) => [color, c.dot]),
);

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
    <main className="mx-auto w-full max-w-[100rem] flex-1 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-wide text-muted uppercase">Everything open</div>
          <h1 className="font-serif text-4xl leading-none tracking-tight text-ink">Tasks</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={scheduleAllAction}>
            <Button
              type="submit"
              variant="secondary"
              title="Fix stale slots and schedule new tasks"
            >
              Schedule all
            </Button>
          </form>
          <form action={rescheduleAllAction}>
            <Button
              type="submit"
              variant="secondary"
              title="Re-plan every unlocked scheduled task from scratch"
            >
              <RepeatIcon className="h-3.5 w-3.5" />
              Reschedule all
            </Button>
          </form>
          <Link
            href="/tasks/import"
            className="rounded-[9px] border border-rule bg-surface px-4 py-[10px] text-[13px] font-medium text-ink-2 transition-all hover:bg-rule-soft active:scale-[0.98]"
          >
            Import
          </Link>
          <Link
            href="/tasks/generate-project"
            className="rounded-[9px] border border-rule bg-surface px-4 py-[10px] text-[13px] font-medium text-ink-2 transition-all hover:bg-rule-soft active:scale-[0.98]"
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
              ? "rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink"
              : "rounded-full px-3 py-1 text-xs text-muted transition-colors hover:text-ink"
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
                ? "inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink"
                : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted transition-colors hover:text-ink"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`}
            />
            {project.name}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-full bg-rule-soft p-0.5 text-xs">
          <Link
            href={viewParams("list")}
            className={
              view === "list"
                ? "rounded-full bg-surface px-2.5 py-1 font-medium text-ink"
                : "rounded-full px-2.5 py-1 text-muted transition-colors hover:text-ink"
            }
          >
            List
          </Link>
          <Link
            href={viewParams("board")}
            className={
              view === "board"
                ? "rounded-full bg-surface px-2.5 py-1 font-medium text-ink"
                : "rounded-full px-2.5 py-1 text-muted transition-colors hover:text-ink"
            }
          >
            Board
          </Link>
          <Link
            href={viewParams("table")}
            className={
              view === "table"
                ? "rounded-full bg-surface px-2.5 py-1 font-medium text-ink"
                : "rounded-full px-2.5 py-1 text-muted transition-colors hover:text-ink"
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
            className="w-36 rounded-full border border-rule bg-surface px-3 py-1 text-xs text-ink-2 focus:w-48 focus:border-accent focus:outline-none"
          />
        </form>
        <details>
          <summary className="cursor-pointer list-none rounded-full px-3 py-1 text-xs text-muted transition-colors hover:text-ink">
            + Project
          </summary>
          <form
            action={createProject}
            className="mt-2 flex items-center gap-2 rounded-lg border border-rule bg-surface p-2"
          >
            <input
              name="name"
              placeholder="Project name"
              required
              className="min-w-0 flex-1 rounded border border-rule bg-paper px-2 py-1 text-xs text-ink"
            />
            <select
              name="color"
              defaultValue="indigo"
              className="rounded border border-rule bg-paper px-1 py-1 text-xs text-ink"
            >
              {PROJECT_COLOR_OPTIONS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <Button type="submit" className="px-2 py-1 text-xs">
              Add
            </Button>
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
        <ul className="mt-6 grid grid-cols-1 items-start gap-3 2xl:grid-cols-2">
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
            <li className="col-span-full rounded-xl border border-dashed border-rule py-8 text-center text-sm text-muted">
              No open tasks.
            </li>
          )}
        </ul>
      )}

      {projects.length > 0 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer transition-colors hover:text-ink">
            Manage projects
          </summary>
          <ul className="mt-2 space-y-1">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`}
                />
                <Link href={`/projects/${project.id}`} className="flex-1 hover:underline">
                  {project.name}
                </Link>
                <form action={saveProjectAsTemplateAction.bind(null, project.id, `${project.name} template`)}>
                  <button
                    type="submit"
                    className="text-muted transition-colors hover:text-ink"
                  >
                    Save as template
                  </button>
                </form>
                <form action={deleteProject.bind(null, project.id)}>
                  <button
                    type="submit"
                    className="text-muted transition-colors hover:text-accent"
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
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer transition-colors hover:text-ink">
            Project templates
          </summary>
          <ul className="mt-2 space-y-2">
            {projectTemplates.map((template) => (
              <li key={template.id} className="flex items-center gap-2">
                <span className="flex-1">
                  {template.name}{" "}
                  <span className="text-muted">
                    ({template._count.tasks} task{template._count.tasks === 1 ? "" : "s"})
                  </span>
                </span>
                <form action={createProjectFromTemplateAction.bind(null, template.id, template.name.replace(/ template$/, ""))}>
                  <button
                    type="submit"
                    className="text-muted transition-colors hover:text-ink"
                  >
                    New project from this
                  </button>
                </form>
                <form action={deleteProjectTemplateAction.bind(null, template.id)}>
                  <button
                    type="submit"
                    className="text-muted transition-colors hover:text-accent"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer transition-colors hover:text-ink">
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
                  className="text-muted transition-colors hover:text-accent"
                >
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form
          action={createLabel}
          className="mt-2 flex items-center gap-2 rounded-lg border border-rule bg-surface p-2"
        >
          <input
            name="name"
            placeholder="Label name"
            required
            className="min-w-0 flex-1 rounded border border-rule bg-paper px-2 py-1 text-xs text-ink"
          />
          <select
            name="color"
            defaultValue="indigo"
            className="rounded border border-rule bg-paper px-1 py-1 text-xs text-ink"
          >
            {PROJECT_COLOR_OPTIONS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
          <Button type="submit" className="px-2 py-1 text-xs">
            Add
          </Button>
        </form>
      </details>

      {done.length > 0 && (
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer transition-colors hover:text-ink">
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
