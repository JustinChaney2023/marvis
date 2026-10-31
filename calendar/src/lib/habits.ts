import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { windowFnForWorkingHours, fetchBusyIntervals, findEarliestSlot, padForBuffer, dateKey } from "@/lib/scheduler";
import { startOfWeek, startOfDay, addDays } from "@/lib/calendar-dates";
import { getZonedDateParts, zonedWallTimeToUtc } from "@/lib/timezone";
import type { Habit } from "@prisma/client";

// How many days out to top up in one call — lets a habit fill weeks
// beyond the current one (a fully-booked week, or a week with fewer
// workdays than timesPerWeek, would otherwise sit at 0 until something
// re-triggers scheduling for that later week specifically).
const WEEKS_AHEAD = 4;
const HORIZON_DAYS = WEEKS_AHEAD * 7;

type BusyInterval = { start: Date; end: Date };
type ScheduleCtx = {
  userId: string;
  now: Date;
  horizonEnd: Date;
  getWindow: ReturnType<typeof windowFnForWorkingHours>;
  timeZone: string;
  bufferMin: number;
};

// findEarliestSlot expects `busy` sorted, and a newly placed block gets the
// same buffer as everything else.
function addBusy(ctx: ScheduleCtx, busy: BusyInterval[], slot: BusyInterval) {
  busy.push(...padForBuffer([slot], ctx.bufferMin));
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Advances to the start of the NEXT day, not just past a slot's end — a
// habit's occurrences spread across different days, not back-to-back
// sessions on the first day that has room. Built from the owner's
// timeZone, not the server's local clock — otherwise this can skip or
// repeat a day for anyone whose zone differs from the server's (same
// reasoning as scheduler.ts's skipToNextDay).
function nextDayStart(from: Date, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(from, timeZone);
  return zonedWallTimeToUtc(year, month, day + 1, 0, 0, timeZone);
}

/** Tops up a WEEKLY-cadence habit to timesPerWeek for every week in the horizon. */
async function topUpWeekly(ctx: ScheduleCtx, habit: Habit, busy: BusyInterval[]): Promise<number> {
  let placed = 0;
  let weekStart = startOfWeek(ctx.now);
  for (let week = 0; week < WEEKS_AHEAD; week++, weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 7);
    const existing = await prisma.event.findMany({
      where: { habitId: habit.id, start: { gte: weekStart, lt: weekEnd } },
      select: { start: true },
    });
    const usedDays = new Set(existing.map((e) => dateKey(e.start, ctx.timeZone)));
    let needed = habit.timesPerWeek - existing.length;
    if (needed <= 0) continue;
    let cursor = ctx.now > weekStart ? ctx.now : weekStart;

    // One occurrence per day — "gym 3x a week" means three different
    // days, not three back-to-back blocks on Monday (which is what
    // continuing from the previous slot's end used to produce).
    while (needed > 0) {
      const slot = findEarliestSlot(cursor, habit.durationMin, busy, weekEnd, ctx.getWindow, ctx.timeZone);
      if (!slot) break;
      if (usedDays.has(dateKey(slot.start, ctx.timeZone))) {
        cursor = nextDayStart(slot.start, ctx.timeZone);
        continue;
      }
      await prisma.event.create({
        data: { userId: ctx.userId, habitId: habit.id, title: habit.title, notes: habit.notes, start: slot.start, end: slot.end },
      });
      addBusy(ctx, busy, slot);
      usedDays.add(dateKey(slot.start, ctx.timeZone));
      cursor = nextDayStart(slot.start, ctx.timeZone);
      needed--;
      placed++;
    }
  }
  return placed;
}

/**
 * Tops up an INTERVAL-cadence habit ("every N days") across the whole
 * horizon on a rolling basis, rather than week-aligned — the next
 * occurrence is due intervalDays after the last one *actually placed*
 * (not the ideal date), so a slot that slipped a day doesn't compound
 * into every later occurrence sliding too.
 */
