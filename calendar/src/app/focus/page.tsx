import Link from "next/link";
import { prisma } from "@/lib/prisma";
import FocusClient, { type FocusTask } from "./FocusClient";

export default async function FocusPage() {
  const scheduled = await prisma.task.findMany({
    where: { status: "SCHEDULED" },
    include: { event: true },
  });
  const upcoming = scheduled
    .filter((t) => t.event)
    .sort((a, b) => a.event!.start.getTime() - b.event!.start.getTime());

  const todo = await prisma.task.findMany({
    where: { status: "TODO" },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
  });

  const queue: FocusTask[] = [
    ...upcoming.map((t) => ({
      id: t.id,
      title: t.title,
      durationMin: t.durationMin,
      priority: t.priority,
      energy: t.energy,
      dueAt: t.dueAt,
      eventStart: t.event!.start,
    })),
    ...todo.map((t) => ({
      id: t.id,
      title: t.title,
      durationMin: t.durationMin,
      priority: t.priority,
      energy: t.energy,
      dueAt: t.dueAt,
      eventStart: null,
    })),
  ].slice(0, 10);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-12">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Tasks
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Focus</h1>
        <div className="w-16" />
      </div>

      <FocusClient queue={queue} />
    </main>
  );
}
