import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { buildTodayFacts, generateDailyAgendaText } from "@/lib/dailyAgenda";
import { expandEvents } from "@/lib/recurrence";
import FocusClient, { type FocusTask, type LiveEvent } from "./FocusClient";
import ShutdownRitual from "./ShutdownRitual";

const WINDOW_MS = 12 * 60 * 60 * 1000;

// A calendar event's "Timer" link (EventModal) lands here with ?eventId= —
// Focus absorbed the old standalone /timer route rather than keeping two
// nav destinations for what's fundamentally the same "count down what I'm
// doing right now" job. Same window/occurrence-picking logic that page used.
async function resolveLiveEvent(userId: string, eventId?: string): Promise<LiveEvent | null> {
  if (!eventId) return null;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_MS);

  const rows = await prisma.event.findMany({ where: { userId, id: eventId } });
  if (rows.length === 0) return null;

  const occurrences = expandEvents(rows, windowStart, windowEnd);
  const current =
    occurrences.find((o) => o.start <= now && now < o.end) ??
    occurrences.filter((o) => o.start >= now).sort((a, b) => a.start.getTime() - b.start.getTime())[0] ??
    null;

  const start = current?.start ?? now;
  const end = current ? current.end : new Date(now.getTime() + 25 * 60_000);
  const totalSeconds = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
  const secondsLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / 1000));

  return {
    title: current?.title ?? "Timer",
    totalSeconds,
    initialSecondsLeft: Math.min(secondsLeft, totalSeconds),
  };
}

export default async function FocusPage(props: PageProps<"/focus">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const rawEventId = sp?.eventId;
  const eventId = Array.isArray(rawEventId) ? rawEventId[0] : rawEventId;

  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  const facts = await buildTodayFacts(user.id);
  const agendaText = await generateDailyAgendaText(facts, localAi, anthropicApiKey);
  const liveEvent = await resolveLiveEvent(user.id, eventId);

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
      <p className="font-serif text-lg italic text-ink-2">{agendaText}</p>

      <FocusClient queue={queue} liveEvent={liveEvent} />
      <ShutdownRitual />
    </main>
  );
}
