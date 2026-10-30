"use client";

import { useReducer, useSyncExternalStore } from "react";

const DISMISSED_KEY = "shortcut-hint-dismissed";

// Read-only sync (no change event to subscribe to) — re-read on demand via
// forceRecheck after our own write, same pattern as NotificationWatcher's
// permission/dismissed stores.
function subscribe() {
  return () => {};
}
function getSnapshot(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
function getServerSnapshot(): boolean {
  return false;
}

/**
 * The always-visible shortcut hint line duplicated the "?" help overlay
 * forever — useful once, then just permanent low-contrast noise. Same
 * dismiss-once pattern as the reminders prompt: starts shown, and a
 * dismiss sticks (via localStorage) so returning users don't see it
 * again, while "?" still lists everything on demand.
 */
export default function ShortcutHint() {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [, forceRecheck] = useReducer((c: number) => c + 1, 0);

  if (dismissed) return null;

  return (
    <p className="flex items-center gap-2 font-mono text-xs text-muted print:hidden">
      <span>
        Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> prev/next, <kbd>d</kbd>/<kbd>w</kbd>/<kbd>m</kbd> view,{" "}
        <kbd>t</kbd> today, <kbd>?</kbd> all shortcuts
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED_KEY, "1");
          } catch {
            // ignore — worst case the hint reappears next visit
          }
          forceRecheck();
        }}
        className="text-muted hover:text-ink"
      >
        ×
      </button>
    </p>
  );
}
