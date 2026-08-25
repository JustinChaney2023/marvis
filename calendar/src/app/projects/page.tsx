import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";

// Same palette as the detail page's header dot, both derived from the
// one shared source in @/lib/eventColors.
const PROJECT_COLOR_DOT: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_EVENT_COLORS).map(([color, c]) => [color, c.dot]),
);

/**
 * Project index. Projects previously had no entry point of their own —
 * a detail page existed at /projects/[id] but the only way to reach one
 * was the "Manage projects" list on the Tasks page, which reads as
 * settings rather than as a place to go.
 */
export default async function ProjectsPage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { tasks: true, attachments: true, fields: true } },
      tasks: {
        where: { status: { not: "DONE" }, parentId: null },
        select: { id: true, dueAt: true },
      },
    },
  });

  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Each project holds its own notes, files, and tasks — a course
            created by the syllabus importer also keeps its instructor,
            grading, and book details here.
          </p>
        </div>
        <Link
          href="/tasks/import"
          className="flex-shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Import syllabus
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No projects yet. Import a syllabus, or create one from the{" "}
          <Link href="/tasks" className="text-indigo-600 dark:text-indigo-400">
            Tasks page
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {projects.map((p) => {
            const open = p.tasks.length;
            // Overdue is the one number worth surfacing unprompted — it's
            // the reason you'd open a project you weren't already thinking
            // about.
            const overdue = p.tasks.filter((t) => t.dueAt && t.dueAt < now).length;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-indigo-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-indigo-600 dark:hover:bg-zinc-700/50"
                >
                  <span
                    className={`h-3 w-3 flex-shrink-0 rounded-full ${PROJECT_COLOR_DOT[p.color] ?? PROJECT_COLOR_DOT.zinc}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                      {open} open {open === 1 ? "task" : "tasks"}
                      {p._count.tasks !== open && ` · ${p._count.tasks} total`}
                      {p._count.fields > 0 && ` · ${p._count.fields} course fields`}
                      {p._count.attachments > 0 && ` · ${p._count.attachments} files`}
                    </span>
                  </span>
                  {overdue > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      {overdue} overdue
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
