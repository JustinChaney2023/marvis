import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { buildTodayFacts, generateDailyAgendaText } from "@/lib/dailyAgenda";
import FocusClient, { type FocusTask } from "./FocusClient";
import ShutdownRitual from "./ShutdownRitual";

export default async function FocusPage() {
  const user = await requireUser();

  const settings = await getAppSettings(user.id);
  const localAi =
    settings.localAiUrl && settings.localAiModel
      ? { url: settings.localAiUrl, model: settings.localAiModel }
      : null;
  const facts = await buildTodayFacts(user.id);
  const agendaText = await generateDailyAgendaText(facts, localAi);

  const scheduled = await prisma.task.findMany({
    where: { userId: user.id, event: { isNot: null }, parentId: null },
    include: { event: true },
  });
  const upcoming = scheduled
    .filter((t) => t.event)
    .sort((a, b) => a.event!.start.getTime() - b.event!.start.getTime());

  const todo = await prisma.task.findMany({
    where: {
      userId: user.id,
      status: { in: ["CREATED", "ONGOING"] },
      event: { is: null },
      parentId: null,
    },
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
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{agendaText}</p>

      <FocusClient queue={queue} />
      <ShutdownRitual />
    </main>
  );
}
