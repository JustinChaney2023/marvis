"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { syncGoogleCalendarIfDueAction, syncCalendarSubscriptionsIfDueAction } from "./actions";

// Checks every 2 minutes; the action itself only actually syncs with
// Google if it's been 10+ minutes since the last one (see
// GOOGLE_AUTO_SYNC_INTERVAL_MS in actions.ts) — this just needs to poll
// often enough that a real sync doesn't lag far behind that interval.
const POLL_MS = 2 * 60 * 1000;

// Same pre-auth routes MeetingBanner hides on — syncGoogleCalendarIfDueAction
// requires a signed-in user, so polling here on a page nobody's logged in
// on would just redirect(/login) every tick for nothing.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/"];

/**
 * External sync used to only run when someone remembered to click
 * "Sync" in Settings, so changes made directly on Google (or a stale
 * ICS subscription) could sit unreflected here indefinitely. This makes
 * it automatic — quietly checks in the background from wherever you are
 * in the app and refreshes the page's data if a sync actually happened.
 */
export default function SyncWatcher() {
  const pathname = usePathname();
  const router = useRouter();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [google, subscriptions] = await Promise.all([
          syncGoogleCalendarIfDueAction(),
          syncCalendarSubscriptionsIfDueAction(),
        ]);
        if (!cancelled && (google.synced || subscriptions.synced)) router.refresh();
      } catch (err) {
        console.error(err);
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hidden, router]);

  return null;
}
