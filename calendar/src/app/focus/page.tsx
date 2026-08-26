import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { buildTodayFacts, generateDailyAgendaText } from "@/lib/dailyAgenda";
import FocusClient, { type FocusTask } from "./FocusClient";
import ShutdownRitual from "./ShutdownRitual";

// Its own async component, streamed in behind Suspense below — this is
// the one part of the page that can take a while (an AI call to phrase
// the summary, up to a 120s timeout if a local model is slow/unreachable).
// Everything else on the page is a handful of fast DB reads; blocking the
// whole page load on this one sentence was why clicking "Focus" felt slow.
async function DailyAgenda({ userId }: { userId: string }) {
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(userId));
  const facts = await buildTodayFacts(userId);
  const agendaText = await generateDailyAgendaText(facts, localAi, anthropicApiKey);
  return <p className="font-serif text-lg italic text-ink-2">{agendaText}</p>;
}

export default async function FocusPage() {
  const user = await requireUser();

  const scheduled = await prisma.task.findMany({
    where: { userId: user.id, events: { some: {} }, parentId: null },
    include: { events: true },
  });
  // A chunked task's own chunks are ordered by the earliest one — that's
  // the next slot actually coming up for it.
  const upcoming = scheduled
    .map((t) => ({ ...t, earliestEventStart: t.events.reduce((min, e) => (e.start < min ? e.start : min), t.events[0].start) }))
    .sort((a, b) => a.earliestEventStart.getTime() - b.earliestEventStart.getTime());

  const todo = await prisma.task.findMany({
    where: {
      userId: user.id,
      status: { in: ["CREATED", "ONGOING"] },
      events: { none: {} },
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
      eventStart: t.earliestEventStart,
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
      <Suspense fallback={<p className="font-serif text-lg text-muted">Reading today's calendar…</p>}>
        <DailyAgenda userId={user.id} />
      </Suspense>

      <FocusClient queue={queue} />
      <ShutdownRitual />
    </main>
  );
}
