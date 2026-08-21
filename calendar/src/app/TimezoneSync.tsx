"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncUserTimezoneAction } from "./actions";

// Same pre-auth routes SyncWatcher/MeetingBanner hide on — the action
// requires a signed-in user.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/", "/rsvp/"];

/**
 * Auto-detects the account's timezone (#46) from the browser once, the
 * first time it's ever missing — the server never overwrites an
 * already-set value (see syncUserTimezoneAction), so this is a no-op
 * after the first successful run or a manual Settings override.
 */
export default function TimezoneSync() {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (hidden) return;
    syncUserTimezoneAction(Intl.DateTimeFormat().resolvedOptions().timeZone).catch((err) => {
      console.error(err);
    });
    // Intentionally once per mount, not polled — a real zone change (the
    // account holder travels) is rare enough that "next full page load"
    // catching it is fine, and re-detecting every render would fight a
    // deliberate manual override from Settings on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  return null;
}
