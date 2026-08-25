import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import GenerateProjectClient from "./GenerateProjectClient";

export default async function GenerateProjectPage() {
  const user = await requireUser();
  const [assignees, settings] = await Promise.all([
    prisma.assignee.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    getAppSettings(user.id),
  ]);
  const usingLocalAi = Boolean(settings.localAiUrl && settings.localAiModel);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl text-ink">Generate project</h1>
      </div>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
        Describe a project in one line — AI proposes a name and a task
        breakdown, you review and edit before anything is created.
      </p>
      <p className="mt-1 font-mono text-[10.5px] tracking-wide text-muted">
        {usingLocalAi ? (
          <>Using your local AI (<code>{settings.localAiModel}</code> at {settings.localAiUrl}).</>
        ) : (
          <>
            Using Claude Opus 5 (cloud).{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Switch to a local model
            </Link>
            .
          </>
        )}
      </p>

      <GenerateProjectClient assignees={assignees.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
    </main>
  );
}
