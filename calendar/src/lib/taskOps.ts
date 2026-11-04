import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";
import { runAutomationsForStatusChange } from "@/lib/automations";
import { nextTaskOccurrence } from "@/lib/taskRecurrence";
import { compareUrgency, isDeferred, scheduleAllPendingTasks, scheduleTask } from "@/lib/scheduler";
import { getAppSettings } from "@/lib/settings";
import { userTimeZone } from "@/lib/timezone";

// Shared between the toggleTaskDone server action and the MCP endpoint
// (src/app/api/mcp) — completing a task has real side effects (timer
// fold-in, automations, the next recurring occurrence), so both callers
// go through the one implementation instead of the MCP path writing
// status: "DONE" directly and silently skipping them.

// Folds elapsed time since `timerStartedAt` into `trackedMinutes` and
// clears it — called by every action that moves a task away from
// ONGOING, so time is never silently lost (only ever added once, since
// timerStartedAt is cleared in the same write).
export function stoppedTimerFields(task: { timerStartedAt: Date | null; trackedMinutes: number }) {
  if (!task.timerStartedAt) return { patch: {}, elapsedMin: 0 };
  const elapsedMin = Math.max(0, Math.round((Date.now() - task.timerStartedAt.getTime()) / 60_000));
  return {
    patch: {
      trackedMinutes: task.trackedMinutes + elapsedMin,
      timerStartedAt: null,
    },
    elapsedMin,
  };
}

// One row per timer stop, for the time-tracking report — the plain
// cumulative Task.trackedMinutes total can't be bucketed by week on its
// own. Fire-and-forget-adjacent (awaited, but never blocks/fails the
// status change it's attached to since a broken report is much lower
// stakes than a task update failing).
export async function logTrackedTime(userId: string, taskId: string, elapsedMin: number) {
  if (elapsedMin <= 0) return;
  try {
    await prisma.timeLogEntry.create({ data: { userId, taskId, minutes: elapsedMin } });
  } catch (err) {
    console.error("logTrackedTime failed:", err);
  }
}

/** Returns false when the task doesn't exist or isn't this user's. */
export async function setTaskDone(userId: string, taskId: string, done: boolean): Promise<boolean> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId }, include: { events: true } });
  if (!existing) return false;

  const timerStop = stoppedTimerFields(existing);
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: done ? "DONE" : "CREATED",
      ...timerStop.patch,
    },
  });
  await logTrackedTime(userId, taskId, timerStop.elapsedMin);

  // Completing ahead of schedule shouldn't leave the block sitting there
  // showing time that was never actually worked — same "end becomes now"
  // truncation endTaskFocus already does for solo focus sessions. Never
  // deletes the block (that reads as "vanished"); a chunk whose start was
  // still in the future gets pulled back to now too, so it always lands
  // right at "now". A locked chunk is left alone, same "don't touch it"
  // contract as everywhere else.
  if (done) {
    const now = new Date();
    let finishedEarly = false;
    for (const event of existing.events) {
      if (event.locked || event.end <= now) continue;
      finishedEarly = true;
      // Already in progress — its real start stands, just clip the end to
      // now. Hasn't started yet — keep its planned duration, anchored to
      // end now, rather than collapsing a real block to a 1-minute sliver.
      const durationMs = event.end.getTime() - event.start.getTime();
      const start = event.start < now ? event.start : new Date(now.getTime() - durationMs);
      await prisma.event.update({ where: { id: event.id }, data: { start, end: now } });
    }
    // Finishing early frees up the rest of the block — resweep so a pending
    // task can slide into the gap instead of waiting for the next poll.
    if (finishedEarly) await scheduleAllPendingTasks(userId);
  }
  if (done && existing.status !== "DONE") await placeUnblockedBy(userId, taskId);
  runAutomationsForStatusChange(userId, taskId, task.status).catch((err) =>
    console.error("automation error:", err),
  );

  // Recurring tasks aren't expanded like recurring events — completing one
  // materializes the next occurrence as a new row, since a task carries
  // per-instance state (status, its own scheduled event) that doesn't fit
  // the "compute on the fly" model.
  // Only on a real not-done -> done transition, and only if that next
  // occurrence doesn't already exist — done, undo, done again used to
  // spawn a second copy.
  if (done && existing.status !== "DONE" && task.recurrenceRule && task.dueAt) {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const nextDueAt = nextTaskOccurrence(task.recurrenceRule, task.dueAt, userTimeZone(owner));
    const alreadySpawned =
      nextDueAt &&
      (await prisma.task.findFirst({
        where: { userId, title: task.title, recurrenceRule: task.recurrenceRule, dueAt: nextDueAt, parentId: null },
        select: { id: true },
      }));
    if (nextDueAt && !alreadySpawned) {
      const labels = await prisma.label.findMany({ where: { tasks: { some: { id: task.id } } }, select: { id: true } });
      await prisma.task.create({
        data: {
          userId,
          title: task.title,
          notes: task.notes,
          priority: task.priority,
          energy: task.energy,
          durationMin: task.durationMin,
          dueAt: nextDueAt,
          projectId: task.projectId,
          assigneeId: task.assigneeId,
          recurrenceRule: task.recurrenceRule,
          hardDeadline: task.hardDeadline,
          color: task.color,
          chunkMin: task.chunkMin,
          timeSlotId: task.timeSlotId,
          labels: { connect: labels },
        },
      });
    }
  }
  return true;
}

