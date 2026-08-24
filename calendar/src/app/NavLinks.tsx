"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, ListIcon, TargetIcon, BarsIcon, UsersIcon, ChatIcon, MicIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Calendar", icon: CalendarIcon },
  { href: "/tasks", label: "Tasks", icon: ListIcon },
  { href: "/focus", label: "Focus", icon: TargetIcon },
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
    <nav className="flex flex-wrap items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-800">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
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
