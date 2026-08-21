import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";
import { getAppSettings } from "@/lib/settings";
import { getZonedDateParts, getZonedWeekday, zonedWallTimeToUtc } from "@/lib/timezone";
import type { TaskEnergy } from "@prisma/client";

const SERVER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function isWorkDay(date: Date, timeZone: string) {
  const day = getZonedWeekday(date, timeZone);
  return day !== 0 && day !== 6;
}

// Every real-world IANA zone's UTC offset is a whole multiple of 15
// minutes, so rounding on the plain UTC millisecond grid lands on the
// same wall-clock quarter-hour in any zone — no need to route this
// through zone-aware math.
function roundUpToGranularity(date: Date) {
  const ms = SLOT_GRANULARITY_MIN * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function workWindowFor(date: Date, timeZone: string) {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return {
    start: zonedWallTimeToUtc(year, month, day, WORK_START_HOUR, 0, timeZone),
    end: zonedWallTimeToUtc(year, month, day, WORK_END_HOUR, 0, timeZone),
  };
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
// schedules against, and what habits.ts uses (habits don't have their own
// working-hours setting yet). Falls back to the server's own zone for an
// account that hasn't set one yet (see User.timezone), so existing
// behavior is unchanged until a browser reports a real zone for it.
export function defaultWindowFn(timeZone: string): WindowFn {
  return (date) => (isWorkDay(date, timeZone) ? workWindowFor(date, timeZone) : null);
}

const WEEKDAY_CODE_FOR_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * Wraps a WindowFn to also reject any weekday in `excludeDays` (same
 * "SU,MO,TU,..." format as TimeSlot.daysOfWeek) — used by a booking
 * link's "no-meeting day" toggle to decline slots on chosen days without
 * touching the owner's own work-hours window. `base` already carries
 * whatever timezone it was built with; this only needs its own copy for
 * evaluating which weekday `date` falls on.
 */
export function excludeDaysWindowFn(
  excludeDays: string | null,
  base: WindowFn = defaultWindowFn(SERVER_TIMEZONE),
  timeZone: string = SERVER_TIMEZONE,
): WindowFn {
  if (!excludeDays) return base;
  const excluded = new Set(excludeDays.split(",").filter(Boolean));
  return (date: Date) =>
    excluded.has(WEEKDAY_CODE_FOR_DAY[getZonedWeekday(date, timeZone)]) ? null : base(date);
}

export function findEarliestSlot(
  from: Date,
  durationMin: number,
  busy: { start: Date; end: Date }[],
  horizonEnd: Date,
  getWindow: WindowFn = defaultWindowFn(SERVER_TIMEZONE),
  timeZone: string = SERVER_TIMEZONE,
) {
  const durationMs = durationMin * 60_000;
  let cursor = roundUpToGranularity(from);

  // Resets cursor to the next calendar day's midnight *in timeZone* — not
  // just "+24h", which preserves time-of-day and can get stuck (e.g.
  // cursor at 17:45 every day forever, always past a 9-6 window's end,
  // since 17:45 is never "before" that day's start either). Midnight
  // always is. Must track the target zone's own day boundary, not the
  // server's — otherwise this can skip or repeat a day for anyone whose
  // zone differs from the server's.
  const skipToNextDay = () => {
    const { year, month, day } = getZonedDateParts(cursor, timeZone);
    cursor = zonedWallTimeToUtc(year, month, day + 1, 0, 0, timeZone);
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

/** Builds a WindowFn from a "SU,MO,..." day list + minutes-since-midnight range. */
function windowFnFor(days: string, startMin: number, endMin: number, timeZone: string): WindowFn {
  const dayCodes = new Set(days.split(","));
  return (date: Date) => {
    if (!dayCodes.has(WEEKDAY_CODE_FOR_DAY[getZonedWeekday(date, timeZone)])) return null;
    const { year, month, day } = getZonedDateParts(date, timeZone);
    return {
      start: zonedWallTimeToUtc(year, month, day, 0, startMin, timeZone),
      end: zonedWallTimeToUtc(year, month, day, 0, endMin, timeZone),
    };
  };
}

/** Builds a WindowFn from a user-configured TimeSlot (Settings/TimeSlotsManager). */
export function windowFnForTimeSlot(
  slot: { daysOfWeek: string; startMin: number; endMin: number },
  timeZone: string = SERVER_TIMEZONE,
): WindowFn {
  return windowFnFor(slot.daysOfWeek, slot.startMin, slot.endMin, timeZone);
}

/**
 * Builds a WindowFn from a user's "working hours" AppSettings fields (#35)
 * — the real per-user replacement for the hardcoded 9-6 weekday default.
 */
export function windowFnForWorkingHours(
  settings: { workDays: string; workStartMin: number; workEndMin: number },
  timeZone: string = SERVER_TIMEZONE,
): WindowFn {
  return windowFnFor(settings.workDays, settings.workStartMin, settings.workEndMin, timeZone);
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

function isEnergyMatch(energy: TaskEnergy, slotStart: Date, timeZone: string): boolean {
  const [prefStart, prefEnd] = ENERGY_PREFERRED_HOURS[energy];
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(slotStart),
  );
  return hour >= prefStart && hour < prefEnd;
}

export function dateKey(d: Date, timeZone: string = SERVER_TIMEZONE): string {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  return `${year}-${month}-${day}`;
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
  timeZone: string,
): number {
  let score = 0;
  if (isEnergyMatch(energy, slot.start, timeZone)) score += 10;
  if (projectScheduledDays.has(dateKey(slot.start, timeZone))) score += PROJECT_CLUSTER_BONUS;
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
  timeZone: string = SERVER_TIMEZONE,
) {
  let cursor = from;
  let best: { start: Date; end: Date } | null = null;
  let bestScore = -Infinity;
  const wantsClustering = projectScheduledDays.size > 0;
  const limit = wantsClustering ? CLUSTERING_CANDIDATE_LIMIT : CANDIDATE_LIMIT;

  for (let i = 0; i < limit; i++) {
    const slot = findEarliestSlot(cursor, task.durationMin, busy, horizonEnd, getWindow, timeZone);
    if (!slot) break;

    const score = scoreSlot(task.energy, task.dueAt, slot, projectScheduledDays, timeZone);
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }

    const goodEnough =
      isEnergyMatch(task.energy, slot.start, timeZone) &&
      (!task.dueAt || slot.start <= task.dueAt) &&
      (!wantsClustering || projectScheduledDays.has(dateKey(slot.start, timeZone)));
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
  timeZone: string,
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
  return new Set(siblingEvents.map((e) => dateKey(e.start, timeZone)));
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
  timeZone: string,
): { start: Date; end: Date }[] {
  if (!capMin) return busy;

  const blocks: { start: Date; end: Date }[] = [];
  for (let day = new Date(now); day < horizonEnd; day = new Date(day.getTime() + 86_400_000)) {
    if (!isWorkDay(day, timeZone)) continue;
    const { start: dayStart, end: dayEnd } = workWindowFor(day, timeZone);
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
  // The one-off branch needs a proper interval-overlap check (also
  // bounded below by `now`), not just `start < horizonEnd` — an unbounded
  // lower end means this pulls in literally every one-off event the
  // account has ever had, including ones from a year ago, to answer "is
  // this the next 60 days busy." Same pattern page.tsx's own event query
  // already uses correctly.
  const existing = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        { start: { lt: horizonEnd }, end: { gt: now } },
        { recurrenceRule: { not: null } },
      ],
    },
  });
  return expandEvents(existing, now, horizonEnd)
    .map((o) => ({ start: o.start, end: o.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Intersects several participants' own work-hours WindowFns into one:
 * a candidate slot has to fall within *everyone's* window, each evaluated
 * in that person's own zone for the same absolute instant. Any participant
 * being off that calendar day (weekend, or a shorter/offset work window)
 * shrinks or kills the shared window for that day.
 */
function intersectWindowFns(fns: WindowFn[]): WindowFn {
  return (date) => {
    let result: DayWindow | null = null;
    for (const fn of fns) {
      const participantWindow = fn(date);
      if (!participantWindow) return null;
      if (!result) {
        result = participantWindow;
        continue;
      }
      const newStart: Date = participantWindow.start > result.start ? participantWindow.start : result.start;
      const newEnd: Date = participantWindow.end < result.end ? participantWindow.end : result.end;
      if (newStart >= newEnd) return null;
      result = { start: newStart, end: newEnd };
    }
    return result;
  };
}

/**
 * Group scheduling v1 — no new algorithm, just fetchBusyIntervals for
 * each participant unioned into one combined busy list, then the same
 * findEarliestSlot every solo schedule already uses. Only works for real
 * User accounts (each needs its own Event rows to compute busy time from
 * — an Assignee that isn't also a User has none). Authorization (who's
 * allowed to be included) is the caller's job, not this function's — see
 * findGroupMeetingSlotAction in actions.ts.
 *
 * Each participant's own working-hours settings and timezone (#46) are
 * honored and intersected — a slot only counts if it's within *everyone's*
 * own work window in their own local time, not just the requester's.
 */
export async function findGroupSlot(
  userIds: string[],
  durationMin: number,
  now: Date,
  horizonEnd: Date,
  bufferMin: number,
): Promise<{ start: Date; end: Date } | null> {
  const [perUserBusy, users, perUserSettings] = await Promise.all([
    Promise.all(userIds.map((id) => fetchBusyIntervals(id, now, horizonEnd))),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, timezone: true } }),
    Promise.all(userIds.map((id) => getAppSettings(id))),
  ]);
  const timeZoneById = new Map(users.map((u) => [u.id, u.timezone ?? SERVER_TIMEZONE]));
  const combinedBusy = padForBuffer(perUserBusy.flat(), bufferMin).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const getWindow = intersectWindowFns(
    perUserSettings.map((settings) =>
      windowFnForWorkingHours(settings, timeZoneById.get(settings.userId ?? "") ?? SERVER_TIMEZONE),
    ),
  );
  return findEarliestSlot(now, durationMin, combinedBusy, horizonEnd, getWindow, timeZoneById.get(userIds[0]));
}

// Splits a task's total duration into ~chunkMin-sized pieces (the last
// piece gets whatever's left over, so a 3h20m task with a 1h chunkMin is
// 1h/1h/1h/20m, not 1h/1h/1h + a dropped 20m). No chunking (chunkMin
// unset, or >= the total) is just "one chunk," the previous behavior.
export function splitIntoChunks(durationMin: number, chunkMin: number | null): number[] {
  if (!chunkMin || chunkMin <= 0 || chunkMin >= durationMin) return [durationMin];
  const chunks: number[] = [];
  let remaining = durationMin;
  while (remaining > 0) {
    const size = Math.min(chunkMin, remaining);
    chunks.push(size);
    remaining -= size;
  }
  return chunks;
}

export async function scheduleTask(userId: string, taskId: string) {
  const task = await prisma.task.findFirstOrThrow({
    where: { id: taskId, userId },
    include: { timeSlot: true, blockedBy: { select: { status: true } } },
  });
  // A task blocked by an unfinished dependency doesn't get a slot at
  // all — same "couldn't place it" signal (null) as no slot fitting in
  // the horizon. Every caller (scheduleAllPendingTasks, the per-task
  // "Schedule" button, reschedule sweeps) routes through here, so this
  // is the one place the guard needs to live.
  if (task.blockedBy.some((b) => b.status !== "DONE")) return null;

  const now = new Date();
  // startAt is a lower bound on when the scheduler may place this task,
  // not a hard commitment — never search before "now" even if startAt is
  // in the past.
  const searchFrom = task.startAt && task.startAt > now ? task.startAt : now;
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const [settings, owner] = await Promise.all([
    getAppSettings(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
  ]);
  const timeZone = owner.timezone ?? SERVER_TIMEZONE;
  const getWindow = task.timeSlot
    ? windowFnForTimeSlot(task.timeSlot, timeZone)
    : windowFnForWorkingHours(settings, timeZone);
  let busy = applyDailyCap(
    padForBuffer(await fetchBusyIntervals(userId, now, horizonEnd), settings.bufferMin),
    now,
    horizonEnd,
    settings.dailyCapMin,
    timeZone,
  );
  const projectScheduledDays = await getProjectScheduledDays(
    userId,
    task.projectId,
    task.id,
    now,
    horizonEnd,
    timeZone,
  );

  // Each chunk is searched in turn, folding the just-placed chunk (plus
  // the user's own bufferMin as breathing room — reusing that existing
  // setting rather than a second "gap between chunks" knob) into `busy`
  // before searching for the next one, so chunks of the same task never
  // land back-to-back with no gap or overlap each other. All-or-nothing:
  // if any chunk can't find a slot, the task stays unscheduled rather
  // than placing only some of its chunks — same as the unchunked case
  // returning null when nothing fits.
  const slots: { start: Date; end: Date }[] = [];
  let cursor = searchFrom;
  for (const chunkDuration of splitIntoChunks(task.durationMin, task.chunkMin)) {
    const slot = findBestSlot(
      { ...task, durationMin: chunkDuration },
      busy,
      horizonEnd,
      cursor,
      projectScheduledDays,
      getWindow,
      timeZone,
    );
    if (!slot) return null;
    slots.push(slot);
    busy = [...busy, ...padForBuffer([slot], settings.bufferMin)].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    cursor = slot.end;
  }

  // Not an upsert — a chunked reschedule can produce a different number
  // of rows than last time (a shorter chunkMin now, say), so the old set
  // is cleared and replaced wholesale rather than trying to reconcile.
  await prisma.event.deleteMany({ where: { taskId } });
  await prisma.event.createMany({
    data: slots.map((slot) => ({
      userId,
      title: task.title,
      start: slot.start,
      end: slot.end,
      taskId: task.id,
      localDirty: true,
    })),
  });
  // Scheduling doesn't change the task's lifecycle status — having a
  // calendar slot (these Event rows existing) is tracked independently
  // of CREATED/ONGOING/DELAYED/DONE. A task can be "ongoing" whether or
  // not it has a slot, and a scheduled task is still just "created"
  // until marked otherwise.

  return prisma.event.findMany({ where: { taskId }, orderBy: { start: "asc" } });
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
    where: { userId, events: { some: {} } },
    include: { events: true },
  });

  let count = 0;
  for (const task of scheduledTasks) {
    // A chunked task's chunks (task.events, plural) are still always
    // one-off, never recurring, so a plain interval check per chunk is
    // enough. Any locked chunk exempts the whole task, same "don't touch
    // it" contract as an unchunked locked event — rescheduling would
    // otherwise wipe that locked chunk along with the rest via
    // unscheduleTask's delete-all-events-for-this-task.
    if (task.events.some((e) => e.locked)) continue;
    const conflict = task.events.some(
      (event) => event.id !== excludeEventId && event.start < end && event.end > start,
    );
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
    where: { userId, events: { some: {} } },
    include: { events: true },
  });
  const allEvents = await prisma.event.findMany({ where: { userId } });

  let count = 0;
  for (const task of scheduledTasks) {
    // Any locked chunk exempts the whole task — see rescheduleConflictsWith.
    if (task.events.some((e) => e.locked)) continue;

    const isStale = task.events.some((event) => {
      const isPast = event.end <= now;
      const windowStart = new Date(event.start.getTime() - 86_400_000);
      const windowEnd = new Date(event.end.getTime() + 86_400_000);
      const others = allEvents.filter((e) => e.id !== event.id);
      const nearbyOccurrences = expandEvents(others, windowStart, windowEnd);
      const conflict = nearbyOccurrences.some(
        (o) => o.start < event.end && o.end > event.start,
      );
      return isPast || conflict;
    });

    if (isStale) {
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
      events: { none: {} },
      parentId: null,
    },
    // Hard deadlines get first claim on open slots as a whole tier,
    // ahead of every soft-deadline task regardless of due date — Motion's
    // documented precedence order (ASAP > hard deadline > soft deadline >
    // priority), simplified since this app has no ASAP concept. Within
    // the same tier, soonest due date first, then priority as the final
    // tiebreaker.
    orderBy: [
      { hardDeadline: "desc" },
      { dueAt: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
    ],
  });

  const results: { taskId: string; scheduled: boolean }[] = [];
  for (const task of tasks) {
    const events = await scheduleTask(userId, task.id);
    results.push({ taskId: task.id, scheduled: events !== null });
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
    where: { userId, events: { some: {} } },
    include: { events: true },
  });
  for (const task of scheduledTasks) {
    if (task.events.some((e) => e.locked)) continue;
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