/**
 * Loose project lookup for typed names ("#bio", or an assistant saying
 * "the Biology project") — exact name first, then prefix, then substring,
 * all case-insensitive. Null when nothing matches.
 */
export async function findProjectByName(
  userId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const projects = await prisma.project.findMany({ where: { userId }, select: { id: true, name: true } });
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    projects.find((p) => p.name.toLowerCase() === needle) ??
    projects.find((p) => p.name.toLowerCase().startsWith(needle)) ??
    projects.find((p) => p.name.toLowerCase().includes(needle)) ??
    null
  );
}

/**
 * Finishing a blocker frees whatever was waiting on it. With Auto-schedule
 * on, place those tasks right away (most urgent first) instead of leaving
 * them for the next sweep.
 */
async function placeUnblockedBy(userId: string, blockerId: string) {
  const settings = await getAppSettings(userId);
  if (!settings.autoSchedule) return;
  const freed = await prisma.task.findMany({
    where: {
      userId,
      parentId: null,
      status: { in: ["CREATED", "ONGOING"] },
      events: { none: {} },
      blockedBy: { some: { id: blockerId } },
      NOT: { blockedBy: { some: { status: { not: "DONE" } } } },
    },
  });
  for (const t of freed.filter((t) => !isDeferred(t)).sort(compareUrgency)) {
    await scheduleTask(userId, t.id).catch((err) => console.error("unblock placement failed:", err));
  }
}

/**
 * Replaces a task's prerequisites. A task can't depend on itself, and a
 * blocker that (directly or further down) waits on this task would make a
 * cycle neither could escape. Returns the ids that were refused
 * (cycles, or not the user's), so the MCP can say so; the UI ignores it.
 */
export async function setTaskBlockedBy(userId: string, taskId: string, blockedByIds: string[]): Promise<string[]> {
  const ids = [...new Set(blockedByIds.filter((id) => id !== taskId))];
  if (ids.length === 0) {
    await prisma.task.update({ where: { id: taskId }, data: { blockedBy: { set: [] } } });
    return [];
  }
  const blockers = await prisma.task.findMany({ where: { id: { in: ids }, userId } });
  const allowed: string[] = [];
  for (const blocker of blockers) {
    if (!(await dependsOn(blocker.id, taskId))) allowed.push(blocker.id);
  }
  await prisma.task.update({
    where: { id: taskId },
    data: { blockedBy: { set: allowed.map((id) => ({ id })) } },
  });
  return ids.filter((id) => !allowed.includes(id));
}

/** Whether `taskId` is (transitively) blocked by `targetId`. */
async function dependsOn(taskId: string, targetId: string): Promise<boolean> {
  const seen = new Set<string>([taskId]);
  let frontier = [taskId];
  while (frontier.length > 0) {
    const rows = await prisma.task.findMany({
      where: { id: { in: frontier } },
      select: { blockedBy: { select: { id: true } } },
    });
    const next: string[] = [];
    for (const id of rows.flatMap((r) => r.blockedBy.map((b) => b.id))) {
      if (id === targetId) return true;
      if (!seen.has(id)) {
        seen.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Deletes a task with its calendar blocks and uploaded files. Shared by the
 * task-list delete, the MCP tools, and deleting a task's block from the
 * calendar. Safe to call twice for the same task (bulk-deleting several
 * chunks of one task does exactly that): the second call finds nothing.
 */
export async function deleteTask(userId: string, taskId: string): Promise<string | null> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { title: true } });
  if (!task) return null;
  // Attachment rows cascade with the Task, but the files on disk don't —
  // best-effort, a missing file shouldn't block the delete.
  const attachments = await prisma.taskAttachment.findMany({ where: { taskId }, select: { storedPath: true } });
  await Promise.all(
    attachments.map(async (a) => {
      const absolute = resolveUploadPath(a.storedPath);
      if (absolute) await unlink(absolute).catch(() => {});
    }),
  );
  // Event.taskId has no cascade, so the blocks go first or the Task delete
  // hits a foreign-key violation. Subtasks cascade via Task.parentId.
  await prisma.event.deleteMany({ where: { taskId } });
  await prisma.task.deleteMany({ where: { id: taskId } });
  return task.title;
}
