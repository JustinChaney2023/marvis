import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { defaultWindowFn, fetchBusyIntervals, findEarliestSlot, padForBuffer, windowFnForWorkingHours, dateKey } from "@/lib/scheduler";
import { getZonedDateParts, zonedWallTimeToUtc } from "@/lib/timezone";
import { startOfWeek, addDays } from "@/lib/calendar-dates";

/**
 * Tops up each enabled habit to its timesPerWeek quota for the current
 * week, placing new occurrences in whatever open slots findEarliestSlot
 * finds — same machinery scheduleTask uses for tasks. Never touches
 * occurrences that already exist this week; this only fills the gap
 * between what's already placed and what's still owed. Occurrences that
 * get conflicted out by something else are re-placed by
 * rescheduleConflictsWith (scheduler.ts), not here — this is the weekly
 * top-up, that's the continuous "don't just drop it" half.
 */
export async function scheduleHabitsForWeek(userId: string): Promise<{ placed: number }> {
  const habits = await prisma.habit.findMany({ where: { userId, enabled: true } });
  if (habits.length === 0) return { placed: 0 };

  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const settings = await getAppSettings(userId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The user's own working hours (and work days), like tasks get.
  const getWindow = windowFnForWorkingHours(settings, timeZone);
  const startOfNextDay = (d: Date) => {
    const { year, month, day } = getZonedDateParts(d, timeZone);
    return zonedWallTimeToUtc(year, month, day + 1, 0, 0, timeZone);
  };

  let placed = 0;
  for (const habit of habits) {
    const existing = await prisma.event.findMany({
      where: { habitId: habit.id, start: { gte: weekStart, lt: weekEnd } },
      select: { start: true },
    });
    const usedDays = new Set(existing.map((e) => dateKey(e.start, timeZone)));
    let needed = habit.timesPerWeek - existing.length;
    if (needed <= 0) continue;

    // Re-fetched per habit rather than once up front — placing one
    // habit's occurrences changes what's busy for the next habit.
    const busy = padForBuffer(
      await fetchBusyIntervals(userId, now, weekEnd),
      settings.bufferMin,
    );
    let cursor = now > weekStart ? now : weekStart;

    // One occurrence per day — "gym 3x a week" means three different
    // days, not three back-to-back blocks on Monday (which is what
    // continuing from the previous slot's end used to produce).
    while (needed > 0) {
      const slot = findEarliestSlot(cursor, habit.durationMin, busy, weekEnd, getWindow, timeZone);
      if (!slot) break;
      if (usedDays.has(dateKey(slot.start, timeZone))) {
        cursor = startOfNextDay(slot.start);
        continue;
      }
      await prisma.event.create({
        data: {
          userId,
          habitId: habit.id,
          title: habit.title,
          start: slot.start,
          end: slot.end,
        },
      });
      // findEarliestSlot expects `busy` sorted, and the new block gets the
      // same buffer as everything else.
      busy.push(...padForBuffer([slot], settings.bufferMin));
      busy.sort((a, b) => a.start.getTime() - b.start.getTime());
      usedDays.add(dateKey(slot.start, timeZone));
      cursor = startOfNextDay(slot.start);
      needed--;
      placed++;
    }
  }

  return { placed };
}

/**
 * Companion to scheduler.ts's rescheduleConflictsWith, called alongside
 * it from the same event-create/move/update call sites — that function
 * only looks at Task-linked events, this looks at Habit-linked ones, so
 * a habit occurrence a new event lands on top of gets moved instead of
 * silently double-booked.
 */
export async function rescheduleConflictedHabits(
  userId: string,
  start: Date,
  end: Date,
  excludeEventId?: string,
): Promise<number> {
  const habitEvents = await prisma.event.findMany({
    where: { userId, habitId: { not: null } },
  });

  let count = 0;
  for (const event of habitEvents) {
    if (event.id === excludeEventId) continue;
    const conflict = event.start < end && event.end > start;
    if (conflict) {
      await rescheduleHabitOccurrence(userId, event.id);
      count++;
    }
  }
  return count;
}

/**
 * Re-places one conflicted-out habit occurrence somewhere else this
 * week, rather than just deleting it and leaving the habit under quota
 * until the next weekly sweep — the "flexes around your schedule"
 * behavior that's the whole point of a Habit vs. a fixed recurring
 * event. Falls back to deleting it if nothing else is open this week.
 */
export async function rescheduleHabitOccurrence(userId: string, eventId: string): Promise<void> {
  const event = await prisma.event.findFirst({ where: { id: eventId, userId, habitId: { not: null } } });
  if (!event || !event.habitId) return;

  const now = new Date();
  const weekEnd = addDays(startOfWeek(now), 7);
  const durationMin = (event.end.getTime() - event.start.getTime()) / 60_000;

  // Delete first so the occurrence's own old slot doesn't show up as
  // "busy" against itself when re-placing it.
  await prisma.event.delete({ where: { id: eventId } });

  const settings = await getAppSettings(userId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const busy = padForBuffer(await fetchBusyIntervals(userId, now, weekEnd), settings.bufferMin);
  const slot = findEarliestSlot(now, durationMin, busy, weekEnd, defaultWindowFn(timeZone), timeZone);
  if (slot) {
    await prisma.event.create({
      data: { userId, habitId: event.habitId, title: event.title, start: slot.start, end: slot.end },
    });
  }
}
