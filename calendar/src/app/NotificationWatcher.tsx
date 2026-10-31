"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  getUpcomingEventReminders,
  getPendingAutomationNotificationsAction,
  runTaskAutoScheduleAction,
} from "./actions";
import { CloseIcon } from "./icons";

const DISMISSED_KEY = "reminders-prompt-dismissed";

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

async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

// Same read-only-sync shape as the permission store above — localStorage
// has no change event either, so this is "re-read on demand" (via
// forceRecheck after our own write), not a real subscription.
function subscribeDismissed() {
  return () => {};
}
function getDismissedSnapshot(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
function getDismissedServerSnapshot(): boolean {
  return false;
}

type Toast = { id: string; message: string };

export default function NotificationWatcher() {
  const router = useRouter();
  const permission = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const notifiedIds = useRef<Set<string>>(new Set());
  // Automation notifications used to only ever appear via the native
  // Notification() API — with no OS permission granted (the default),
  // "send a notification" had no visible effect anywhere at all. These
  // toasts are the in-app fallback that doesn't depend on that
  // permission; the native notification still fires too, when allowed.
  const [toasts, setToasts] = useState<Toast[]>([]);
  // useSyncExternalStore only re-renders on a subscribe-reported change,
  // and Notification.permission has no such event — bump this after our
  // own requestPermission() call resolves so getSnapshot gets re-read.
  const [, forceRecheck] = useReducer((c: number) => c + 1, 0);
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  );

  useEffect(() => {
    if (permission !== "granted") return;

    const poll = async () => {
      try {
        // The server only returns occurrences whose own per-event
        // reminderMinutes has already come due — nothing left to
        // threshold-check here, just dedup against what's already fired.
        // With Web Push on for this browser (Settings → Notifications) the
        // server already sends event reminders — don't double up.
        const pushOn = await hasPushSubscription();
        const upcoming = pushOn ? [] : await getUpcomingEventReminders();
        const now = Date.now();
        for (const occ of upcoming) {
          if (notifiedIds.current.has(occ.id)) continue;
          const startMs = new Date(occ.startIso).getTime();
          const minutesAway = (startMs - now) / 60_000;
          notifiedIds.current.add(occ.id);
          showReminderNotification(occ.title, minutesAway);
        }
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [permission]);

  // Independent of Notification permission — this is the in-app surface
  // that always works, so "send a notification" as an automation action
  // isn't silently invisible for anyone who hasn't granted OS permission.
  useEffect(() => {
    const poll = async () => {
      try {
        const pendingAutomations = await getPendingAutomationNotificationsAction();
        if (pendingAutomations.length === 0) return;
        setToasts((prev) => [...prev, ...pendingAutomations]);
        if (permission === "granted") {
          for (const n of pendingAutomations) {
            new Notification("Automation", { body: n.message });
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also independent of Notification permission. Catches "time passed
  // without the task being completed" (a missed block gets rescheduled,
  // an ONGOING one's block keeps expanding) while the app just sits open
  // — not only on the next task creation or manual Schedule-all click.
  // router.refresh() only fires when something actually changed, so an
  // idle tab with nothing stale isn't re-fetching every minute for
  // nothing.
  useEffect(() => {
    const poll = async () => {
      try {
        const changed = await runTaskAutoScheduleAction();
        if (changed) router.refresh();
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [router]);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0 && (permission !== "default" || dismissed)) return null;

  return (
    <div className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex w-72 md:bottom-4 flex-col items-end gap-2 print:hidden">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex w-full items-start justify-between gap-2 rounded-lg border border-rule bg-surface p-3 text-sm shadow-sm"
        >
          <p className="text-ink-2">{t.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-rule-soft hover:text-ink"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      ))}

      {permission === "default" && !dismissed && (
        <div className="flex items-center gap-1 rounded-full border border-rule bg-surface pl-3 pr-1.5 py-1.5">
          <button
            type="button"
            onClick={async () => {
              await Notification.requestPermission();
              forceRecheck();
            }}
            className="text-xs font-medium text-ink-2 transition-colors hover:text-ink"
          >
            Enable reminders
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss — you can still turn reminders on later from your browser's site settings"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED_KEY, "1");
              } catch {
                // ignore — worst case the prompt reappears next visit
              }
              forceRecheck();
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-rule-soft hover:text-ink"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
