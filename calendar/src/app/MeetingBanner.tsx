"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getUpcomingMeetingBannerAction } from "./actions";
import { CloseIcon } from "./icons";

const POLL_MS = 30_000;

// Same public/pre-auth routes TopBar hides on — getUpcomingMeetingBannerAction
// requires a signed-in user, so polling here on a page nobody's logged in on
// would just redirect(/login) every 30s for nothing.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/"];

type Meeting = { id: string; title: string; startIso: string; meetingUrl: string | null };

function describeTiming(startIso: string, now: number): string {
  const minutesAway = Math.round((new Date(startIso).getTime() - now) / 60_000);
  if (minutesAway > 1) return `starting in ${minutesAway} min`;
  if (minutesAway === 1) return "starting in 1 min";
  if (minutesAway === 0) return "starting now";
  const minutesAgo = -minutesAway;
  return `started ${minutesAgo} min ago`;
}

// Sits between TopBar and page content (see layout.tsx) rather than
// floating over anything, same reasoning as the corner-button overlap fix
// — it pushes content down instead of covering it.
export default function MeetingBanner() {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const upcoming = await getUpcomingMeetingBannerAction();
        if (!cancelled) setMeetings(upcoming);
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
  }, [hidden]);

  if (hidden) return null;
  const visible = meetings.filter((m) => !dismissedIds.has(m.id));
  if (visible.length === 0) return null;

  const next = visible.reduce((soonest, m) =>
    new Date(m.startIso).getTime() < new Date(soonest.startIso).getTime() ? m : soonest,
  );

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm print:hidden dark:border-indigo-900 dark:bg-indigo-950/40">
      <span className="min-w-0 truncate text-indigo-900 dark:text-indigo-200">
        <span className="font-medium">{next.title}</span> — {describeTiming(next.startIso, Date.now())}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={next.meetingUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Join call
        </a>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissedIds((prev) => new Set(prev).add(next.id))}
          className="flex h-6 w-6 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
