// DB-backed checks of the scheduler's ordering, bumping, remaining-time and
// unblock-on-finish behaviour. Needs a migrated database: `npm run test:db`.
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { setTaskDone } from "@/lib/taskOps";
import {
  findEarliestSlot,
  scheduleAllPendingTasks,
  scheduleTask,
  unscheduleTask,
  windowFnForWorkingHours,
} from "@/lib/scheduler";

const DAY = 86_400_000;

async function main() {
  const tz = "UTC";
  const user = await prisma.user.create({
    data: { email: `sched-${Date.now()}@x.test`, passwordHash: "x", timezone: tz },
  });
  try {
    await getAppSettings(user.id);
    await prisma.appSettings.update({ where: { userId: user.id }, data: { bufferMin: 0, dailyCapMin: null } });
    const settings = await getAppSettings(user.id);

    // Leave exactly one free 2h window (S) in the whole horizon, so tasks
    // have to compete for it.
    const now = new Date();
    const S = findEarliestSlot(
      new Date(now.getTime() + 60 * 60_000),
      120,
      [],
      new Date(now.getTime() + 15 * DAY),
      windowFnForWorkingHours(settings, tz),
      tz,
    )!;
    assert.ok(S, "found a free window");
    const wall = [
      await prisma.event.create({ data: { userId: user.id, title: "wall-a", start: new Date(now.getTime() - DAY), end: S.start } }),
      await prisma.event.create({ data: { userId: user.id, title: "wall-b", start: S.end, end: new Date(now.getTime() + 20 * DAY) } }),
    ];
    const blocksOf = (taskId: string) =>
      prisma.event.findMany({ where: { taskId }, orderBy: { start: "asc" } });
    const mk = (title: string, data: { dueAt?: Date; hardDeadline?: boolean; durationMin?: number; trackedMinutes?: number }) =>
      prisma.task.create({ data: { userId: user.id, title, durationMin: 120, ...data } });
    const later = new Date(now.getTime() + 10 * DAY);
    const soon = new Date(S.end.getTime() + 60 * 60_000);

    // 1. A task that can't make its deadline bumps a less urgent one.
    const a = await mk("A later", { dueAt: later });
    await scheduleTask(user.id, a.id);
    assert.equal((await blocksOf(a.id))[0]?.start.getTime(), S.start.getTime(), "A takes the only window");
    const b = await mk("B soon", { dueAt: soon });
    await scheduleTask(user.id, b.id);
    assert.equal((await blocksOf(b.id))[0]?.start.getTime(), S.start.getTime(), "B bumps A to make its deadline");
    assert.equal((await blocksOf(a.id)).length, 0, "A was moved out (nowhere else to go)");

    // 2. A soft deadline never bumps a hard one.
    await unscheduleTask(user.id, b.id);
    await prisma.task.update({ where: { id: b.id }, data: { hardDeadline: false } });
    await scheduleTask(user.id, a.id);
    await scheduleTask(user.id, b.id);
    assert.equal((await blocksOf(a.id))[0]?.start.getTime(), S.start.getTime(), "hard-deadline A keeps its slot");
    assert.equal((await blocksOf(b.id)).length, 0, "soft-deadline B can't bump it");

    // 3. Schedule all goes least-slack-first: soft B (due soon) beats hard A
    //    (due in 10 days) to the window, even though A is a hard deadline.
    await unscheduleTask(user.id, a.id);
    const { results } = await scheduleAllPendingTasks(user.id);
    assert.ok(results.some((r) => r.taskId === b.id && r.scheduled), "B placed by schedule all");
    assert.equal((await blocksOf(b.id))[0]?.start.getTime(), S.start.getTime(), "most urgent first");
    await prisma.task.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "DONE" } });

    // Open the calendar back up for the rest.
    await prisma.event.deleteMany({ where: { id: { in: wall.map((w) => w.id) } } });

    // 4. Time already tracked is subtracted from what gets planned.
    const c = await mk("C partly done", { durationMin: 180, trackedMinutes: 120 });
    const [cBlock] = await scheduleTask(user.id, c.id) ?? [];
    assert.equal(cBlock && (cBlock.end.getTime() - cBlock.start.getTime()) / 60_000, 60, "only the remaining hour is planned");

    // 5. Finishing a blocker places what it was blocking (Auto-schedule on).
    await prisma.appSettings.update({ where: { userId: user.id }, data: { autoSchedule: true } });
    const blocker = await mk("blocker", {});
    const waiting = await mk("waiting", {});
    await prisma.task.update({ where: { id: waiting.id }, data: { blockedBy: { set: [{ id: blocker.id }] } } });
    assert.equal(await scheduleTask(user.id, waiting.id), null, "blocked task isn't placed");
    await setTaskDone(user.id, blocker.id, true);
    assert.equal((await blocksOf(waiting.id)).length, 1, "unblocked task placed right away");
  } finally {
    await prisma.event.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log("scheduler.dbtest.ts: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
