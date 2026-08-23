import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import TaskRow, { type TaskRowData } from "../../tasks/TaskRow";
import ProjectNotesEditor from "./ProjectNotesEditor";
import ProjectAttachments from "./ProjectAttachments";

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: { fields: { orderBy: { sortOrder: "asc" } }, attachments: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) notFound();

  const [projects, assignees, timeSlots, labels, tasksRaw] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.assignee.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.timeSlot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.label.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.task.findMany({
      where: { userId: user.id, projectId: id, status: { not: "DONE" }, parentId: null },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      include: {
        events: true,
        project: true,
        assignee: true,
        subtasks: { orderBy: { createdAt: "asc" } },
        labels: true,
        blockedBy: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  const tasks: TaskRowData[] = tasksRaw.map((t) => ({
    ...t,
    event: t.events.length > 0 ? t.events.reduce((min, e) => (e.start < min.start ? e : min)) : null,
    eventCount: t.events.length,
  }));
  const taskOptions = tasksRaw.map((t) => ({ id: t.id, title: t.title }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <Link href="/tasks" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← All tasks
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${PROJECT_COLOR_DOT[project.color] ?? PROJECT_COLOR_DOT.zinc}`} />
        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
      </div>

      {project.fields.length > 0 && (
        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2 dark:border-zinc-700 dark:bg-zinc-800">
          {project.fields.map((f) => (
            <div key={f.id}>
              <dt className="text-xs text-zinc-500">{f.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-500">Notes</h2>
        <ProjectNotesEditor projectId={project.id} initialNotes={project.notes ?? ""} />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-500">Library</h2>
        <ProjectAttachments projectId={project.id} attachments={project.attachments} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-500">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No open tasks in this project.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projects={projects}
                assignees={assignees}
                timeSlots={timeSlots}
                labels={labels}
                otherTasks={taskOptions.filter((t) => t.id !== task.id)}
                defaultProjectId={project.id}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
