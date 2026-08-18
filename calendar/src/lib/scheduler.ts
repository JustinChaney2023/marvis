import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";
import { getAppSettings } from "@/lib/settings";
import type { TaskEnergy } from "@prisma/client";

// Auto-scheduler: work-hours earliest-fit as the primitive (findEarliestSlot,
// unit-tested directly), with a scored candidate search on top
// (findBestSlot) so a task doesn't always take the very first open slot —
// it takes the best of the next few, weighing energy-window match and
// due-date urgency. See docs/fluidcalendar.md for the FluidCalendar
// approach this is modeled after (deliberately simplified: a small bounded
// candidate scan instead of scoring every slot in the horizon).
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const HORIZON_DAYS = 14;
const SLOT_GRANULARITY_MIN = 15;
const CANDIDATE_LIMIT = 12;

// Deep-work (HIGH) tasks are scored toward morning focus hours, admin-ish
// (LOW) toward the afternoon; MEDIUM spans the whole work day (no real
// preference), which also keeps prior scheduleAllPendingTasks behavior
// close to unchanged for tasks that don't set an energy level.
const ENERGY_PREFERRED_HOURS: Record<TaskEnergy, [number, number]> = {
  HIGH: [9, 12],
  MEDIUM: [9, 18],
  LOW: [13, 18],
};

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

export function padForBuffer(
  busy: { start: Date; end: Date }[],
  bufferMin: number,
) {
  const ms = bufferMin * 60_000;
  return busy.map((b) => ({
    start: new Date(b.start.getTime() - ms),
    end: new Date(b.end.getTime() + ms),
  }));
}

function isEnergyMatch(energy: TaskEnergy, slotStart: Date): boolean {
  const [prefStart, prefEnd] = ENERGY_PREFERRED_HOURS[energy];
  const hour = slotStart.getHours();
  return hour >= prefStart && hour < prefEnd;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// +5 for landing on a day that already has another scheduled event from
// the same project — a same-subject/client/project day beats scattering
// related work across the week in 1-hour interleaved blocks, which was
// the single most specific complaint found researching what users wish
// Motion did differently (it schedules "reading for course A, a quiz for
// course B... all within a 1-hour block" instead of batching same-
// project work). Below the +10 energy-match bonus so a genuinely bad-
// energy slot still won't win just for being on the right day.
const PROJECT_CLUSTER_BONUS = 5;

function scoreSlot(
  energy: TaskEnergy,
  dueAt: Date | null,
  slot: { start: Date; end: Date },
  projectScheduledDays: Set<string>,
): number {
  let score = 0;
  if (isEnergyMatch(energy, slot.start)) score += 10;
  if (projectScheduledDays.has(dateKey(slot.start))) score += PROJECT_CLUSTER_BONUS;
  if (dueAt && slot.start > dueAt) score -= 100; // overshooting the due date is bad, but not disqualifying if it's the only option
  score -= slot.start.getTime() / 1e14; // tie-break toward the earlier candidate
  return score;
}

/**
 * Scans up to CANDIDATE_LIMIT earliest-fit slots and returns the
 * best-scored one (energy-window match, due-date urgency, same-project
 * day clustering), instead of always taking the very first. Stops early
 * once a candidate clears every criterion that's actually in play for
 * this task — nothing later could score better, so there's no reason to
 * keep scanning. When the task belongs to a project that already has
 * other scheduled days in this horizon, that criterion has to be met
 * too before stopping early, so clustering gets a real chance to compete
 * instead of always losing to whatever the very first energy-matched
 * slot happens to be.
 */
export function findBestSlot(
  task: { durationMin: number; dueAt: Date | null; energy: TaskEnergy },
  busy: { start: Date; end: Date }[],
  horizonEnd: Date,
  from: Date,
  projectScheduledDays: Set<string> = new Set(),
) {
  let cursor = from;
  let best: { start: Date; end: Date } | null = null;
  let bestScore = -Infinity;
  const wantsClustering = projectScheduledDays.size > 0;

  for (let i = 0; i < CANDIDATE_LIMIT; i++) {
    const slot = findEarliestSlot(cursor, task.durationMin, busy, horizonEnd);
    if (!slot) break;

    const score = scoreSlot(task.energy, task.dueAt, slot, projectScheduledDays);
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }

    const goodEnough =
      isEnergyMatch(task.energy, slot.start) &&
      (!task.dueAt || slot.start <= task.dueAt) &&
      (!wantsClustering || projectScheduledDays.has(dateKey(slot.start)));
    if (goodEnough) break;

    // Chasing a clustering match minute-by-minute would just crawl
    // through the current day's remaining open slots (there could be
    // hours of those) without ever reaching a different day within
    // CANDIDATE_LIMIT tries. Jump a full day per candidate instead so the
    // bounded scan actually samples multiple days for a project match —
    // non-clustered tasks keep the original fine-grained minute advance.
    cursor = wantsClustering
      ? new Date(slot.start.getFullYear(), slot.start.getMonth(), slot.start.getDate() + 1)
      : new Date(slot.start.getTime() + 60_000);
  }

  return best;
}

