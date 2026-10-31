"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NavLinks from "./NavLinks";
import ThemeToggle from "./ThemeToggle";
import FeedbackButton from "./FeedbackButton";
import { MarkIcon, PlusIcon } from "./icons";
import { openQuickCapture } from "./quickCaptureEvents";
import { getCurrentEventIdAction } from "./actions";

const LIVE_EVENT_POLL_MS = 30_000;

// Public/pre-auth routes render their own minimal chrome, so the app nav
// and settings/feedback icons (which assume a logged-in user) stay hidden.
export const HIDDEN_CHROME_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/", "/rsvp/", "/oauth/"];

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
  const hidden = HIDDEN_CHROME_PREFIXES.some((p) => pathname.startsWith(p));

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
    <aside className="hidden h-full w-44 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-rule bg-surface px-3 py-4 md:flex print:hidden">
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

      <button
        type="button"
        onClick={() => openQuickCapture()}
        title="Quick add (c)"
        className="flex items-center gap-2 rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-ink-2 transition-colors hover:border-accent hover:text-ink"
      >
        <PlusIcon className="h-4 w-4 flex-shrink-0 text-accent" />
        <span className="flex-1 text-left">Quick add</span>
        <kbd className="font-mono text-[10px] text-muted">c</kbd>
      </button>

      <NavLinks />

      <div className="flex-grow" />

      <div className="flex items-center gap-1.5 px-0.5">
        <ThemeToggle />
        <FeedbackButton />
      </div>
    </aside>
  );
}
