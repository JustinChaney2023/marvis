import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";

// MVP auto-scheduler: greedy earliest-fit within work hours, ordered by
// due date then priority — same weighting order as FluidCalendar's scoring
// (due date first, priority second), simplified to a strict sort instead
// of a weighted score. See docs/fluidcalendar.md.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const HORIZON_DAYS = 14;
const SLOT_GRANULARITY_MIN = 15;

function isWorkDay(date: Date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function roundUpToGranularity(date: Date) {
  const ms = SLOT_GRANULARITY_MIN * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function workWindowFor(date: Date) {
  const start = new Date(date);
  start.setHours(WORK_START_HOUR, 0, 0, 0);
  const end = new Date(date);
  end.setHours(WORK_END_HOUR, 0, 0, 0);
  return { start, end };
}

/**
 * Finds the earliest work-hours slot of `durationMin` that doesn't overlap
 * `busy` (must be pre-sorted by start, ascending), scanning from `from`
 * up to `horizonEnd`. Returns null if nothing fits.
 */
export function findEarliestSlot(
  from: Date,
  durationMin: number,
  busy: { start: Date; end: Date }[],
  horizonEnd: Date,
) {
  const durationMs = durationMin * 60_000;
  let cursor = roundUpToGranularity(from);

  while (cursor < horizonEnd) {
    if (!isWorkDay(cursor)) {
      cursor = workWindowFor(new Date(cursor.getTime() + 86_400_000)).start;
      continue;
    }

    const { start: dayStart, end: dayEnd } = workWindowFor(cursor);
    if (cursor < dayStart) cursor = dayStart;
    if (cursor >= dayEnd) {
      cursor = workWindowFor(new Date(cursor.getTime() + 86_400_000)).start;
      continue;
    }

    const slotEnd = new Date(cursor.getTime() + durationMs);
    if (slotEnd > dayEnd) {
      cursor = workWindowFor(new Date(cursor.getTime() + 86_400_000)).start;
      continue;
    }

    const conflict = busy.find((b) => b.start < slotEnd && b.end > cursor);
    if (!conflict) {
      return { start: cursor, end: slotEnd };
    }
    cursor = roundUpToGranularity(conflict.end);
  }

  return null;
}

export async function scheduleTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  // Recurring masters may have started long before `now` and still recur
  // into the horizon, so they can't be filtered by `start` — fetch them
  // unconditionally and expand into occurrences alongside one-off events.
  const existing = await prisma.event.findMany({
    where: {
      OR: [{ start: { lt: horizonEnd } }, { recurrenceRule: { not: null } }],
    },
  });
  const busy = expandEvents(existing, now, horizonEnd)
    .map((o) => ({ start: o.start, end: o.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slot = findEarliestSlot(now, task.durationMin, busy, horizonEnd);
  if (!slot) return null;

  const event = await prisma.event.upsert({
    where: { taskId },
    create: {
      title: task.title,
      start: slot.start,
      end: slot.end,
      taskId: task.id,
    },
    update: { start: slot.start, end: slot.end, title: task.title },
  });
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "SCHEDULED" },
  });

  return event;
}

/**
 * Schedules every TODO task, most urgent first. Runs sequentially — each
 * placed task becomes "busy" for the next, so order determines who gets
 * the good slots. Tasks that don't fit in the horizon are left as TODO.
 */
export async function scheduleAllPendingTasks() {
  const tasks = await prisma.task.findMany({
    where: { status: "TODO" },
    orderBy: [
      { dueAt: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
    ],
  });

  const results: { taskId: string; scheduled: boolean }[] = [];
  for (const task of tasks) {
    const event = await scheduleTask(task.id);
    results.push({ taskId: task.id, scheduled: event !== null });
  }
  return results;
}

export async function unscheduleTask(taskId: string) {
  await prisma.event.deleteMany({ where: { taskId } });
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "TODO" },
  });
}
