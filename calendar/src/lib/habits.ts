import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { fetchBusyIntervals, findEarliestSlot, padForBuffer } from "@/lib/scheduler";
import { startOfWeekMonday, addDays } from "@/lib/calendar-dates";

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
  const weekStart = startOfWeekMonday(now);
  const weekEnd = addDays(weekStart, 7);
  const settings = await getAppSettings(userId);

  let placed = 0;
  for (const habit of habits) {
    const existingCount = await prisma.event.count({
      where: { habitId: habit.id, start: { gte: weekStart, lt: weekEnd } },
    });
    let needed = habit.timesPerWeek - existingCount;
    if (needed <= 0) continue;

    // Re-fetched per habit rather than once up front — placing one
    // habit's occurrences changes what's busy for the next habit.
    const busy = padForBuffer(
      await fetchBusyIntervals(userId, now, weekEnd),
      settings.bufferMin,
    );
    let cursor = now > weekStart ? now : weekStart;

    while (needed > 0) {
      const slot = findEarliestSlot(cursor, habit.durationMin, busy, weekEnd);
      if (!slot) break;
      await prisma.event.create({
        data: {
          userId,
          habitId: habit.id,
          title: habit.title,
          start: slot.start,
          end: slot.end,
        },
      });
      busy.push(slot);
      cursor = slot.end;
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
  const weekEnd = addDays(startOfWeekMonday(now), 7);
  const durationMin = (event.end.getTime() - event.start.getTime()) / 60_000;

  // Delete first so the occurrence's own old slot doesn't show up as
  // "busy" against itself when re-placing it.
  await prisma.event.delete({ where: { id: eventId } });

  const settings = await getAppSettings(userId);
  const busy = padForBuffer(await fetchBusyIntervals(userId, now, weekEnd), settings.bufferMin);
  const slot = findEarliestSlot(now, durationMin, busy, weekEnd);
  if (slot) {
    await prisma.event.create({
      data: { userId, habitId: event.habitId, title: event.title, start: slot.start, end: slot.end },
    });
  }
}
