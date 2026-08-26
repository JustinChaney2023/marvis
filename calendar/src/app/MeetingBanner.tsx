"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getUpcomingMeetingBannerAction } from "./actions";
import { CloseIcon } from "./icons";

const POLL_MS = 30_000;

// Same public/pre-auth routes SideRail hides on — getUpcomingMeetingBannerAction
// requires a signed-in user, so polling here on a page nobody's logged in on
// would just redirect(/login) every 30s for nothing.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/", "/rsvp/"];

type Meeting = { id: string; title: string; startIso: string; meetingUrl: string | null };

function describeTiming(startIso: string, now: number): string {
  const minutesAway = Math.round((new Date(startIso).getTime() - now) / 60_000);
  if (minutesAway > 1) return `starting in ${minutesAway} min`;
  if (minutesAway === 1) return "starting in 1 min";
  if (minutesAway === 0) return "starting now";
  const minutesAgo = -minutesAway;
  return `started ${minutesAgo} min ago`;
}

// Sits above the scrollable content column, below the side rail (see layout.tsx) rather than
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
    <div className="flex shrink-0 items-center gap-3 bg-ink px-4 py-2.5 text-sm text-paper print:hidden">
      <span className="font-mono text-[10px] tracking-wide text-accent uppercase">Live soon</span>
      <span className="min-w-0 truncate">
        <span className="font-medium">{next.title}</span> — {describeTiming(next.startIso, Date.now())}
      </span>
      <div className="flex-grow" />
      <div className="flex shrink-0 items-center gap-2">
        <a
          // Defense in depth — actions.ts's meetingUrlFromFormData already
          // rejects non-http(s) schemes at write time, but this is a
          // render-time backstop against any row written before that
          // guard existed. A "javascript:" href would otherwise execute
          // on click.
          href={next.meetingUrl && /^https?:\/\//i.test(next.meetingUrl) ? next.meetingUrl : "#"}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-paper hover:bg-accent-hover"
        >
          Join call
        </a>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissedIds((prev) => new Set(prev).add(next.id))}
          className="flex h-6 w-6 items-center justify-center rounded-full text-paper/70 hover:bg-paper/10 hover:text-paper"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