async function topUpInterval(ctx: ScheduleCtx, habit: Habit, busy: BusyInterval[]): Promise<number> {
  const intervalDays = habit.intervalDays ?? 1;
  const lastEvent = await prisma.event.findFirst({
    where: { habitId: habit.id },
    orderBy: { start: "desc" },
  });
  let dueAt = lastEvent ? addDays(lastEvent.start, intervalDays) : ctx.now;

  let placed = 0;
  // Bounded by the horizon itself, not an iteration count — each
  // successful placement advances dueAt by at least intervalDays, so this
  // can't loop more than HORIZON_DAYS / intervalDays times regardless.
  while (dueAt < ctx.horizonEnd) {
    const cursor = ctx.now > dueAt ? ctx.now : dueAt;
    const slot = findEarliestSlot(cursor, habit.durationMin, busy, ctx.horizonEnd, ctx.getWindow, ctx.timeZone);
    if (!slot) break;
    await prisma.event.create({
      data: { userId: ctx.userId, habitId: habit.id, title: habit.title, notes: habit.notes, start: slot.start, end: slot.end },
    });
    addBusy(ctx, busy, slot);
    dueAt = addDays(slot.start, intervalDays);
    placed++;
  }
  return placed;
}

/**
 * Tops up each enabled, non-MANUAL habit for the next few weeks
 * (WEEKS_AHEAD) — WEEKLY habits to their timesPerWeek quota each week,
 * INTERVAL habits spaced intervalDays apart on a rolling basis. Placement
 * itself is the same open-slot search scheduleTask uses for tasks, against
 * the user's own configured working hours. Never touches occurrences that
 * already exist; this only fills the gap between what's already placed and
 * what's still owed. Occurrences that get conflicted out by something else
 * are re-placed by rescheduleConflictsWith (scheduler.ts) via
 * rescheduleHabitOccurrence below, not here — this is the top-up, that's
 * the continuous "don't just drop it" half. MANUAL ("as needed") habits
 * get no automatic placement at all — see scheduleNextHabitOccurrence.
 */
export async function scheduleHabitsForWeek(userId: string): Promise<{ placed: number }> {
  const habits = await prisma.habit.findMany({ where: { userId, enabled: true, cadence: { not: "MANUAL" } } });
  if (habits.length === 0) return { placed: 0 };

  const now = new Date();
  const settings = await getAppSettings(userId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const horizonEnd = addDays(startOfWeek(now), 7 * WEEKS_AHEAD);
  const ctx: ScheduleCtx = {
    userId,
    now,
    horizonEnd,
    getWindow: windowFnForWorkingHours(settings, timeZone),
    timeZone,
    bufferMin: settings.bufferMin,
  };

  let placed = 0;
  for (const habit of habits) {
    // Re-fetched per habit rather than once up front — placing one
    // habit's occurrences changes what's busy for the next habit.
    const busy = padForBuffer(await fetchBusyIntervals(userId, now, horizonEnd, timeZone), settings.bufferMin);
    placed += habit.cadence === "INTERVAL" ? await topUpInterval(ctx, habit, busy) : await topUpWeekly(ctx, habit, busy);
  }

  return { placed };
}

/**
 * Places exactly one occurrence right now, for a MANUAL ("as needed")
 * habit's "Schedule now" button — or for any habit, as an on-demand
 * top-up outside the regular sweep. Looks HORIZON_DAYS ahead for the
 * first open slot; doesn't check any quota, so calling it repeatedly on
 * the same habit just keeps adding occurrences.
 */
export async function scheduleNextHabitOccurrence(userId: string, habitId: string): Promise<{ placed: boolean }> {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) return { placed: false };

  const now = new Date();
  const settings = await getAppSettings(userId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const horizonEnd = addDays(startOfDay(now), HORIZON_DAYS);
  const busy = padForBuffer(await fetchBusyIntervals(userId, now, horizonEnd, timeZone), settings.bufferMin);
  const slot = findEarliestSlot(now, habit.durationMin, busy, horizonEnd, windowFnForWorkingHours(settings, timeZone), timeZone);
  if (!slot) return { placed: false };

  await prisma.event.create({
    data: { userId, habitId: habit.id, title: habit.title, notes: habit.notes, start: slot.start, end: slot.end },
  });
  return { placed: true };
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
  // "busy" against itself when re-placing it. (prisma.ts queues the Google
  // copy for deletion on the next sync.)
  await prisma.event.delete({ where: { id: eventId } });

  const settings = await getAppSettings(userId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const busy = padForBuffer(await fetchBusyIntervals(userId, now, weekEnd, timeZone), settings.bufferMin);
  const slot = findEarliestSlot(now, durationMin, busy, weekEnd, windowFnForWorkingHours(settings, timeZone), timeZone);
  if (slot) {
    await prisma.event.create({
      data: { userId, habitId: event.habitId, title: event.title, notes: event.notes, start: slot.start, end: slot.end },
    });
  }
}
