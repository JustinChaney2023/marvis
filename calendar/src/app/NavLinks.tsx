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

// Lives in the persistent TopBar (see layout.tsx) rather than each page's
// own header, so it reads the active link from the URL instead of every
// page having to pass its own route back in as a `current` prop.
export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-full border border-rule bg-paper p-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-paper"
                : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
            }
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
