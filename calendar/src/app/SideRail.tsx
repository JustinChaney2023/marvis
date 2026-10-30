"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NavLinks from "./NavLinks";
import ThemeToggle from "./ThemeToggle";
import FeedbackButton from "./FeedbackButton";
import { MarkIcon, MenuIcon, CloseIcon } from "./icons";
import { getCurrentEventIdAction } from "./actions";
import { useModalOpen } from "@/lib/keyboard";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  useModalOpen(drawerOpen);
  // A route change closes the drawer, same as a menu link click would —
  // catches back/forward navigation too, not just clicking a NavLinks item.
  // Adjusted during render (not an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
  }

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

  const railContents = (onNavigate?: () => void) => (
    <>
      <Link
        href={liveEventId ? `/timer?eventId=${liveEventId}` : "/"}
        onClick={onNavigate}
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
      </div>
    </>
  );

  return (
    <>
      {/* Below md, the persistent rail collapses to a top bar + hamburger
          — a fixed-width sidebar with no way to hide it was clipping every
          other page's content at phone/narrow-tablet widths. */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-rule bg-surface px-3 py-2 print:hidden md:hidden">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <MarkIcon className="h-5 w-5 flex-shrink-0" />
          <span className="font-serif text-base leading-none">Season</span>
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-rule-soft"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div
            className="absolute inset-0 bg-scrim"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative flex h-full w-64 max-w-[85vw] flex-col gap-4 overflow-y-auto border-r border-rule bg-surface px-3 py-4">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center self-end rounded-md text-ink-2 transition-colors hover:bg-rule-soft"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
            {railContents(() => setDrawerOpen(false))}
          </aside>
        </div>
      )}

      <aside className="hidden h-full w-44 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-rule bg-surface px-3 py-4 print:hidden md:flex">
        {railContents()}
      </aside>
    </>
  );
}
