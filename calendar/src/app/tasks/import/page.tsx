import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import SyllabusImportClient from "./SyllabusImportClient";

export default async function SyllabusImportPage() {
  const user = await requireUser();
  const [projects, assignees, settings] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.assignee.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    getAppSettings(user.id),
  ]);
  const usingLocalAi = Boolean(settings.localAiUrl && settings.localAiModel);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Import syllabus</h1>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Paste a syllabus (or any text with due dates) — AI pulls out
        assignments/exams/readings and their dates, you review and fix
        anything before it becomes real tasks.
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        {usingLocalAi ? (
          <>Using your local AI (<code>{settings.localAiModel}</code> at {settings.localAiUrl}).</>
        ) : (
          <>
            Using Claude Opus 5 (cloud).{" "}
            <Link href="/settings" className="text-indigo-600 dark:text-indigo-400">
              Switch to a local model
            </Link>
            .
          </>
        )}
      </p>

      <SyllabusImportClient
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        assignees={assignees.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
      />
    </main>
  );
}
