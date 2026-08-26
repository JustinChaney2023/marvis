"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, ListIcon, TargetIcon, BarsIcon, UsersIcon, ChatIcon, MicIcon, FolderIcon, ClockIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Calendar", icon: CalendarIcon },
  { href: "/tasks", label: "Tasks", icon: ListIcon },
  { href: "/focus", label: "Focus", icon: TargetIcon },
  { href: "/timer", label: "Timer", icon: ClockIcon },
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/gantt", label: "Gantt", icon: BarsIcon },
  { href: "/recordings", label: "Record", icon: MicIcon },
  { href: "/team", label: "Team", icon: UsersIcon },
  { href: "/chat", label: "Chat", icon: ChatIcon },
] as const;

// Lives in the persistent SideRail (see layout.tsx) rather than each
// page's own header, so it reads the active link from the URL instead
// of every page having to pass its own route back in as a `current`
// prop. One column of icon+label rows rather than the pill row this
// replaced — nine destinations don't fit a single horizontal bar
// without wrapping or truncating, but they stack cleanly.
export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={
              active
                ? "flex items-center gap-2.5 rounded-lg bg-ink px-2.5 py-2 text-sm font-medium text-paper"
                : "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-rule-soft hover:text-ink"
            }
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
