import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { expandEvents } from "@/lib/recurrence";
import TimerClient from "./TimerClient";

const WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Fullscreen countdown for `?eventId=`, arriving from an event's "Timer"
 * link, or — via the hidden mark-click in the side rail with no eventId —
 * whatever's on right now (e.g. "start my current class's timer"). Falls
 * back to a plain 25-minute pomodoro when nothing's in progress.
 */
export default async function TimerPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_MS);

  const rows = await prisma.event.findMany({
    where: {
      userId: user.id,
      ...(sp.eventId
        ? { id: sp.eventId }
        : { OR: [{ recurrenceRule: { not: null } }, { start: { lt: windowEnd }, end: { gt: windowStart } }] }),
    },
  });

  const occurrences = expandEvents(rows, windowStart, windowEnd);
  // Prefer whichever occurrence is actually in progress right now — that's
  // what makes joining mid-class start the timer already caught up, rather
  // than back at the full period length.
  const current =
    occurrences.find((o) => o.start <= now && now < o.end) ??
    occurrences.filter((o) => o.start >= now).sort((a, b) => a.start.getTime() - b.start.getTime())[0] ??
    null;

  const start = current?.start ?? now;
  const end = current ? current.end : new Date(now.getTime() + 25 * 60_000);
  const totalSeconds = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
  const secondsLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / 1000));

  return (
    <TimerClient
      title={current?.title ?? "Timer"}
      totalSeconds={totalSeconds}
      initialSecondsLeft={Math.min(secondsLeft, totalSeconds)}
    />
  );
}
