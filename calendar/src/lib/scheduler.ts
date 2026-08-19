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
// Clustering's search needs to compare across days, not just within one —
// a wider budget than the default lets it actually sample multiple whole
// workdays at half-hour granularity (see the day-jump note below).
const CLUSTERING_CANDIDATE_LIMIT = 40;

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
export type DayWindow = { start: Date; end: Date };
export type WindowFn = (date: Date) => DayWindow | null;

// Default: the app's original hardcoded 9am-6pm-weekdays assumption,
// still what a task with no assigned TimeSlot (settings/TimeSlotsManager)
// schedules against.
function defaultWindowFn(date: Date): DayWindow | null {
  return isWorkDay(date) ? workWindowFor(date) : null;
}

export function findEarliestSlot(
  from: Date,
  durationMin: number,
  busy: { start: Date; end: Date }[],
  horizonEnd: Date,
  getWindow: WindowFn = defaultWindowFn,
) {
  const durationMs = durationMin * 60_000;
  let cursor = roundUpToGranularity(from);

  // Resets cursor to the next calendar day's midnight — not just "+24h",
  // which preserves time-of-day and can get stuck (e.g. cursor at 17:45
  // every day forever, always past a 9-6 window's end, since 17:45 is
  // never "before" that day's start either). Midnight always is.
  const skipToNextDay = () => {
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    cursor = next;
  };

  while (cursor < horizonEnd) {
    const window = getWindow(cursor);
    if (!window) {
      skipToNextDay();
      continue;
    }

    const { start: dayStart, end: dayEnd } = window;
    if (cursor < dayStart) cursor = dayStart;
    if (cursor >= dayEnd) {
      skipToNextDay();
      continue;
    }

    const slotEnd = new Date(cursor.getTime() + durationMs);
    if (slotEnd > dayEnd) {
      skipToNextDay();
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

/** Builds a WindowFn from a user-configured TimeSlot (Settings/TimeSlotsManager). */
export function windowFnForTimeSlot(slot: {
  daysOfWeek: string;
  startMin: number;
  endMin: number;
}): WindowFn {
  const days = new Set(slot.daysOfWeek.split(","));
  const codeForDay = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return (date: Date) => {
    if (!days.has(codeForDay[date.getDay()])) return null;
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(slot.startMin);
    const end = new Date(date);
    end.setHours(0, 0, 0, 0);
    end.setMinutes(slot.endMin);
    return { start, end };
  };
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
  getWindow?: WindowFn,
) {
  let cursor = from;
  let best: { start: Date; end: Date } | null = null;
  let bestScore = -Infinity;
  const wantsClustering = projectScheduledDays.size > 0;
  const limit = wantsClustering ? CLUSTERING_CANDIDATE_LIMIT : CANDIDATE_LIMIT;

  for (let i = 0; i < limit; i++) {
    const slot = findEarliestSlot(cursor, task.durationMin, busy, horizonEnd, getWindow);
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

    // A full-day jump per rejected candidate (an earlier version of this)
    // could skip a later same-day slot that would have scored better than
    // whatever the next day offers — e.g. a same-day energy-matched slot
    // beating a cluster-matched-but-energy-mismatched one on a different
    // day. A 30-minute step (matching ENERGY_PREFERRED_HOURS' hour-scale
    // granularity) with a wider CLUSTERING_CANDIDATE_LIMIT still reaches
    // multiple days within the bounded scan, without giving up on the
    // current day after a single rejected candidate. Non-clustered tasks
    // keep the original fine-grained minute advance.
    cursor = wantsClustering
      ? new Date(slot.start.getTime() + 30 * 60_000)
      : new Date(slot.start.getTime() + 60_000);
  }

  return best;
}

async function getProjectScheduledDays(
  userId: string,
  projectId: string | null,
  excludeTaskId: string,
  now: Date,
  horizonEnd: Date,
): Promise<Set<string>> {
  if (!projectId) return new Set();
  const siblingEvents = await prisma.event.findMany({
    where: {
      userId,
      start: { gte: now, lt: horizonEnd },
      task: { projectId, id: { not: excludeTaskId } },
    },
    select: { start: true },
  });
  return new Set(siblingEvents.map((e) => dateKey(e.start)));
}

/**
 * "Breathing room" cap — once a work day's already-busy minutes (within
 * work hours) reach `capMin`, blocks the rest of that day's work window
 * as synthetic busy time so findEarliestSlot skips straight to the next
 * day. Approximate on purpose (a task that starts before the cap is hit
 * can still land partly past it) rather than tracking exact remaining
 * budget — the goal is "leave some slack most days," not a hard ceiling.
 */
function applyDailyCap(
  busy: { start: Date; end: Date }[],
  now: Date,
  horizonEnd: Date,
  capMin: number | null,
): { start: Date; end: Date }[] {
  if (!capMin) return busy;

  const blocks: { start: Date; end: Date }[] = [];
  for (let day = new Date(now); day < horizonEnd; day = new Date(day.getTime() + 86_400_000)) {
    if (!isWorkDay(day)) continue;
    const { start: dayStart, end: dayEnd } = workWindowFor(day);
    const busyMinutes = busy.reduce((sum, b) => {
      const overlapStart = b.start > dayStart ? b.start : dayStart;
      const overlapEnd = b.end < dayEnd ? b.end : dayEnd;
      const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
      return overlapMs > 0 ? sum + overlapMs / 60_000 : sum;
    }, 0);
    if (busyMinutes >= capMin) {
      blocks.push({ start: dayStart, end: dayEnd });
    }
  }
  return busy.concat(blocks);
}

export async function fetchBusyIntervals(userId: string, now: Date, horizonEnd: Date) {
  // Recurring masters may have started long before `now` and still recur
  // into the horizon, so they can't be filtered by `start` — fetch them
  // unconditionally and expand into occurrences alongside one-off events.
  const existing = await prisma.event.findMany({
    where: {
      userId,
      OR: [{ start: { lt: horizonEnd } }, { recurrenceRule: { not: null } }],
    },
  });
  return expandEvents(existing, now, horizonEnd)
    .map((o) => ({ start: o.start, end: o.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function scheduleTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirstOrThrow({
    where: { id: taskId, userId },
    include: { timeSlot: true },
  });
  const getWindow = task.timeSlot ? windowFnForTimeSlot(task.timeSlot) : undefined;

  const now = new Date();
  // startAt is a lower bound on when the scheduler may place this task,
  // not a hard commitment — never search before "now" even if startAt is
  // in the past.
  const searchFrom = task.startAt && task.startAt > now ? task.startAt : now;
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const settings = await getAppSettings(userId);
  const busy = applyDailyCap(
    padForBuffer(await fetchBusyIntervals(userId, now, horizonEnd), settings.bufferMin),
    now,
    horizonEnd,
    settings.dailyCapMin,
  );
  const projectScheduledDays = await getProjectScheduledDays(
    userId,
    task.projectId,
    task.id,
    now,
    horizonEnd,
  );

  const slot = findBestSlot(task, busy, horizonEnd, searchFrom, projectScheduledDays, getWindow);
  if (!slot) return null;

  const event = await prisma.event.upsert({
    where: { taskId },
    create: {
      userId,
      title: task.title,
      start: slot.start,
      end: slot.end,
      taskId: task.id,
      localDirty: true,
    },
    update: { start: slot.start, end: slot.end, title: task.title, localDirty: true },
  });
  // Scheduling doesn't change the task's lifecycle status — having a
  // calendar slot (this Event row existing) is tracked independently of
  // CREATED/ONGOING/DELAYED/DONE. A task can be "ongoing" whether or not
  // it has a slot, and a scheduled task is still just "created" until
  // marked otherwise.

  return event;
}

/**
 * Immediately re-plans any unlocked scheduled task whose event now
 * overlaps `[start, end)` — called right after creating/moving/booking
 * an event, so a new conflict gets fixed the moment it's created instead
 * of waiting for the next full Schedule-all/Reschedule-all pass.
 * `excludeEventId` skips the event being created/moved itself (e.g.
 * dragging a scheduled task's own block shouldn't count as "conflicting
 * with itself").
 */
export async function rescheduleConflictsWith(
  userId: string,
  start: Date,
  end: Date,
  excludeEventId?: string,
): Promise<number> {
  const scheduledTasks = await prisma.task.findMany({
    where: { userId, event: { isNot: null } },
    include: { event: true },
  });

  let count = 0;
  for (const task of scheduledTasks) {
    const event = task.event;
    if (!event || event.locked || event.id === excludeEventId) continue;
    // A scheduled task's own event is always a single occurrence (the
    // scheduler creates one per task, never a recurring one), so a plain
    // interval check is enough — no need to expand recurrence here.
    const conflict = event.start < end && event.end > start;
    if (conflict) {
      await unscheduleTask(userId, task.id);
      await scheduleTask(userId, task.id);
      count++;
    }
  }
  return count;
}

/**
 * A scheduled task's event is stale if its slot has fully elapsed without
 * the task being marked done (a missed block), or if something else now
 * overlaps it (the calendar changed underneath it — e.g. a manually
 * created event, or a since-added recurring series). Locked events are
 * never touched, even if stale, since locking is the user's explicit
 * "don't move this" signal.
 */
export async function rescheduleStaleTasks(userId: string) {
  const now = new Date();
  const scheduledTasks = await prisma.task.findMany({
    where: { userId, event: { isNot: null } },
    include: { event: true },
  });
  const allEvents = await prisma.event.findMany({ where: { userId } });

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
      await unscheduleTask(userId, task.id);
      await scheduleTask(userId, task.id);
      count++;
    }
  }
  return count;
}

/**
 * Fixes stale task-events, then schedules every remaining unscheduled
 * CREATED/ONGOING task, most urgent first. Runs sequentially — each
 * placed task becomes "busy" for the next, so order determines who gets
 * the good slots. Tasks that don't fit in the horizon are left as-is.
 * DELAYED tasks are deliberately excluded — that's the whole point of
 * delaying one, and DONE tasks obviously don't need a slot.
 */
export async function scheduleAllPendingTasks(userId: string) {
  await rescheduleStaleTasks(userId);

  const tasks = await prisma.task.findMany({
    // Subtasks are checklist items under a parent task, not independently
    // schedulable calendar blocks — exclude them from the sweep.
    where: {
      userId,
      status: { in: ["CREATED", "ONGOING"] },
      event: { is: null },
      parentId: null,
    },
    orderBy: [
      { dueAt: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
    ],
  });

  const results: { taskId: string; scheduled: boolean }[] = [];
  for (const task of tasks) {
    const event = await scheduleTask(userId, task.id);
    results.push({ taskId: task.id, scheduled: event !== null });
  }
  return results;
}

/**
 * Motion's "reschedule all" — unlike scheduleAllPendingTasks (which only
 * fixes stale slots and places brand-new tasks), this re-plans EVERY
 * unlocked scheduled task from scratch, not just the ones that drifted.
 * Useful after a due date changes, a bunch of tasks got added out of
 * order, or the calendar just feels like it needs a fresh pass. Locked
 * events (including ones tied to a task, e.g. a manually-pinned slot)
 * are left exactly where they are — same "don't touch it" contract as
 * everywhere else in the scheduler.
 */
export async function rescheduleAll(userId: string) {
  const scheduledTasks = await prisma.task.findMany({
    where: { userId, event: { isNot: null } },
    include: { event: true },
  });
  for (const task of scheduledTasks) {
    if (task.event?.locked) continue;
    await unscheduleTask(userId, task.id);
  }
  return scheduleAllPendingTasks(userId);
}

export async function unscheduleTask(userId: string, taskId: string) {
  // Doesn't touch status — a task's lifecycle (CREATED/ONGOING/DELAYED/
  // DONE) is independent of whether it currently has a calendar slot.
  // Losing its slot just puts it back in scheduleAllPendingTasks' sweep
  // (status in [CREATED, ONGOING] and no event), which needs no status
  // change to work.
  await prisma.event.deleteMany({ where: { taskId, userId } });
}
