"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavLinks from "./NavLinks";
import ThemeToggle from "./ThemeToggle";
import SettingsButton from "./SettingsButton";
import FeedbackButton from "./FeedbackButton";

// Public/pre-auth routes render their own minimal chrome, so the app nav
// and settings/feedback icons (which assume a logged-in user) stay hidden.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/book/", "/rsvp/"];

// Keep in sync with package.json's "version" — duplicated rather than
// imported so this client bundle doesn't pull in the whole package.json
// (dependency list included) just to read one field.
const APP_VERSION = "0.1.0";

// One persistent bar instead of the floating corner buttons this replaced
// (ThemeToggle/SettingsButton/FeedbackButton used to be `fixed` to page
// corners, which overlapped each page's own header content). Sticky here
// so it stays visible while the content below it scrolls.
export default function TopBar() {
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-rule bg-surface px-3 py-2.5 print:hidden sm:gap-4 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Link href="/" className="flex items-baseline gap-1.5 px-1">
          <span className="font-serif text-lg tracking-tight text-ink">
            Marvis
          </span>
          <span className="hidden font-mono text-[10px] text-muted sm:inline">
            v{APP_VERSION}
          </span>
        </Link>
        <span className="hidden h-5 w-px bg-rule sm:block" />
        <NavLinks />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ThemeToggle />
        <FeedbackButton />
        <SettingsButton />
      </div>
    </header>
  );
}
