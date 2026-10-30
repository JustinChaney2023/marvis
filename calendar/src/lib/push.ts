import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { expandEvents } from "@/lib/recurrence";

/**
 * Web Push: reminders delivered by the browser/OS even when Season isn't
 * open (on iPhone, once it's added to the Home Screen). The service worker
 * that shows them is public/sw.js; devices opt in from Settings.
 *
 * The reminder loop (startPushLoop, started from instrumentation.ts) runs
 * once a minute inside the long-lived server process — Season already
 * assumes one (SQLite, in-memory rate limits), so no external cron.
 */

const VAPID_KEY = "vapid";
const LOOP_MS = 60_000;
// Due-soon task reminders fire this long before an *unscheduled* task's
// due time (a scheduled one already has its own event reminder).
const TASK_DUE_LEAD_MIN = 60;
const DELIVERY_RETENTION_MS = 3 * 86_400_000;

type VapidKeys = { publicKey: string; privateKey: string };
let vapidCache: VapidKeys | null = null;

/** The VAPID key pair, generated and stored on first use. */
export async function getVapidKeys(): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  const row = await prisma.serverSecret.findUnique({ where: { key: VAPID_KEY } });
  if (row) {
    vapidCache = JSON.parse(row.value) as VapidKeys;
    return vapidCache;
  }
  const keys = webpush.generateVAPIDKeys();
  // upsert, not create — two first requests racing shouldn't both fail.
  const saved = await prisma.serverSecret.upsert({
    where: { key: VAPID_KEY },
    update: {},
    create: { key: VAPID_KEY, value: JSON.stringify(keys) },
  });
  vapidCache = JSON.parse(saved.value) as VapidKeys;
  return vapidCache;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

function contactSubject(): string {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (from && from.includes("@")) return `mailto:${from}`;
  return process.env.APP_URL?.startsWith("https://") ? process.env.APP_URL : "mailto:season@localhost";
}

/** Sends to every device the user enabled; prunes ones the browser has dropped. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return 0;
  const { publicKey, privateKey } = await getVapidKeys();
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject: contactSubject(), publicKey, privateKey }, TTL: 60 * 30 },
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = the subscription is gone (uninstalled, permission revoked).
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("push send failed:", status ?? err);
        }
      }
    }),
  );
  return delivered;
}

/** Records `key` as sent; false if it already was (so: don't send again). */
async function claimDelivery(key: string): Promise<boolean> {
  try {
    await prisma.pushDelivery.create({ data: { key } });
    return true;
  } catch {
    return false;
  }
}

function formatClock(d: Date, timeZone: string | undefined): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

/** One pass of the reminder loop. Exported for tests/manual triggering. */
export async function runPushTick(now = new Date()): Promise<{ sent: number }> {
  const userIds = (
    await prisma.pushSubscription.findMany({ distinct: ["userId"], select: { userId: true } })
  ).map((r) => r.userId);
  let sent = 0;

  for (const userId of userIds) {
    // One user's failure (bad data, a DB hiccup) mustn't stop everyone
    // after them from getting reminders this tick.
    try {
      sent += await tickForUser(userId, now);
    } catch (err) {
      console.error("push tick failed for user", userId, err);
    }
  }

  await prisma.pushDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) } } });
  return { sent };
}

/** Sends once per key: claims it first, releases the claim if nothing got through. */
async function sendOnce(key: string, userId: string, payload: PushPayload): Promise<number> {
  if (!(await claimDelivery(key))) return 0;
  const delivered = await sendPushToUser(userId, payload).catch(() => 0);
  if (delivered === 0) await prisma.pushDelivery.deleteMany({ where: { key } });
  return delivered;
}

async function tickForUser(userId: string, now: Date): Promise<number> {
  let sent = 0;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const tz = user?.timezone ?? undefined;
  // Event reminders: same rule as the in-tab NotificationWatcher — fire
  // once an occurrence is within its own reminderMinutes.
  const horizon = new Date(now.getTime() + 24 * 3_600_000);
  const lookback = new Date(now.getTime() - 60_000);
  const rows = await prisma.event.findMany({
    where: {
      userId,
      reminderMinutes: { not: null },
      OR: [{ start: { gte: lookback, lt: horizon } }, { recurrenceRule: { not: null } }],
    },
  });
  const reminderById = new Map(rows.map((r) => [r.id, r.reminderMinutes ?? 0]));
  for (const occ of expandEvents(rows, lookback, horizon)) {
    const minutesAway = (occ.start.getTime() - now.getTime()) / 60_000;
    // -1 min of grace so a "0 minutes before" reminder (and one a tick
    // runs slightly late for) still fires.
    if (occ.allDay || minutesAway < -1 || minutesAway > (reminderById.get(occ.masterId) ?? -1)) continue;
    // Start time in the key: a moved event deserves a fresh reminder.
    sent += await sendOnce(`event:${occ.id}:${occ.start.toISOString()}`, userId, {
      title: occ.title,
      body: minutesAway < 1 ? "Starting now" : `Starts at ${formatClock(occ.start, tz)} (in ${Math.round(minutesAway)} min)`,
      url: "/",
      tag: `event:${occ.id}`,
    });
  }

  // Unscheduled tasks coming due — the ones most likely to slip.
  const dueSoon = await prisma.task.findMany({
    where: {
      userId,
      parentId: null,
      status: { in: ["CREATED", "ONGOING"] },
      events: { none: {} },
      dueAt: { gte: now, lte: new Date(now.getTime() + TASK_DUE_LEAD_MIN * 60_000) },
    },
    select: { id: true, title: true, dueAt: true },
  });
  for (const task of dueSoon) {
    sent += await sendOnce(`task-due:${task.id}:${task.dueAt!.toISOString()}`, userId, {
      title: `Due at ${formatClock(task.dueAt!, tz)}: ${task.title}`,
      body: "Not on your calendar yet — tap to open it.",
      url: `/tasks?edit=${task.id}`,
      tag: `task:${task.id}`,
    });
  }
  return sent;
}

let loopStarted = false;

export function startPushLoop() {
  if (loopStarted || process.env.SEASON_DISABLE_PUSH_LOOP === "1") return;
  loopStarted = true;
  const tick = () =>
    runPushTick().catch((err) => {
      console.error("push loop tick failed:", err);
    });
  setInterval(tick, LOOP_MS).unref?.();
}
