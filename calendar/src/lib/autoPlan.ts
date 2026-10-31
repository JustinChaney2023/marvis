import { prisma } from "@/lib/prisma";
import { scheduleAllPendingTasks, scheduleTask } from "@/lib/scheduler";
import { scheduleHabitsForWeek } from "@/lib/habits";
import { getAppSettings } from "@/lib/settings";

/**
 * "Auto-schedule" (Settings → Scheduling): Motion-style hands-off
 * planning. Without it, Season only re-plans when you press Schedule all
 * or create/move an event, so a missed block just sat in the past.
 *
 * Every PLAN_EVERY_MS this re-plans stale/conflicting blocks and places
 * any unscheduled open tasks (scheduleAllPendingTasks), and tops up
 * habits, for every account that turned it on. Runs inside the server
 * process, started from instrumentation.ts alongside the push loop.
 */
const PLAN_EVERY_MS = 10 * 60_000;

export async function runAutoPlanTick(): Promise<number> {
  const enabled = await prisma.appSettings.findMany({
    where: { autoSchedule: true, userId: { not: null } },
    select: { userId: true },
  });
  for (const { userId } of enabled) {
    try {
      await scheduleAllPendingTasks(userId!);
      await scheduleHabitsForWeek(userId!);
    } catch (err) {
      console.error("auto-plan failed for user", userId, err);
    }
  }
  return enabled.length;
}

/** For create paths: place a new task right away if the user opted in. */
export async function autoPlaceIfEnabled(userId: string, taskId: string): Promise<void> {
  const settings = await getAppSettings(userId);
  if (!settings.autoSchedule) return;
  await scheduleTask(userId, taskId).catch((err) => console.error("auto-place failed:", err));
}

let started = false;

export function startAutoPlanLoop() {
  if (started || process.env.SEASON_DISABLE_PUSH_LOOP === "1") return;
  started = true;
  setInterval(() => {
    runAutoPlanTick().catch((err) => console.error("auto-plan tick failed:", err));
  }, PLAN_EVERY_MS).unref?.();
}
