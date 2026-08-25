"use client";

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { getUpcomingEventReminders, getPendingAutomationNotificationsAction } from "./actions";

const POLL_MS = 60_000;
const SNOOZE_MS = 5 * 60_000;

// ponytail: plain `new Notification()` has no action buttons — those
// need a Service Worker's showNotification({ actions }), a much bigger
// addition than a "snooze" this app doesn't otherwise need one for.
// Clicking the notification snoozes it (closes + re-fires in 5 min)
// instead of just focusing the tab; add a real Snooze button if a
// service worker ever gets added for other reasons.
function showReminderNotification(title: string, minutesAway: number) {
  const notification = new Notification(title, {
    body:
      minutesAway <= 0.5
        ? "Starting now — click to snooze 5 min"
        : `Starts in ${Math.round(minutesAway)} min — click to snooze 5 min`,
  });
  notification.onclick = () => {
    notification.close();
    setTimeout(() => showReminderNotification(title, 0), SNOOZE_MS);
  };
}

// Notification.permission has no change event worth subscribing to (it
// only ever changes via our own requestPermission() call below, which
// re-renders through the same getSnapshot on the next read) — so this is
// a read-only sync, not a real subscription. "denied" is used as the SSR
// / unsupported-browser sentinel: it keeps the button hidden and polling
// off, which is the safe default either way.
function subscribe() {
  return () => {};
}
function getSnapshot(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  return Notification.permission;
}
function getServerSnapshot(): NotificationPermission {
  return "denied";
}

export default function NotificationWatcher() {
  const permission = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const notifiedIds = useRef<Set<string>>(new Set());
  // useSyncExternalStore only re-renders on a subscribe-reported change,
  // and Notification.permission has no such event — bump this after our
  // own requestPermission() call resolves so getSnapshot gets re-read.
  const [, forceRecheck] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    if (permission !== "granted") return;

    const poll = async () => {
      try {
        // The server only returns occurrences whose own per-event
        // reminderMinutes has already come due — nothing left to
        // threshold-check here, just dedup against what's already fired.
        const upcoming = await getUpcomingEventReminders();
        const now = Date.now();
        for (const occ of upcoming) {
          if (notifiedIds.current.has(occ.id)) continue;
          const startMs = new Date(occ.startIso).getTime();
          const minutesAway = (startMs - now) / 60_000;
          notifiedIds.current.add(occ.id);
          showReminderNotification(occ.title, minutesAway);
        }

        // Server-generated (task automations), not derived from a poll
        // window like event reminders — the action itself marks them
        // seen, so no local dedup set is needed here.
        const pendingAutomations = await getPendingAutomationNotificationsAction();
        for (const n of pendingAutomations) {
          new Notification("Automation", { body: n.message });
        }
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [permission]);

  if (permission !== "default") return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await Notification.requestPermission();
        forceRecheck();
      }}
      className="fixed bottom-4 right-4 z-40 rounded-full border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft print:hidden"
    >
      Enable reminders
    </button>
  );
}