async function getProjectScheduledDays(
  projectId: string | null,
  excludeTaskId: string,
  now: Date,
  horizonEnd: Date,
): Promise<Set<string>> {
  if (!projectId) return new Set();
  const siblingEvents = await prisma.event.findMany({
    where: {
      start: { gte: now, lt: horizonEnd },
      task: { projectId, id: { not: excludeTaskId } },
    },
    select: { start: true },
  });
  return new Set(siblingEvents.map((e) => dateKey(e.start)));
}

async function fetchBusyIntervals(now: Date, horizonEnd: Date) {
  // Recurring masters may have started long before `now` and still recur
  // into the horizon, so they can't be filtered by `start` — fetch them
  // unconditionally and expand into occurrences alongside one-off events.
  const existing = await prisma.event.findMany({
    where: {
      OR: [{ start: { lt: horizonEnd } }, { recurrenceRule: { not: null } }],
    },
  });
  return expandEvents(existing, now, horizonEnd)
    .map((o) => ({ start: o.start, end: o.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function scheduleTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const settings = await getAppSettings();
  const busy = padForBuffer(
    await fetchBusyIntervals(now, horizonEnd),
    settings.bufferMin,
  );
  const projectScheduledDays = await getProjectScheduledDays(
    task.projectId,
    task.id,
    now,
    horizonEnd,
  );

  const slot = findBestSlot(task, busy, horizonEnd, now, projectScheduledDays);
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
 * A scheduled task's event is stale if its slot has fully elapsed without
 * the task being marked done (a missed block), or if something else now
 * overlaps it (the calendar changed underneath it — e.g. a manually
 * created event, or a since-added recurring series). Locked events are
 * never touched, even if stale, since locking is the user's explicit
 * "don't move this" signal.
 */
export async function rescheduleStaleTasks() {
  const now = new Date();
  const scheduledTasks = await prisma.task.findMany({
    where: { status: "SCHEDULED" },
    include: { event: true },
  });
  const allEvents = await prisma.event.findMany();

  let count = 0;
  for (const task of scheduledTasks) {
    const event = task.event;
    if (!event || event.locked) continue;

    const isPast = event.end <= now;
    const windowStart = new Date(event.start.getTime() - 86_400_000);
    const windowEnd = new Date(event.end.getTime() + 86_400_000);
    const others = allEvents.filter((e) => e.id !== event.id);
    const nearbyOccurrences = expandEvents(others, windowStart, windowEnd);
    const conflict = nearbyOccurrences.some(
      (o) => o.start < event.end && o.end > event.start,
    );

    if (isPast || conflict) {
      await unscheduleTask(task.id);
      await scheduleTask(task.id);
      count++;
    }
  }
  return count;
}

/**
 * Fixes stale task-events, then schedules every remaining TODO task, most
 * urgent first. Runs sequentially — each placed task becomes "busy" for
 * the next, so order determines who gets the good slots. Tasks that don't
 * fit in the horizon are left as TODO.
 */
export async function scheduleAllPendingTasks() {
  await rescheduleStaleTasks();

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
