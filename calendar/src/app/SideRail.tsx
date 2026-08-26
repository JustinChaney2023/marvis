"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NavLinks from "./NavLinks";
import ThemeToggle from "./ThemeToggle";
import SettingsButton from "./SettingsButton";
import FeedbackButton from "./FeedbackButton";
import { MarkIcon } from "./icons";
import { getCurrentEventIdAction } from "./actions";

const LIVE_EVENT_POLL_MS = 30_000;

// Public/pre-auth routes render their own minimal chrome, so the app nav
// and settings/feedback icons (which assume a logged-in user) stay hidden.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/", "/rsvp/"];

// Keep in sync with package.json's "version" — duplicated rather than
// imported so this client bundle doesn't pull in the whole package.json
// (dependency list included) just to read one field.
const APP_VERSION = "0.1.0";

// A persistent left rail (icon + label nav, matching the design system's
// left-edge chrome) rather than the horizontal top bar this replaced —
// nine nav destinations don't sit comfortably in one bar, and this is
// the shell shape the paper/chalkboard design language was drawn for.
export default function SideRail() {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  // A little hidden feature: during a live event, the mark itself jumps
  // straight to its fullscreen timer instead of home — no visible
  // affordance, just there for whoever knows to click it mid-class.
  const [liveEventId, setLiveEventId] = useState<string | null>(null);
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const poll = () => {
      getCurrentEventIdAction()
        .then((id) => {
          if (!cancelled) setLiveEventId(id);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, LIVE_EVENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    <aside className="flex h-full w-44 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-rule bg-surface px-3 py-4 print:hidden">
      <Link
        href={liveEventId ? `/timer?eventId=${liveEventId}` : "/"}
        className="flex items-center gap-2 px-1.5 text-ink"
      >
        <MarkIcon className="h-6 w-6 flex-shrink-0" />
        <span className="min-w-0">
          <span className="block font-serif text-lg leading-tight tracking-tight">Season</span>
          <span className="block font-mono text-[9px] text-muted">v{APP_VERSION}</span>
        </span>
      </Link>

      <NavLinks />

      <div className="flex-grow" />

      <div className="flex items-center gap-1.5 px-0.5">
        <ThemeToggle />
        <FeedbackButton />
        <SettingsButton />
      </div>
    </aside>
  );
}
