"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_LINKS, isActiveNav } from "./NavLinks";
import ThemeToggle from "./ThemeToggle";
import FeedbackButton from "./FeedbackButton";
import { GearIcon, PlusIcon } from "./icons";
import { openQuickCapture } from "./quickCaptureEvents";
import { HELP_EVENT } from "./ShortcutsHelp";
import { HIDDEN_CHROME_PREFIXES } from "./SideRail";

// The three places you live day to day get a tab; everything else sits
// under "More". The "+" in the middle is the phone's way into quick
// capture, since there's no "c" key to press.
const PRIMARY = ["/", "/tasks", "/focus"];

function MoreIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

// Below md, the SideRail is hidden and this bottom tab bar takes over —
// a 176px rail on a 390px screen left the page itself half the width.
export default function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  if (HIDDEN_CHROME_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const primary = NAV_LINKS.filter((l) => PRIMARY.includes(l.href));
  const secondary = NAV_LINKS.filter((l) => !PRIMARY.includes(l.href));
  const moreActive = secondary.some((l) => isActiveNav(pathname, l.href)) || pathname.startsWith("/settings");

  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${active ? "font-medium text-ink" : "text-muted"}`;

  return (
    <>
      {moreOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-40 bg-scrim md:hidden print:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="modal-panel absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-rule bg-surface px-4 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule" />
            <nav className="grid grid-cols-3 gap-2">
              {[...secondary, { href: "/settings", label: "Settings", icon: GearIcon }].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs ${
                    isActiveNav(pathname, href) ? "border-ink bg-ink text-paper" : "border-rule text-ink-2"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-center gap-2">
              <ThemeToggle />
              <FeedbackButton />
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  window.dispatchEvent(new Event(HELP_EVENT));
                }}
                aria-label="Help"
                className="flex h-9 items-center justify-center rounded-full border border-rule bg-surface px-3 text-xs text-ink-2"
              >
                Shorthand help
              </button>
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        {primary.slice(0, 2).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={tab(isActiveNav(pathname, href))}>
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => openQuickCapture()}
            aria-label="Quick add"
            className="-mt-5 flex h-13 w-13 items-center justify-center rounded-full bg-accent text-paper shadow-lg shadow-black/15 transition-transform active:scale-95"
          >
            <PlusIcon className="h-6 w-6" />
          </button>
        </div>
        {primary.slice(2).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={tab(isActiveNav(pathname, href))}>
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
        <button type="button" onClick={() => setMoreOpen((o) => !o)} className={tab(moreActive || moreOpen)}>
          <MoreIcon />
          More
        </button>
      </nav>
    </>
  );
}
