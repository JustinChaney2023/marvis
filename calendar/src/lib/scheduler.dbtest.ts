// DB-backed checks of the scheduler's ordering, bumping, remaining-time and
// unblock-on-finish behaviour. Needs a migrated database: `npm run test:db`.
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import { setTaskDone, setTaskBlockedBy, deleteTask } from "@/lib/taskOps";
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

    // 6. A chain whose head is on the calendar plans out in order, even
    // though the links are still unfinished (the AWS-modules case).
    const m1 = await mk("m1", {});
    const m2 = await mk("m2", {});
    const m3 = await mk("m3", {});
    await prisma.task.update({ where: { id: m2.id }, data: { blockedBy: { set: [{ id: m1.id }] } } });
    await prisma.task.update({ where: { id: m3.id }, data: { blockedBy: { set: [{ id: m2.id }] } } });
    await scheduleTask(user.id, m1.id);
    await prisma.task.update({ where: { id: m3.id }, data: { dueAt: new Date(Date.now() + 3 * 86_400_000) } });
    await scheduleAllPendingTasks(user.id);
    const [b1] = await blocksOf(m1.id), [b2] = await blocksOf(m2.id), [b3] = await blocksOf(m3.id);
    assert.ok(b1 && b2 && b3, "every link in the chain got a block");
    assert.ok(b2.start >= b1.end && b3.start >= b2.end, "each link starts after its prerequisite ends");

    // 7. setTaskBlockedBy (UI + MCP) refuses a cycle and reports it.
    assert.deepEqual(await setTaskBlockedBy(user.id, m1.id, [m3.id]), [m3.id], "m3 -> m2 -> m1 would loop back");
    assert.deepEqual(await setTaskBlockedBy(user.id, m3.id, [m1.id, "nope"]), ["nope"], "unknown ids are reported");

    // 8. Rebalance: a block placed behind a since-removed obstacle moves
    //    earlier on the next sweep; a block already under way stays put.
    const wallR = await prisma.event.create({
      data: { userId: user.id, title: "wall-r", start: new Date(now.getTime() - 3_600_000), end: new Date(now.getTime() + 5 * DAY) },
    });
    const r = await mk("R", { durationMin: 60 });
    await scheduleTask(user.id, r.id);
    const [rBefore] = await blocksOf(r.id);
    assert.ok(rBefore.start >= wallR.end, "R lands after the wall");
    await prisma.event.delete({ where: { id: wallR.id } });
    await scheduleAllPendingTasks(user.id);
    const [rAfter] = await blocksOf(r.id);
    assert.ok(rAfter.start < rBefore.start, "R slid earlier once the wall was gone");
    // (clear the other blocks first so a neighbour isn't read as a conflict)
    await prisma.event.deleteMany({ where: { userId: user.id, id: { not: rAfter.id } } });
    await prisma.event.update({
      where: { id: rAfter.id },
      data: { start: new Date(now.getTime() - 30 * 60_000), end: new Date(now.getTime() + 30 * 60_000) },
    });
    await scheduleAllPendingTasks(user.id);
    const [rRunning] = await blocksOf(r.id);
    assert.equal(rRunning.id, rAfter.id, "a block under way is not rebalanced");

    // 9. Low priority + due more than a month out isn't auto-scheduled; a
    //    priority set by hand is, and so is an explicit Schedule.
    const far = new Date(now.getTime() + 45 * DAY);
    const f0 = await mk("far, unset priority", { dueAt: far, durationMin: 60 });
    const f1 = await mk("far, priority set", { dueAt: far, durationMin: 60 });
    await prisma.task.update({ where: { id: f1.id }, data: { priority: 1 } });
    await scheduleAllPendingTasks(user.id);
    assert.equal((await blocksOf(f0.id)).length, 0, "far-off unset-priority task stays off the calendar");
    assert.equal((await blocksOf(f1.id)).length, 1, "a priority set by hand is scheduled");
    assert.ok(await scheduleTask(user.id, f0.id), "explicit Schedule ignores the deferral");

    // 10. deleteTask removes the task and every block, and is safe to repeat.
    const d = await mk("D", { durationMin: 60 });
    await prisma.event.createMany({
      data: [0, 1].map((i) => ({ userId: user.id, title: "D", start: new Date(now.getTime() + (i + 1) * DAY), end: new Date(now.getTime() + (i + 1) * DAY + 3_600_000), taskId: d.id })),
    });
    assert.equal(await deleteTask(user.id, d.id), "D");
    assert.equal(await deleteTask(user.id, d.id), null, "second delete finds nothing");
    assert.equal(await prisma.task.count({ where: { id: d.id } }) + (await blocksOf(d.id)).length, 0);
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
