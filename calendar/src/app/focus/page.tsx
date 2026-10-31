import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { userTimeZone } from "@/lib/timezone";
import { buildTodayFacts, generateDailyAgendaText } from "@/lib/dailyAgenda";
import FocusClient, { type FocusTask } from "./FocusClient";
import ShutdownRitual from "./ShutdownRitual";

// Its own async component, streamed in behind Suspense below — this is
// the one part of the page that can take a while (an AI call to phrase
// the summary, up to a 120s timeout if a local model is slow/unreachable).
// Everything else on the page is a handful of fast DB reads; blocking the
// whole page load on this one sentence was why clicking "Focus" felt slow.
async function DailyAgenda({ userId, timeZone }: { userId: string; timeZone: string }) {
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(userId));
  const facts = await buildTodayFacts(userId, timeZone);
  const agendaText = await generateDailyAgendaText(facts, localAi, anthropicApiKey);
  return <p className="font-serif text-lg italic text-ink-2">{agendaText}</p>;
}

export default async function FocusPage(props: PageProps<"/focus">) {
  const sp = await props.searchParams;
  const focusTaskId = typeof sp?.taskId === "string" ? sp.taskId : null;
  const user = await requireUser();

  // Arriving here with a taskId (the "Focus" link on a task row) means
  // "just start a solo focus session for this one task" — skip the
  // queue-building queries entirely and hand the client a single-task
  // queue. Falls through to the normal queue below if the task doesn't
  // exist (e.g. a stale link).
  if (focusTaskId) {
    const pinned = await prisma.task.findFirst({ where: { id: focusTaskId, userId: user.id } });
    if (pinned) {
      const soloTask: FocusTask = {
        id: pinned.id,
        title: pinned.title,
        durationMin: pinned.durationMin,
        priority: pinned.priority,
        energy: pinned.energy,
        dueAt: pinned.dueAt,
        eventStart: null,
      };
      return (
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
          <Suspense fallback={<p className="font-serif text-lg text-muted">Reading today&apos;s calendar…</p>}>
            <DailyAgenda userId={user.id} timeZone={userTimeZone(user)} />
          </Suspense>
          <FocusClient queue={[soloTask]} initialTaskId={soloTask.id} solo />
          <ShutdownRitual />
        </main>
      );
    }
  }

  // Open tasks with a block from today on — done tasks (and every
  // task that ever had a block) used to land in the queue. The status
  // filter matters: a finished study session from weeks ago would
  // otherwise outrank everything actually coming up. `events: { where }`
  // (not a client-side filter) keeps the query bounded to events that
  // haven't already happened.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [scheduled, todo] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["CREATED", "ONGOING"] },
        events: { some: { end: { gte: startOfToday } } },
        parentId: null,
      },
      include: { events: { where: { end: { gte: startOfToday } } } },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["CREATED", "ONGOING"] },
        events: { none: {} },
        parentId: null,
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    }),
  ]);
  // A chunked task's own chunks are ordered by the earliest one — that's
  // the next slot actually coming up for it.
  const upcoming = scheduled
    .map((t) => ({ ...t, earliestEventStart: t.events.reduce((min, e) => (e.start < min ? e.start : min), t.events[0].start) }))
    .sort((a, b) => a.earliestEventStart.getTime() - b.earliestEventStart.getTime());

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
  // focusTaskId falling through to here means the task lookup above came
  // back empty (a stale link) — nothing left to pin, just show the queue.

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="font-serif text-lg text-muted">Reading today&apos;s calendar…</p>}>
        <DailyAgenda userId={user.id} timeZone={userTimeZone(user)} />
      </Suspense>

      <FocusClient queue={queue} initialTaskId={focusTaskId} />
      <ShutdownRitual />
    </main>
  );
}
