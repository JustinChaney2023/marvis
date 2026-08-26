import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";
import Button from "../ui/Button";
import { ConfirmForm } from "../ui/ConfirmForm";
import { deleteProject } from "../actions";

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
          <h1 className="font-serif text-3xl text-ink">Projects</h1>
          <p className="mt-1 text-sm text-ink-2">
            Each project holds its own notes, files, and tasks — a course
            created by the syllabus importer also keeps its instructor,
            grading, and book details here.
          </p>
        </div>
        <Link href="/tasks/import" className="flex-shrink-0">
          <Button type="button" variant="primary">
            Import syllabus
          </Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-2">
          No projects yet. Import a syllabus, or create one from the{" "}
          <Link href="/tasks" className="text-accent">
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
              <li className="flex items-center gap-3 rounded-xl border border-rule bg-surface p-4 transition-colors hover:bg-rule-soft">
                <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`h-3 w-3 flex-shrink-0 rounded-full ${PROJECT_COLOR_DOT[p.color] ?? PROJECT_COLOR_DOT.zinc}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{p.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-muted">
                      {open} open {open === 1 ? "task" : "tasks"}
                      {p._count.tasks !== open && ` · ${p._count.tasks} total`}
                      {p._count.fields > 0 && ` · ${p._count.fields} course fields`}
                      {p._count.attachments > 0 && ` · ${p._count.attachments} files`}
                    </span>
                  </span>
                  {overdue > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-accent-wash px-2 py-0.5 font-mono text-xs font-medium text-accent">
                      {overdue} overdue
                    </span>
                  )}
                </Link>
                <ConfirmForm message={`Delete "${p.name}"? This removes its tasks, notes, and files too.`} action={deleteProject.bind(null, p.id)}>
                  <button
                    type="submit"
                    title="Delete project"
                    className="flex-shrink-0 rounded-full px-2 py-1 text-xs text-muted transition-colors hover:text-accent"
                  >
                    Delete
                  </button>
                </ConfirmForm>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
